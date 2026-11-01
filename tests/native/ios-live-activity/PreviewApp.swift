import Foundation
import SwiftUI
import UIKit

// Standalone production-view harness. This does not launch OpenCode's RN app or
// ask the system to host a Live Activity on the Lock Screen / Dynamic Island.
private struct PreviewFixture: Decodable {
  let id: String
  let startedAt: Date
  let isStale: Bool
  let locale: String
  let direction: String
  let state: OpencodeActivityAttributes.ContentState
}

private struct PreviewSelection {
  let fixture: PreviewFixture
  let appearance: String
  let textSize: String

  var marker: String {
    "OPENCODE_PREVIEW_READY \(fixture.id) \(appearance) \(textSize)"
  }

  static func load() throws -> PreviewSelection {
    let arguments = ProcessInfo.processInfo.arguments
    func argument(_ name: String) -> String {
      guard let index = arguments.firstIndex(of: name), arguments.indices.contains(index + 1) else {
        fatalError("Missing preview argument: \(name)")
      }
      return arguments[index + 1]
    }
    let scenario = argument("--scenario")
    let appearance = argument("--appearance")
    let textSize = argument("--text-size")
    guard ["light", "dark"].contains(appearance), ["large", "accessibility3"].contains(textSize),
      let url = Bundle.main.url(forResource: "Fixtures", withExtension: "json") else {
      fatalError("Invalid preview arguments or missing fixtures")
    }
    let decoder = JSONDecoder()
    decoder.dateDecodingStrategy = .iso8601
    // Decode the complete matrix, including the legacy state with no new fields.
    let fixtures = try decoder.decode([PreviewFixture].self, from: Data(contentsOf: url))
    guard let fixture = fixtures.first(where: { $0.id == scenario }) else {
      fatalError("Unknown preview scenario: \(scenario)")
    }
    return PreviewSelection(fixture: fixture, appearance: appearance, textSize: textSize)
  }
}

@main
@MainActor
struct OpencodeActivityPreviewApp: App {
  private let selection: PreviewSelection

  init() {
    do { selection = try PreviewSelection.load() }
    catch { fatalError("Could not decode production ContentState preview fixtures: \(error)") }
  }

  var body: some Scene {
    WindowGroup {
      ScrollView {
        VStack(alignment: .leading, spacing: 24) {
          Text("Native SwiftUI preview").font(.title2.bold())
          Text(selection.fixture.id).font(.headline)
          ActivityDashboard(
            state: selection.fixture.state,
            startedAt: selection.fixture.startedAt,
            isStale: selection.fixture.isStale
          )
          .padding(12)
          .frame(maxWidth: .infinity, alignment: .leading)
          .background(
            OpencodeActivityTheme(colorScheme: selection.appearance == "dark" ? .dark : .light).background,
            in: RoundedRectangle(cornerRadius: 24)
          )
          Text("Production view harness only. Not system Live Activity hosting or a React Native app launch.")
            .font(.caption).foregroundStyle(.secondary)
        }
        .padding()
      }
      .preferredColorScheme(selection.appearance == "dark" ? .dark : .light)
      .dynamicTypeSize(selection.textSize == "accessibility3" ? .accessibility3 : .large)
      .environment(\.locale, Locale(identifier: selection.fixture.locale))
      .environment(\.layoutDirection, selection.fixture.direction == "rtl" ? .rightToLeft : .leftToRight)
      .background(RenderedWindowProbe(marker: selection.marker))
    }
  }
}

// onAppear alone is not rendered-window evidence. Wait for an active visible
// window and a successful UIKit hierarchy draw before acknowledging readiness.
private struct RenderedWindowProbe: UIViewRepresentable {
  let marker: String

  func makeUIView(context: Context) -> ProbeView { ProbeView(marker: marker) }
  func updateUIView(_ uiView: ProbeView, context: Context) {}

  final class ProbeView: UIView {
    private let marker: String
    private var scheduled = false

    init(marker: String) {
      self.marker = marker
      super.init(frame: .zero)
      isUserInteractionEnabled = false
    }

    required init?(coder: NSCoder) { fatalError("Programmatic preview only") }

    override func didMoveToWindow() {
      super.didMoveToWindow()
      guard window != nil, !scheduled else { return }
      scheduled = true
      checkWindow(attempt: 0)
    }

    private func checkWindow(attempt: Int) {
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { [weak self] in
        guard let self else { return }
        if let window = self.window, window.isKeyWindow, !window.isHidden,
          !window.bounds.isEmpty, UIApplication.shared.applicationState == .active {
          window.layoutIfNeeded()
          var rendered = false
          _ = UIGraphicsImageRenderer(bounds: window.bounds).image { _ in
            rendered = window.drawHierarchy(in: window.bounds, afterScreenUpdates: true)
          }
          if rendered {
            FileHandle.standardOutput.write(Data("\(self.marker)\n".utf8))
            return
          }
        }
        guard attempt < 119 else { fatalError("Preview window did not render within 30 seconds") }
        self.checkWindow(attempt: attempt + 1)
      }
    }
  }
}
