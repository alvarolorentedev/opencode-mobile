import Foundation
import Security

enum TrustStore {
  private nonisolated(unsafe) static var anchors: [String: [SecCertificate]] = [:]
  private static let lock = NSLock()

  static func originKey(host: String, port: Int) -> String {
    let normalized = host.contains(":") && !host.hasPrefix("[") ? "[\(host)]" : host
    return "\(normalized):\(port)"
  }

  static func set(origin: String, pems: [String]) throws {
    let certificates = try pems.flatMap { try CertificateParser.parsePem($0) }
    lock.lock()
    anchors[origin] = certificates
    lock.unlock()
  }

  static func clear(origin: String) {
    lock.lock()
    anchors.removeValue(forKey: origin)
    lock.unlock()
  }

  static func certificates(for origin: String) -> [SecCertificate] {
    lock.lock()
    defer { lock.unlock() }
    return anchors[origin] ?? []
  }

  static func evaluate(_ trust: SecTrust, host: String, certificates: [SecCertificate]) -> Bool {
    let policy = SecPolicyCreateSSL(true, host as CFString)
    SecTrustSetPolicies(trust, [policy] as CFArray)
    if !certificates.isEmpty {
      SecTrustSetAnchorCertificates(trust, certificates as CFArray)
      SecTrustSetAnchorCertificatesOnly(trust, false)
    }
    var error: CFError?
    return SecTrustEvaluateWithError(trust, &error)
  }
}
