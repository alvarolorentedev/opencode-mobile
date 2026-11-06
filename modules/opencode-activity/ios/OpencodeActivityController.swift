import ActivityKit
import CryptoKit
import Foundation
import UIKit

// Presentation-resource metadata only: opaque scoped task/run hashes, never
// query responses. Keep known anchors through partial windows and task removal.
struct OpencodeActivityCycle: Codable {
  var generation: String
  var work: [String: String]

  mutating func merge(_ keys: [String]) -> Bool {
    var newWork = false
    for key in keys {
      let parts = key.split(separator: ":", omittingEmptySubsequences: false).map(String.init)
      let task = parts[0]
      let run = parts.count == 2 ? parts[1] : ""
      if let known = work[task] {
        if !known.isEmpty && !run.isEmpty && known != run { newWork = true }
      } else {
        newWork = true
      }
      if !run.isEmpty || work[task] == nil { work[task] = run }
    }
    return newWork
  }
}

@available(iOS 17.0, *)
@MainActor
final class OpencodeActivityController {
  static let shared = OpencodeActivityController()
  private typealias LiveActivity = Activity<OpencodeActivityAttributes>
  private typealias State = OpencodeActivityAttributes.ContentState
  private let dismissalKey = "OpencodeActivity.dismissedGeneration"
  private let activeGenerationKey = "OpencodeActivity.activeGeneration"
  private let activeIdentifierKey = "OpencodeActivity.activeIdentifier"
  private let cycleKey = "OpencodeActivity.resourceCycle"
  private var cycle: OpencodeActivityCycle?
  private let phases: Set<String> = [
    "thinking", "needsInput", "retrying", "queued", "finished", "failed", "stopped", "reconnecting",
    "reading", "editing", "searching", "executing", "delegating",
  ]
  private let terminalPhases: Set<String> = ["finished", "failed", "stopped"]
  private var current: LiveActivity?
  private var retained: LiveActivity?
  private var pending: Task<Void, Never>?
  private var observations: [String: Task<Void, Never>] = [:]
  private var listeners: [NSObjectProtocol] = []
  private var revision = 0
  private var suspended = UIApplication.shared.applicationState != .active
  private var backgrounded = UIApplication.shared.applicationState == .background
  private var backgroundTask: UIBackgroundTaskIdentifier = .invalid

  static var isEnabled: Bool {
    Bundle.main.object(forInfoDictionaryKey: "OpencodeLiveActivitiesEnabled") as? Bool == true
      && ActivityAuthorizationInfo().areActivitiesEnabled
  }

  private init() {
    guard Bundle.main.object(forInfoDictionaryKey: "OpencodeLiveActivitiesEnabled") as? Bool == true else { return }
    // A dismissal can happen while this process is dead. Remember only opaque
    // native identity and a digest, and suppress resurrection after relaunch.
    let defaults = UserDefaults.standard
    if let data = defaults.data(forKey: cycleKey) {
      cycle = try? JSONDecoder().decode(OpencodeActivityCycle.self, from: data)
    }
    if let identifier = defaults.string(forKey: activeIdentifierKey),
      let generation = defaults.string(forKey: activeGenerationKey),
      !LiveActivity.activities.contains(where: {
        $0.id == identifier && ($0.activityState == .active || $0.activityState == .stale)
      }) {
      defaults.set(generation, forKey: dismissalKey)
      clearActiveIdentity()
    }
    let center = NotificationCenter.default
    listeners.append(center.addObserver(
      forName: UserDefaults.didChangeNotification, object: nil, queue: .main
    ) { [weak self] _ in
      MainActor.assumeIsolated {
        if let activity = self?.current, activity.attributes.remote == true,
          OpencodeActivityRemote.shared.enrollmentChanged(for: activity.id) {
          Task { await self?.stop(force: true) }
        }
      }
    })
    listeners.append(center.addObserver(
      forName: UIApplication.willResignActiveNotification, object: nil, queue: .main
    ) { [weak self] _ in
      // Control Center / Island inspection is transient inactivity, not proof
      // that monitoring has stopped. Still invalidate all in-flight observations.
      MainActor.assumeIsolated { self?.invalidateFreshness() }
    })
    listeners.append(center.addObserver(
      forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main
    ) { [weak self] _ in
      MainActor.assumeIsolated { self?.suspend() }
    })
    listeners.append(center.addObserver(
      forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main
    ) { [weak self] _ in
      // Becoming active is not evidence of fresh server state. Only JS update is.
      MainActor.assumeIsolated {
        self?.suspended = false
        self?.backgrounded = false
      }
    })
    enqueue {
      await self.adopt()
      if self.current?.attributes.remote == true, OpencodeActivityRemote.shared.enrollment == nil {
        await self.stopRestoredRemote()
      }
      await self.pauseCurrent()
    }
  }

  // Queue all ActivityKit writes: MainActor alone does not serialize across await.
  private func enqueue(_ operation: @escaping @MainActor () async -> Void) {
    let previous = pending
    pending = Task { @MainActor in
      await previous?.value
      await operation()
    }
  }

  func update(_ record: OpencodeActivityRecord) async -> Bool {
    guard Self.isEnabled else { return false }
    let submittedRevision = revision
    let submittedInForeground = UIApplication.shared.applicationState == .active
    let previous = pending
    let result = Task { @MainActor in
      await previous?.value
      return await self.apply(record, revision: submittedRevision, foreground: submittedInForeground)
    }
    pending = Task { _ = await result.value }
    return await result.value
  }

  func stop(force: Bool = false) async {
    // Local catalog idleness is not evidence about the managed relay scopes.
    // Removing enrollment or system authorization revokes this independent mode.
    if !force, current?.attributes.remote == true, Self.isEnabled,
      OpencodeActivityRemote.shared.enrollment != nil { return }
    // Invalidate updates already suspended inside ActivityKit before queuing cleanup.
    revision += 1
    let previous = pending
    let result = Task { @MainActor in
      await previous?.value
      var activities = LiveActivity.activities
      if let current = self.current, !activities.contains(where: { $0.id == current.id }) {
        activities.append(current)
      }
      if let retained = self.retained, !activities.contains(where: { $0.id == retained.id }) {
        activities.append(retained)
      }
      self.current = nil
      self.retained = nil
      self.clearActiveIdentity()
      self.clearCycle()
      for activity in activities {
        self.forget(activity)
        await activity.end(nil, dismissalPolicy: .immediate)
      }
      self.endBackgroundTask()
    }
    pending = result
    await result.value
  }

  private func invalidateFreshness() {
    suspended = true
    revision += 1
  }

  private func stopRestoredRemote() async {
    guard let activity = current else { return }
    forget(activity)
    current = nil
    clearActiveIdentity()
    clearCycle()
    await activity.end(nil, dismissalPolicy: .immediate)
  }

  private func suspend() {
    // willResignActive already suspended freshness; do not skip the real
    // background flush just because the app passed through inactive first.
    guard !backgrounded else { return }
    backgrounded = true
    invalidateFreshness()
    // Only enough background time to flush a local pause; never a keepalive.
    if backgroundTask == .invalid {
      backgroundTask = UIApplication.shared.beginBackgroundTask(withName: "OpencodeActivityPause") { [weak self] in
        Task { @MainActor in self?.endBackgroundTask() }
      }
    }
    enqueue {
      await self.adopt()
      await self.pauseCurrent()
      self.endBackgroundTask()
    }
  }

  private func endBackgroundTask() {
    guard backgroundTask != .invalid else { return }
    let identifier = backgroundTask
    backgroundTask = .invalid
    UIApplication.shared.endBackgroundTask(identifier)
  }

  private func adopt() async {
    if let current, current.activityState == .dismissed {
      UserDefaults.standard.set(current.attributes.generation, forKey: dismissalKey)
      clearActiveIdentity()
    }
    let activities = LiveActivity.activities.filter {
      $0.activityState == .active || $0.activityState == .stale
    }
    if current == nil || !activities.contains(where: { $0.id == current?.id }) {
      current = activities.first
    }
    for activity in activities {
      if activity.id == current?.id {
        remember(activity)
        observe(activity)
      } else {
        forget(activity)
        await activity.end(nil, dismissalPolicy: .immediate)
      }
    }
  }

  private func observe(_ activity: LiveActivity) {
    OpencodeActivityRemote.shared.observe(activity)
    guard observations[activity.id] == nil else { return }
    observations[activity.id] = Task { @MainActor [weak self] in
      for await state in activity.activityStateUpdates {
        guard !Task.isCancelled, let self else { return }
        if state == .dismissed {
          OpencodeActivityRemote.shared.forget(activity)
          UserDefaults.standard.set(activity.attributes.generation, forKey: self.dismissalKey)
          if self.current?.id == activity.id {
            self.current = nil
            self.clearActiveIdentity()
          }
          self.observations.removeValue(forKey: activity.id)
          return
        }
        if state == .ended {
          OpencodeActivityRemote.shared.forget(activity)
          if activity.attributes.remote == true {
            UserDefaults.standard.set(activity.attributes.generation, forKey: self.dismissalKey)
          }
          if self.current?.id == activity.id {
            self.current = nil
            self.clearActiveIdentity()
          }
          self.observations.removeValue(forKey: activity.id)
          return
        }
      }
    }
  }

  private func forget(_ activity: LiveActivity) {
    OpencodeActivityRemote.shared.forget(activity)
    observations.removeValue(forKey: activity.id)?.cancel()
  }

  private func remember(_ activity: LiveActivity) {
    UserDefaults.standard.set(activity.id, forKey: activeIdentifierKey)
    UserDefaults.standard.set(activity.attributes.generation, forKey: activeGenerationKey)
  }

  private func clearActiveIdentity() {
    UserDefaults.standard.removeObject(forKey: activeIdentifierKey)
    UserDefaults.standard.removeObject(forKey: activeGenerationKey)
  }

  private func fresh(_ submittedRevision: Int) -> Bool {
    !suspended && revision == submittedRevision && UIApplication.shared.applicationState == .active
  }

  private func reconcileCycle(_ workKeys: [String]) -> String {
    var value = cycle ?? OpencodeActivityCycle(
      generation: current?.attributes.generation ?? newGeneration(), work: [:]
    )
    let newWork = value.merge(workKeys)
    if cycle != nil && newWork { value.generation = newGeneration() }
    cycle = value
    if let data = try? JSONEncoder().encode(value) { UserDefaults.standard.set(data, forKey: cycleKey) }
    return value.generation
  }

  private func newGeneration() -> String {
    SHA256.hash(data: Data(UUID().uuidString.utf8)).map { String(format: "%02x", $0) }.joined()
  }

  private func clearCycle() {
    cycle = nil
    UserDefaults.standard.removeObject(forKey: cycleKey)
    UserDefaults.standard.removeObject(forKey: dismissalKey)
  }

  private func apply(_ record: OpencodeActivityRecord, revision: Int, foreground: Bool) async -> Bool {
    let phase = record.phase ?? (record.active ? "thinking" : "finished")
    guard Self.isEnabled, valid(record), phases.contains(phase) else { return false }
    let terminal = !record.active || terminalPhases.contains(phase)
    guard foreground, fresh(revision) else { return false }
    await adopt()
    guard fresh(revision) else { return false }

    let remote = OpencodeActivityRemote.shared.enrollment != nil
    if let activity = current, activity.attributes.remote == true {
      if remote { return true } // One writer: all subsequent state comes from APNs.
      forget(activity)
      current = nil
      await activity.end(nil, dismissalPolicy: .immediate)
    }
    if remote && terminal { return true }

    if terminal {
      clearCycle()
      guard let activity = current else { return true }
      var state = content(record, phase: phase)
      state.isPaused = true
      state.endedAt = Date()
      forget(activity)
      current = nil
      retained = activity
      clearActiveIdentity()
      await activity.end(
        ActivityContent(state: state, staleDate: nil),
        dismissalPolicy: .after(Date().addingTimeInterval(5 * 60))
      )
      return true
    }

    guard fresh(revision) else { return false }
    let generation = reconcileCycle(record.workKeys)
    if UserDefaults.standard.string(forKey: dismissalKey) == generation { return false }
    await dismissRetained()
    if let activity = current, activity.attributes.generation != generation {
      current = nil
      clearActiveIdentity()
      forget(activity)
      await activity.end(nil, dismissalPolicy: .immediate)
    }
    guard fresh(revision), Self.isEnabled else { return false }
    var state = content(record, phase: phase)
    if remote {
      // Until the relay observes its own authorized scopes, show paused data.
      state.body = record.pausedLabel
      state.chip = record.pausedLabel
      state.link = "opencodemobile-activities://"
      state.phase = "reconnecting"
      state.count = 0
      state.isPaused = true
      state.frozenAt = state.updatedAt
      state.completedSteps = nil; state.totalSteps = nil
      state.agentCount = nil; state.toolCount = nil; state.filesChanged = nil
      state.progressLabel = nil; state.agentsLabel = nil; state.toolsLabel = nil; state.filesLabel = nil
    }
    let payload = ActivityContent(state: state, staleDate: state.updatedAt.addingTimeInterval(60))
    if let activity = current, !remote {
      if activity.activityState == .dismissed {
        UserDefaults.standard.set(generation, forKey: dismissalKey)
        current = nil
        clearActiveIdentity()
        return false
      }
      await activity.update(payload)
    } else {
      // Push is strictly opt-in; Personal Team/local mode retains pushType:nil.
      do {
        if let old = current { forget(old); await old.end(nil, dismissalPolicy: .immediate) }
        let attributes = OpencodeActivityAttributes(generation: generation, startedAt: Date(), remote: remote ? true : nil)
        let activity = try LiveActivity.request(attributes: attributes, content: payload, pushType: remote ? .token : nil)
        current = activity
        remember(activity)
        observe(activity)
        UserDefaults.standard.removeObject(forKey: dismissalKey)
      } catch {
        return false
      }
    }
    // A background transition may have occurred while update was awaiting IPC.
    // Flush a paused state before the next queued write can run.
    if !fresh(revision) {
      if backgrounded { await pauseCurrent() }
      return false
    }
    return true
  }

  private func pauseCurrent() async {
    guard let activity = current, activity.activityState == .active || activity.activityState == .stale else { return }
    guard activity.attributes.remote != true else { return } // Relay stale-date owns freshness.
    var state = activity.content.state
    guard state.endedAt == nil else { return }
    if !state.isPaused {
      // Keep the last JS observation timestamp truthful. If the process died or
      // IPC was delayed past its freshness window, never count the unseen gap.
      let expired = activity.content.staleDate.map { $0 <= Date() } ?? true
      state.frozenAt = expired ? state.updatedAt : Date()
      state.isPaused = true
    }
    await activity.update(ActivityContent(state: state, staleDate: Date()))
  }

  private func dismissRetained() async {
    var ended = LiveActivity.activities.filter { $0.activityState == .ended }
    if let retained, !ended.contains(where: { $0.id == retained.id }) { ended.append(retained) }
    retained = nil
    for activity in ended {
      forget(activity)
      await activity.end(nil, dismissalPolicy: .immediate)
    }
  }

  private func content(_ record: OpencodeActivityRecord, phase: String) -> State {
    State(
      body: record.body, link: record.link, chip: record.chip,
      pausedLabel: record.pausedLabel, phase: phase, count: record.count,
      updatedAt: Date(), isPaused: false, frozenAt: nil, endedAt: nil,
      completedSteps: record.completedSteps, totalSteps: record.totalSteps,
      agentCount: record.agentCount, toolCount: record.toolCount, filesChanged: record.filesChanged,
      progressLabel: record.progressLabel, agentsLabel: record.agentsLabel,
      toolsLabel: record.toolsLabel, filesLabel: record.filesLabel,
      updatedLabel: record.updatedLabel, elapsedLabel: record.elapsedLabel
    )
  }

  private func valid(_ record: OpencodeActivityRecord) -> Bool {
    let urlTypes = Bundle.main.object(forInfoDictionaryKey: "CFBundleURLTypes") as? [[String: Any]] ?? []
    let schemes = urlTypes.flatMap { $0["CFBundleURLSchemes"] as? [String] ?? [] }
      .map { $0.lowercased() }
    guard record.title == "OpenCode", !record.key.isEmpty, record.key.utf8.count <= 8192,
      record.workKeys.count <= 9999, (!record.active || !record.workKeys.isEmpty),
      record.workKeys.allSatisfy({ key in
        let parts = key.split(separator: ":", omittingEmptySubsequences: false)
        return (1...2).contains(parts.count) && parts.allSatisfy {
          $0.count == 64 && $0.allSatisfy { $0.isASCII && $0.isHexDigit }
        }
      }),
      !record.body.isEmpty, record.body.count <= 180,
      !record.chip.isEmpty, record.chip.count <= 80,
      !record.pausedLabel.isEmpty, record.pausedLabel.count <= 180,
      (0...9999).contains(record.count),
      record.link.utf8.count <= 16384,
      let link = URLComponents(string: record.link),
      let scheme = link.scheme, schemes.contains(scheme.lowercased()),
      link.host == "session", link.user == nil, link.password == nil, link.port == nil,
      link.fragment == nil, link.path.hasPrefix("/"), link.path.count > 1,
      !link.percentEncodedPath.dropFirst().contains("/"),
      let query = link.queryItems, Set(query.map(\.name)) == Set(["project", "connectionScope"]),
      query.count == 2,
      let scope = query.first(where: { $0.name == "connectionScope" })?.value,
      scope.hasPrefix("activity-sha256:"), scope.count == 80,
      scope.dropFirst(16).allSatisfy({ $0.isHexDigit && $0.isASCII }) else { return false }
    let labels = [record.progressLabel, record.agentsLabel, record.toolsLabel,
      record.filesLabel, record.updatedLabel, record.elapsedLabel].compactMap { $0 }
    guard labels.allSatisfy({ !$0.isEmpty && $0.count <= 80 }),
      [record.agentCount, record.toolCount, record.filesChanged].compactMap({ $0 }).allSatisfy({
        (0...9999).contains($0)
      }) else { return false }
    if record.completedSteps != nil || record.totalSteps != nil {
      guard let completed = record.completedSteps, let total = record.totalSteps,
        (1...9999).contains(total), (0...total).contains(completed) else { return false }
    }
    guard ([record.body, record.chip, record.pausedLabel, record.link] + labels).allSatisfy({
      $0.rangeOfCharacter(from: .controlCharacters) == nil
    }) else { return false }
    // ActivityKit has a combined attributes/content payload budget of 4 KB.
    // Character limits alone are not byte limits for translated text or URLs.
    guard let encoded = try? JSONEncoder().encode(content(record, phase: record.phase ?? "thinking")) else { return false }
    return encoded.count <= 3500
  }
}
