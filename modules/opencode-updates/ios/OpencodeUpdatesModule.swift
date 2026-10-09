import ExpoModulesCore
import StoreKit

public class OpencodeUpdatesModule: Module {
  public func definition() -> ModuleDefinition {
    Name("OpencodeUpdates")
    AsyncFunction("getAppStoreInstallation") { () async throws -> [String: Any] in
      #if DEBUG || targetEnvironment(simulator)
      return ["eligible": false]
      #else
      let verification = try await AppTransaction.shared
      guard case .verified(let transaction) = verification,
            transaction.environment == .production,
            transaction.bundleID == Bundle.main.bundleIdentifier else {
        return ["eligible": false]
      }
      return [
        "eligible": true,
        "bundleId": transaction.bundleID,
        "installedVersion": Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? ""
      ]
      #endif
    }
  }
}
