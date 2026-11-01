import Foundation
import Security

/// Objective-C entry points for the WebSocket trust path.
///
/// `SRWebSocket`/`SRSecurityPolicy` are Objective-C-only APIs without a Swift
/// module, so the WebSocket provider lives in Objective-C and reaches the
/// Swift trust store through this bridge. HTTPS, probing and storage stay in
/// Swift (`TrustStore`, `OpencodeTlsURLProtocol`, `TlsProbe`).
@objc(OpencodeTlsTrustBridge)
public final class OpencodeTlsTrustBridge: NSObject {
  @objc(originKeyForHost:port:)
  public static func originKey(host: String, port: Int) -> String {
    TrustStore.originKey(host: host, port: port)
  }

  @objc(certificatesForOrigin:)
  public static func certificates(forOrigin origin: String) -> [Any] {
    TrustStore.certificates(for: origin)
  }

  @objc(evaluateTrust:host:certificates:)
  public static func evaluate(trust: SecTrust, host: String, certificates: [Any]) -> Bool {
    let certs = certificates as? [SecCertificate] ?? []
    return TrustStore.evaluate(trust, host: host, certificates: certs)
  }
}
