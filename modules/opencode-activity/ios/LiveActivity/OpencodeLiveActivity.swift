import ActivityKit
import Foundation
import SwiftUI
import WidgetKit

@main
struct OpencodeLiveActivityBundle: WidgetBundle {
  var body: some Widget { OpencodeLiveActivity() }
}

struct OpencodeLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: OpencodeActivityAttributes.self) { context in
      ActivityBanner(context: context)
        .padding()
        .activityBackgroundTint(.black.opacity(0.9))
        .activitySystemActionForegroundColor(.white)
        .widgetURL(URL(string: context.state.link))
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          Text(verbatim: "OpenCode").font(.headline)
        }
        DynamicIslandExpandedRegion(.trailing) {
          Text(verbatim: context.state.chip).font(.caption)
        }
        DynamicIslandExpandedRegion(.bottom) {
          ActivityStatus(context: context)
        }
      } compactLeading: {
        Image(systemName: "chevron.left.forwardslash.chevron.right")
          .accessibilityLabel(Text(verbatim: "OpenCode"))
      } compactTrailing: {
        Text(verbatim: context.state.count.formatted()).monospacedDigit()
          .accessibilityLabel(Text(verbatim: context.state.chip))
      } minimal: {
        Text(verbatim: context.state.count.formatted()).monospacedDigit()
          .accessibilityLabel(Text(verbatim: context.state.chip))
      }
      .widgetURL(URL(string: context.state.link))
    }
  }
}

private struct ActivityBanner: View {
  let context: ActivityViewContext<OpencodeActivityAttributes>

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack {
        Text(verbatim: "OpenCode").font(.headline)
        Spacer(minLength: 8)
        Text(verbatim: context.state.chip).font(.caption)
      }
      ActivityStatus(context: context)
    }
    .foregroundStyle(.white)
  }
}

private struct ActivityStatus: View {
  let context: ActivityViewContext<OpencodeActivityAttributes>

  private var frozen: Bool {
    context.state.isPaused || context.state.endedAt != nil || context.isStale
  }

  var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: 12) {
      VStack(alignment: .leading, spacing: 4) {
        Text(verbatim: frozen && context.state.endedAt == nil
          ? context.state.pausedLabel : context.state.body)
          .font(.subheadline).lineLimit(2)
        if frozen && context.state.endedAt == nil {
          Text(context.state.updatedAt, style: .time)
            .font(.caption2).foregroundStyle(.secondary)
        }
      }
      Spacer(minLength: 0)
      elapsed.font(.caption.monospacedDigit()).fixedSize()
    }
  }

  @ViewBuilder private var elapsed: some View {
    if frozen {
      let end = context.state.endedAt ?? context.state.frozenAt ?? context.state.updatedAt
      let seconds = max(0, Int(end.timeIntervalSince(context.attributes.startedAt)))
      Text(verbatim: String(format: "%02d:%02d:%02d", seconds / 3600, seconds / 60 % 60, seconds % 60))
    } else {
      Text(context.attributes.startedAt, style: .timer)
    }
  }
}
