import ExpoModulesCore
import Foundation
import ObjectiveC
import Security

public final class OpencodeTlsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("OpencodeTls")

    OnCreate {
      Self.installURLSessionProvider()
      Self.installExpoFetchProvider()
      OpencodeTlsWebSocketInstaller.install()
    }

    AsyncFunction("importCertificate") { (input: String, promise: Promise) in
      do {
        let parsed = try CertificateParser.parseBase64(input)
        promise.resolve([
          "pem": parsed.pem,
          "fingerprint": parsed.fingerprint,
          "subject": parsed.subject,
          "issuer": parsed.issuer,
          "notBefore": parsed.notBefore,
          "notAfter": parsed.notAfter,
          "kind": parsed.kind,
          "count": parsed.count,
        ])
      } catch {
        promise.reject("ERR_CERTIFICATE", error.localizedDescription)
      }
    }

    AsyncFunction("setTrustAnchors") { (origin: String, pems: [String], promise: Promise) in
      do {
        try TrustStore.set(origin: origin, pems: pems)
        // The WebSocket path keeps its own Objective-C store (see
        // OpencodeTlsTrust.h); update it alongside the Swift store.
        OpencodeTlsTrust.setAnchors(TrustStore.certificates(for: origin) as [Any], forOrigin: origin)
        promise.resolve(nil)
      } catch {
        promise.reject("ERR_CERTIFICATE", error.localizedDescription)
      }
    }

    AsyncFunction("clearTrustAnchors") { (origin: String) in
      TrustStore.clear(origin: origin)
      OpencodeTlsTrust.clearAnchors(forOrigin: origin)
    }

    AsyncFunction("probe") { (origin: String, pem: String?, promise: Promise) in
      // Resolve through the non-sending Any? overload: the result dictionary
      // is built off-thread and must not cross task isolation as `sending`.
      TlsProbe.probe(origin: origin, pem: pem) { result in
        let value: Any = result
        promise.resolve(value)
      }
    }
  }

  private static func configuration() -> URLSessionConfiguration {
    let configuration = URLSessionConfiguration.default
    configuration.httpShouldSetCookies = true
    configuration.httpCookieAcceptPolicy = .always
    configuration.httpCookieStorage = .shared
    var protocols = configuration.protocolClasses ?? []
    protocols.insert(OpencodeTlsURLProtocol.self, at: 0)
    configuration.protocolClasses = protocols
    return configuration
  }

  private static func installURLSessionProvider() {
    typealias Provider = @convention(block) () -> URLSessionConfiguration?
    typealias Setter = @convention(c) (Provider?) -> Void
    guard let symbol = dlsym(UnsafeMutableRawPointer(bitPattern: -2), "RCTSetCustomNSURLSessionConfigurationProvider") else {
      return
    }
    let setter = unsafeBitCast(symbol, to: Setter.self)
    let provider: Provider = { OpencodeTlsModule.configuration() }
    setter(provider)
  }

  private static func installExpoFetchProvider() {
    // Expo's setter is main-actor isolated; finish registration before JS can fetch.
    guard Thread.isMainThread else {
      DispatchQueue.main.sync { installExpoFetchProvider() }
      return
    }
    typealias Provider = @convention(block) () -> URLSessionConfiguration?
    typealias Setter = @convention(c) (AnyObject, Selector, AnyObject?) -> Void
    guard let cls = NSClassFromString("EXFetchCustomExtension") else { return }
    let selector = NSSelectorFromString("setCustomURLSessionConfigurationProvider:")
    guard let method = class_getClassMethod(cls, selector) else { return }
    let setter = unsafeBitCast(method_getImplementation(method), to: Setter.self)
    let provider: Provider = { OpencodeTlsModule.configuration() }
    setter(cls, selector, provider as AnyObject)
  }
}
