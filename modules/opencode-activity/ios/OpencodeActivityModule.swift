import ActivityKit
import ExpoModulesCore
import Foundation

struct OpencodeActivityRecord: Record {
  @Field var title: String = ""
  @Field var body: String = ""
  @Field var link: String = ""
  @Field var chip: String = ""
  @Field var stopLabel: String = ""
  @Field var channelLabel: String = ""
  @Field var pausedLabel: String = ""
  @Field var key: String = ""
  @Field var workKeys: [String] = []
  @Field var active: Bool = false
  @Field var phase: String?
  @Field var count: Int = 0
  @Field var agentCount: Int?
  @Field var toolCount: Int?
  @Field var completedSteps: Int?
  @Field var totalSteps: Int?
  @Field var filesChanged: Int?
  @Field var progressLabel: String?
  @Field var agentsLabel: String?
  @Field var toolsLabel: String?
  @Field var filesLabel: String?
  @Field var updatedLabel: String?
  @Field var elapsedLabel: String?
}

public final class OpencodeActivityModule: Module {
  public func definition() -> ModuleDefinition {
    Name("OpencodeActivity")

    // A local Live Activity never guarantees background completion delivery.
    Function("suppressesCompletion") { false }
    Function("isAvailable") {
      if #available(iOS 17.0, *) {
        return Bundle.main.object(forInfoDictionaryKey: "OpencodeLiveActivitiesEnabled") as? Bool == true
          && ActivityAuthorizationInfo().areActivitiesEnabled
      }
      return false
    }

    AsyncFunction("update") { (record: OpencodeActivityRecord, promise: Promise) in
      Task { @MainActor in
        guard #available(iOS 17.0, *), OpencodeActivityController.isEnabled else {
          promise.resolve(false)
          return
        }
        promise.resolve(await OpencodeActivityController.shared.update(record))
      }
    }

    AsyncFunction("stop") { (promise: Promise) in
      Task { @MainActor in
        if #available(iOS 17.0, *) {
          await OpencodeActivityController.shared.stop()
        }
        promise.resolve(nil)
      }
    }

    AsyncFunction("waitUntilStopped") { () -> Void in }
  }
}
