import Foundation
import Security
import SocketRocket

final class OpencodeTlsSecurityPolicy: SRSecurityPolicy {
  private let origin: String
  private let certificates: [SecCertificate]

  init(origin: String, certificates: [SecCertificate]) {
    self.origin = origin
    self.certificates = certificates
    super.init()
  }

  override func updateSecurityOptions(in stream: Stream) {
    stream.setProperty(StreamSocketSecurityLevel.tlsv12, forKey: .socketSecurityLevelKey)
    let options = [kCFStreamSSLValidatesCertificateChain as String: false] as NSDictionary
    stream.setProperty(options, forKey: Stream.PropertyKey(rawValue: kCFStreamPropertySSLSettings as String))
  }

  override func evaluateServerTrust(_ serverTrust: SecTrust, forDomain domain: String) -> Bool {
    TrustStore.evaluate(serverTrust, host: domain, certificates: certificates)
  }
}
