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
    // Optional for adoption of activities encoded by earlier app versions.
    var completedSteps: Int?
    var totalSteps: Int?
    var agentCount: Int?
    var toolCount: Int?
    var filesChanged: Int?
    var progressLabel: String?
    var agentsLabel: String?
    var toolsLabel: String?
    var filesLabel: String?
    var updatedLabel: String?
    var elapsedLabel: String?
    enum CodingKeys: String, CodingKey {
      case body, link, chip, pausedLabel, phase, count, updatedAt, isPaused, frozenAt, endedAt
      case completedSteps, totalSteps, agentCount, toolCount, filesChanged
      case progressLabel, agentsLabel, toolsLabel, filesLabel, updatedLabel, elapsedLabel
    }
  }

  // A SHA-256 digest, not the JS key (which may contain connection identity).
  var generation: String
  var startedAt: Date
  // Optional so existing local activities remain decodable after upgrading.
  var remote: Bool? = nil
}

// APNs bypasses the JavaScript/native record validator. Decode defensively in
// both processes; retain Foundation's default reference-date numeric strategy.
@available(iOS 17.0, *)
extension OpencodeActivityAttributes.ContentState {
  init(from decoder: Decoder) throws {
    let values = try decoder.container(keyedBy: CodingKeys.self)
    body = try values.decode(String.self, forKey: .body)
    link = try values.decode(String.self, forKey: .link)
    chip = try values.decode(String.self, forKey: .chip)
    pausedLabel = try values.decode(String.self, forKey: .pausedLabel)
    phase = try values.decode(String.self, forKey: .phase)
    count = try values.decode(Int.self, forKey: .count)
    updatedAt = try values.decode(Date.self, forKey: .updatedAt)
    isPaused = try values.decode(Bool.self, forKey: .isPaused)
    frozenAt = try values.decodeIfPresent(Date.self, forKey: .frozenAt)
    endedAt = try values.decodeIfPresent(Date.self, forKey: .endedAt)
    completedSteps = try values.decodeIfPresent(Int.self, forKey: .completedSteps)
    totalSteps = try values.decodeIfPresent(Int.self, forKey: .totalSteps)
    agentCount = try values.decodeIfPresent(Int.self, forKey: .agentCount)
    toolCount = try values.decodeIfPresent(Int.self, forKey: .toolCount)
    filesChanged = try values.decodeIfPresent(Int.self, forKey: .filesChanged)
    progressLabel = try values.decodeIfPresent(String.self, forKey: .progressLabel)
    agentsLabel = try values.decodeIfPresent(String.self, forKey: .agentsLabel)
    toolsLabel = try values.decodeIfPresent(String.self, forKey: .toolsLabel)
    filesLabel = try values.decodeIfPresent(String.self, forKey: .filesLabel)
    updatedLabel = try values.decodeIfPresent(String.self, forKey: .updatedLabel)
    elapsedLabel = try values.decodeIfPresent(String.self, forKey: .elapsedLabel)
    let phases = ["thinking", "needsInput", "retrying", "queued", "finished", "failed", "stopped",
      "reconnecting", "reading", "editing", "searching", "executing", "delegating"]
    let labels = [progressLabel, agentsLabel, toolsLabel, filesLabel, updatedLabel, elapsedLabel].compactMap { $0 }
    let strings = [body, chip, pausedLabel] + labels
    let dates = [updatedAt, frozenAt, endedAt].compactMap { $0 }
    let progressValid = (completedSteps == nil && totalSteps == nil) ||
      (totalSteps != nil && completedSteps != nil && (1...9999).contains(totalSteps!) && (0...totalSteps!).contains(completedSteps!))
    let url = URLComponents(string: link)
    let root = link == "opencodemobile-activities://"
    let local = ["opencodemobile", "opencodemobile-activities"].contains(url?.scheme ?? "") && url?.host == "session"
      && url?.user == nil && url?.password == nil && url?.port == nil && url?.fragment == nil
    guard phases.contains(phase), (0...9999).contains(count), progressValid,
      [agentCount, toolCount, filesChanged].compactMap({ $0 }).allSatisfy({ (0...9999).contains($0) }),
      strings.allSatisfy({ !$0.isEmpty && $0.count <= 180 && $0.rangeOfCharacter(from: .controlCharacters) == nil }),
      dates.allSatisfy({ $0.timeIntervalSince1970.isFinite && (0...4_000_000_000).contains($0.timeIntervalSince1970) }),
      (root || local), link.utf8.count <= 3500,
      try JSONEncoder().encode(self).count <= 3500 else {
      throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Invalid activity content"))
    }
  }
}
