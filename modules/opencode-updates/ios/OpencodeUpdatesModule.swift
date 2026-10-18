import ExpoModulesCore
import StoreKit

public class OpencodeUpdatesModule: Module {
  public func definition() -> ModuleDefinition {
    Name("OpencodeUpdates")
    // Never let StoreKit errors propagate to the JSI promise rejecter: on the new
    // expo-modules-jsi bridge (SDK 56/57) a non-Exception Swift error crosses
    // Promise.reject -> Promise.swift:56 and can trap the process (EXC_BREAKPOINT)
    // instead of rejecting cleanly. App Store eligibility is best-effort: report
    // ineligible on any failure so the JS layer falls back to "no store update".
    AsyncFunction("getAppStoreInstallation") { () async -> [String: Any] in
      #if DEBUG || targetEnvironment(simulator)
      return ["eligible": false]
      #else
      let verification: VerificationResult
      do {
        verification = try await AppTransaction.shared
      } catch {
        return ["eligible": false]
      }
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
