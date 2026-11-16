import Foundation
import SwiftUI

// Pure presentation shared by WidgetKit and the synthetic simulator host.
// Never accepts ActivityViewContext, server text, or mutation callbacks.
struct ActivityDashboard: View {
  let state: OpencodeActivityAttributes.ContentState
  let startedAt: Date
  let isStale: Bool
  @Environment(\.colorScheme) private var colorScheme
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize

  private var theme: OpencodeActivityTheme { OpencodeActivityTheme(colorScheme: colorScheme) }
  private var paused: Bool { !state.isTerminal && (state.isPaused || isStale) }

  var body: some View {
    // ActivityKit allows 160pt. Reserve 12pt per edge for the surface host.
    ActivityDashboardSizing {
      ViewThatFits(in: .vertical) {
        if !dynamicTypeSize.isAccessibilitySize {
          full.fixedSize(horizontal: false, vertical: true)
        }
        compact.fixedSize(horizontal: false, vertical: true)
        essential(lineLimit: nil).fixedSize(horizontal: false, vertical: true)
        essential(lineLimit: 2).fixedSize(horizontal: false, vertical: true)
        essential(lineLimit: 1).fixedSize(horizontal: false, vertical: true)
      }
      // Measurement-only copies let the surface adopt the selected candidate's
      // intrinsic height rather than expanding to the entire 136pt offer.
      if !dynamicTypeSize.isAccessibilitySize {
        full.fixedSize(horizontal: false, vertical: true).hidden().accessibilityHidden(true)
      }
      compact.fixedSize(horizontal: false, vertical: true).hidden().accessibilityHidden(true)
      essential(lineLimit: nil).fixedSize(horizontal: false, vertical: true).hidden().accessibilityHidden(true)
      essential(lineLimit: 2).fixedSize(horizontal: false, vertical: true).hidden().accessibilityHidden(true)
      essential(lineLimit: 1).fixedSize(horizontal: false, vertical: true).hidden().accessibilityHidden(true)
    }
    .frame(maxWidth: .infinity, alignment: .topLeading)
    .foregroundStyle(theme.text)
    // No pulses, spinning symbols, inferred progress, or fit animations.
    .transaction { $0.animation = nil }
  }

  private var full: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack(alignment: .firstTextBaseline, spacing: 8) {
        Text(verbatim: "OpenCode")
          .font(.caption.weight(.semibold)).tracking(1)
          .foregroundStyle(theme.muted)
        Spacer(minLength: 4)
        Text(verbatim: state.chip)
          .font(.caption.weight(.medium))
          .padding(.horizontal, 8).padding(.vertical, 2)
          .background(theme.surfaceAlt, in: Capsule())
      }

      ViewThatFits(in: .horizontal) {
        HStack(alignment: .center, spacing: 12) {
          phaseHeading
          Spacer(minLength: 4)
          elapsed
        }
        VStack(alignment: .leading, spacing: 8) {
          phaseHeading
          elapsed
        }
      }

      planProgress

      if hasMetrics {
        ViewThatFits(in: .horizontal) {
          HStack(spacing: 8) { metrics }.fixedSize(horizontal: true, vertical: false)
          VStack(alignment: .leading, spacing: 8) { metrics }
        }
      }

      freshness
    }
  }

  private var compact: some View {
    VStack(alignment: .leading, spacing: 8) {
      phaseHeading
      planProgress
      freshness
    }
  }

  private func essential(lineLimit: Int?) -> some View {
    VStack(alignment: .leading, spacing: 4) {
      // No brand, tile, chip, timer, plan or metrics compete for this space.
      // Try the complete scalable phase first, then two lines before one line.
      // Bounded fallbacks truncate visually, but VoiceOver gets the full phase.
      Text(verbatim: state.body)
        .font(.headline).lineLimit(lineLimit).truncationMode(.tail)
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityLabel(Text(verbatim: state.body))
      if paused {
        HStack(spacing: 4) {
          Image(systemName: "pause.circle")
            .foregroundStyle(theme.warning).accessibilityHidden(true)
          Text(verbatim: state.pausedLabel)
            .foregroundStyle(theme.warning).lineLimit(1)
          Text(state.updatedAt, style: .time)
            .foregroundStyle(theme.muted)
            .lineLimit(1).fixedSize(horizontal: true, vertical: false)
        }
        .font(.caption2)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: state.pausedLabel))
        .accessibilityValue(Text(state.updatedAt, style: .time))
      }
    }
    .accessibilityElement(children: .contain)
  }

  @ViewBuilder private var planProgress: some View {
    if let progress = state.planProgress, let label = state.progressLabel {
      VStack(alignment: .leading, spacing: 4) {
        // JS supplies the complete localized label, including plan counts.
        Text(verbatim: label)
          .font(.caption).monospacedDigit().foregroundStyle(theme.muted)
        ProgressView(value: Double(progress.completed), total: Double(progress.total))
          .tint(statusColor)
          .accessibilityHidden(true)
      }
      .accessibilityElement(children: .combine)
    }
  }

  @ViewBuilder private var freshness: some View {
    if paused {
      ViewThatFits(in: .horizontal) {
        HStack(spacing: 8) { freshnessNotice }.fixedSize(horizontal: true, vertical: false)
        VStack(alignment: .leading, spacing: 4) { freshnessNotice }
      }
      .font(.caption2)
    }
  }

  private var phaseHeading: some View {
    HStack(alignment: .center, spacing: 12) {
      ActivityPhaseIcon(state: state)
        .accessibilityHidden(true)
        .font(.headline.weight(.semibold))
        .frame(width: 32, height: 32)
        .background(theme.surfaceAlt, in: RoundedRectangle(cornerRadius: 14))
      // The last safe phase is always primary, including stale/paused states.
      Text(verbatim: state.body)
        .font(.headline).fixedSize(horizontal: false, vertical: true)
        .layoutPriority(1)
    }
    .accessibilityElement(children: .combine)
  }

  @ViewBuilder private var elapsed: some View {
    if let label = state.elapsedLabel {
      VStack(alignment: .leading, spacing: 4) {
        Text(verbatim: label).font(.caption2).foregroundStyle(theme.muted)
        ActivityElapsed(state: state, startedAt: startedAt, isStale: isStale)
          .font(.subheadline.monospacedDigit().weight(.medium))
      }
      .fixedSize(horizontal: true, vertical: false)
      .accessibilityElement(children: .combine)
    }
  }

  private var statusColor: Color { theme.status(for: state.phase) }

  @ViewBuilder private var freshnessNotice: some View {
    Label {
      Text(verbatim: state.pausedLabel)
    } icon: {
      Image(systemName: "pause.circle").accessibilityHidden(true)
    }
    .foregroundStyle(theme.warning)
    HStack(spacing: 4) {
      if let label = state.updatedLabel { Text(verbatim: label) }
      Text(state.updatedAt, style: .time)
    }
    .foregroundStyle(theme.muted)
    .accessibilityElement(children: .combine)
  }
  private var hasMetrics: Bool {
    (state.agentCount != nil && state.agentsLabel != nil)
      || (state.toolCount != nil && state.toolsLabel != nil)
      || (state.filesChanged != nil && state.filesLabel != nil)
  }

  @ViewBuilder private var metrics: some View {
    metric(state.agentCount, label: state.agentsLabel, symbol: "person.2")
    metric(state.toolCount, label: state.toolsLabel, symbol: "wrench.and.screwdriver")
    metric(state.filesChanged, label: state.filesLabel, symbol: "doc.badge.gearshape")
  }

  @ViewBuilder private func metric(_ count: Int?, label: String?, symbol: String) -> some View {
    if let count, (0...9999).contains(count), let label {
      HStack(spacing: 4) {
        Image(systemName: symbol).accessibilityHidden(true)
        // Numeric fields validate visibility; the localized label includes count.
        Text(verbatim: label).monospacedDigit()
      }
      .font(.caption)
      .padding(.horizontal, 8).padding(.vertical, 4)
      .background(theme.surfaceAlt, in: RoundedRectangle(cornerRadius: 8))
      .accessibilityElement(children: .combine)
    }
  }
}

// ViewThatFits may consume its proposed height even when a smaller candidate
// wins. Measure the hidden candidates without compression, then offer exactly
// the first fitting height to the single visible ViewThatFits child. No geometry
// state, clipping, font shrinking, or duplicate accessibility elements are used.
private struct ActivityDashboardSizing: Layout {
  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    let width = proposal.width.flatMap { $0.isFinite ? $0 : nil }
    let budget = min(136, proposal.height ?? 136)
    let measurement = ProposedViewSize(width: width, height: nil)
    var fallback = CGSize.zero
    for candidate in subviews.dropFirst() {
      let size = candidate.sizeThatFits(measurement)
      fallback = size
      if size.height <= budget {
        return CGSize(width: width ?? size.width, height: size.height)
      }
    }
    // The final candidate has at most one phase line and one freshness line,
    // retaining scaled text and the observation time even for long translations.
    return CGSize(width: width ?? fallback.width, height: fallback.height)
  }

  func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
    subviews.first?.place(at: bounds.origin, anchor: .topLeading,
      proposal: ProposedViewSize(width: bounds.width, height: bounds.height))
  }
}

struct ActivityPhaseIcon: View {
  let state: OpencodeActivityAttributes.ContentState
  @Environment(\.colorScheme) private var colorScheme

  var body: some View {
    Image(systemName: state.phaseSymbol)
      .foregroundStyle(OpencodeActivityTheme(colorScheme: colorScheme).status(for: state.phase))
      .accessibilityLabel(Text(verbatim: state.body))
  }
}

struct ActivityElapsed: View {
  let state: OpencodeActivityAttributes.ContentState
  let startedAt: Date
  let isStale: Bool

  var body: some View {
    if state.isPaused || state.isTerminal || isStale {
      // Native pauseCurrent already falls back to updatedAt for expired work.
      // Becoming stale must not discard a valid later pause timestamp.
      let end = state.endedAt ?? state.frozenAt ?? state.updatedAt
      let seconds = max(0, Int(end.timeIntervalSince(startedAt)))
      Text(verbatim: String(format: "%02d:%02d:%02d", seconds / 3600, seconds / 60 % 60, seconds % 60))
    } else {
      // A finite interval also stops if WidgetKit delays the stale rerender.
      Text(timerInterval: startedAt...max(startedAt, state.updatedAt.addingTimeInterval(60)), countsDown: false)
        .monospacedDigit()
    }
  }
}

extension OpencodeActivityAttributes.ContentState {
  var isTerminal: Bool { endedAt != nil || ["finished", "failed", "stopped"].contains(phase) }

  var planProgress: (completed: Int, total: Int)? {
    guard let completed = completedSteps, let total = totalSteps,
      (1...9999).contains(total), (0...total).contains(completed) else { return nil }
    return (completed, total)
  }

  var phaseSymbol: String {
    switch phase {
    case "reading": return "doc.text.magnifyingglass"
    case "editing": return "square.and.pencil"
    case "searching": return "magnifyingglass"
    case "executing": return "terminal"
    case "delegating": return "person.2"
    case "needsInput": return "hand.raised"
    case "retrying", "reconnecting": return "arrow.clockwise"
    case "queued": return "clock"
    case "finished": return "checkmark.circle.fill"
    case "failed": return "exclamationmark.octagon.fill"
    case "stopped": return "stop.circle"
    default: return "sparkle"
    }
  }
}
