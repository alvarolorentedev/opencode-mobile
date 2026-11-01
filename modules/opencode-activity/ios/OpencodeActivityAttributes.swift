import ActivityKit
import Foundation

// This exact source is compiled into the app pod and copied into the extension.
// No shared container, credentials, session titles, or tool text cross this DTO.
@available(iOS 17.0, *)
struct OpencodeActivityAttributes: ActivityAttributes {
  struct ContentState: Codable, Hashable {
    var body: String
    var link: String
    var chip: String
    var pausedLabel: String
    var phase: String
    var count: Int
    var updatedAt: Date
    var isPaused: Bool
    var frozenAt: Date?
    var endedAt: Date?
  }

  // A SHA-256 digest, not the JS key (which may contain connection identity).
  var generation: String
  var startedAt: Date
}
