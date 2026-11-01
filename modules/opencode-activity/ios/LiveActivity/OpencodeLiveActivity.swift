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
      ActivitySurface(context: context)
        .widgetURL(URL(string: context.state.link))
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.bottom) {
          ActivityDashboard(state: context.state, startedAt: context.attributes.startedAt, isStale: context.isStale)
            .environment(\.colorScheme, .dark)
            .padding(.vertical, 12)
        }
      } compactLeading: {
        ActivityPhaseIcon(state: context.state)
          .environment(\.colorScheme, .dark)
      } compactTrailing: {
        if context.state.isTerminal {
          ActivityPhaseIcon(state: context.state)
            .environment(\.colorScheme, .dark)
        } else if let progress = context.state.planProgress, let label = context.state.progressLabel {
          Text(verbatim: "\(progress.completed.formatted())/\(progress.total.formatted())")
            .monospacedDigit()
            .accessibilityLabel(Text(verbatim: label))
        } else {
          Text(verbatim: context.state.count.formatted()).monospacedDigit()
            .accessibilityLabel(Text(verbatim: context.state.chip))
        }
      } minimal: {
        ActivityPhaseIcon(state: context.state)
          .environment(\.colorScheme, .dark)
      }
      .keylineTint(OpencodeActivityTheme(colorScheme: .dark).tint)
      .widgetURL(URL(string: context.state.link))
    }
  }
}

private struct ActivitySurface: View {
  let context: ActivityViewContext<OpencodeActivityAttributes>
  @Environment(\.colorScheme) private var colorScheme

  var body: some View {
    let theme = OpencodeActivityTheme(colorScheme: colorScheme)
    ActivityDashboard(state: context.state, startedAt: context.attributes.startedAt, isStale: context.isStale)
      .padding(12)
      .activityBackgroundTint(theme.background)
      .activitySystemActionForegroundColor(theme.text)
  }
}
