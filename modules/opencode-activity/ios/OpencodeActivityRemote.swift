import ActivityKit
import Foundation

private final class NoActivityRedirects: NSObject, URLSessionTaskDelegate {
  func urlSession(_ session: URLSession, task: URLSessionTask,
    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
    completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}

// Managed enrollment is separate from OpenCode / Cloud Link authentication.
// No token, key, source address, session ID, or project path crosses into JS.
@available(iOS 17.0, *)
@MainActor
final class OpencodeActivityRemote {
  static let shared = OpencodeActivityRemote()
  private typealias LiveActivity = Activity<OpencodeActivityAttributes>
  private var tasks: [String: Task<Void, Never>] = [:]
  private var enrollments: [String: (url: URL, credential: String)] = [:]
  private let revisionKey = "OpencodeActivity.remoteRevision"
  private let delegate = NoActivityRedirects()
  private lazy var session: URLSession = {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.timeoutIntervalForRequest = 10
    configuration.timeoutIntervalForResource = 15
    configuration.httpShouldSetCookies = false
    return URLSession(configuration: configuration, delegate: delegate, delegateQueue: nil)
  }()

  var enrollment: (url: URL, credential: String)? {
    guard let text = Bundle.main.object(forInfoDictionaryKey: "OpencodeActivityRelayURL") as? String,
      let url = URL(string: text), url.scheme == "https", url.host != nil,
      url.user == nil, url.password == nil, url.query == nil, url.fragment == nil,
      url.path == "/v1/activity",
      let managed = UserDefaults.standard.dictionary(forKey: "com.apple.configuration.managed"),
      let credential = managed["OpencodeActivityCredential"] as? String,
      credential.count >= 43, credential.count <= 128,
      credential.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-" || $0 == "_") }) else { return nil }
    return (url, credential)
  }

  private func nextRevision() -> Int {
    let next = UserDefaults.standard.integer(forKey: revisionKey) + 1
    UserDefaults.standard.set(next, forKey: revisionKey)
    return next
  }

  func enrollmentChanged(for identifier: String) -> Bool {
    guard let previous = enrollments[identifier] else { return enrollment == nil }
    return previous.url != enrollment?.url || previous.credential != enrollment?.credential
  }

  func observe(_ activity: Activity<OpencodeActivityAttributes>) {
    guard activity.attributes.remote == true, tasks[activity.id] == nil, let enrollment else { return }
    enrollments[activity.id] = enrollment
    tasks[activity.id] = Task { @MainActor [weak self] in
      guard let self else { return }
      if let token = activity.pushToken {
        _ = await self.send(activity, token: token, revision: self.nextRevision())
      }
      // ActivityKit replays the current token and emits every subsequent rotation.
      for await token in activity.pushTokenUpdates {
        guard !Task.isCancelled else { return }
        let revision = self.nextRevision()
        // Registration retries are bounded; a suspended phone cannot guarantee
        // delivery of token rotation. Relaunch restores this observation.
        for attempt in 0..<3 {
          guard !Task.isCancelled, self.enrollment != nil else { return }
          let status = await self.send(activity, token: token, revision: revision)
          if status == 200 || (400...499).contains(status) && status != 429 { break }
          if attempt < 2 { try? await Task.sleep(nanoseconds: 5_000_000_000) }
        }
      }
    }
  }

  func forget(_ activity: Activity<OpencodeActivityAttributes>) {
    tasks.removeValue(forKey: activity.id)?.cancel()
    guard activity.attributes.remote == true else { return }
    let previous = enrollments.removeValue(forKey: activity.id) ?? enrollment
    let revision = nextRevision()
    Task { _ = await send(activity, token: nil, revision: revision, credentials: previous) }
  }

  private func send(_ activity: LiveActivity, token: Data?, revision: Int,
    credentials: (url: URL, credential: String)? = nil) async -> Int {
    guard let enrollment = credentials ?? enrollment else { return 0 }
    var body: [String: Any] = ["activityId": activity.id, "generation": activity.attributes.generation,
      "revision": revision, "startedAt": Int(activity.attributes.startedAt.timeIntervalSince1970)]
    if let token { body["token"] = token.map { String(format: "%02x", $0) }.joined() }
    var request = URLRequest(url: enrollment.url)
    request.httpMethod = token == nil ? "DELETE" : "PUT"
    request.setValue("Bearer \(enrollment.credential)", forHTTPHeaderField: "Authorization")
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try? JSONSerialization.data(withJSONObject: body)
    do {
      let (_, response) = try await session.data(for: request)
      return (response as? HTTPURLResponse)?.statusCode ?? 0
    } catch { return 0 }
  }
}
