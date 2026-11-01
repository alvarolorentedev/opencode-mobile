import Foundation
import Security

final class TlsProbeDelegate: NSObject, URLSessionTaskDelegate {
  private let origin: String
  private let certificates: [SecCertificate]
  private let completion: @Sendable ([String: Any]) -> Void
  private var finished = false
  var session: URLSession?

  init(origin: String, certificates: [SecCertificate], completion: @escaping @Sendable ([String: Any]) -> Void) {
    self.origin = origin
    self.certificates = certificates
    self.completion = completion
  }

  func urlSession(
    _ session: URLSession,
    task: URLSessionTask,
    didReceive challenge: URLAuthenticationChallenge,
    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
  ) {
    guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
          let trust = challenge.protectionSpace.serverTrust else {
      completionHandler(.performDefaultHandling, nil)
      return
    }
    if TrustStore.evaluate(trust, host: challenge.protectionSpace.host, certificates: certificates) {
      completionHandler(.useCredential, URLCredential(trust: trust))
    } else {
      completionHandler(.cancelAuthenticationChallenge, nil)
    }
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    if let error {
      finish(Self.failure(error))
    } else {
      finish(["ok": true, "reason": "ok"])
    }
  }

  private func finish(_ result: [String: Any]) {
    guard !finished else { return }
    finished = true
    completion(result)
    session?.invalidateAndCancel()
  }

  private static func failure(_ error: Error) -> [String: Any] {
    let nsError = error as NSError
    let message = nsError.localizedDescription
    let reason: String
    switch nsError.code {
    case NSURLErrorServerCertificateHasBadDate, NSURLErrorServerCertificateNotYetValid:
      reason = "expired"
    case NSURLErrorServerCertificateUntrusted, NSURLErrorServerCertificateHasUnknownRoot, NSURLErrorSecureConnectionFailed:
      reason = message.localizedCaseInsensitiveContains("hostname") ? "hostname-mismatch" : "untrusted"
    default:
      if message.localizedCaseInsensitiveContains("hostname") { reason = "hostname-mismatch" }
      else if message.localizedCaseInsensitiveContains("expired") { reason = "expired" }
      else if message.localizedCaseInsensitiveContains("certificate") { reason = "untrusted" }
      else { reason = "network" }
    }
    return ["ok": false, "reason": reason, "message": message]
  }
}

enum TlsProbe {
  static func probe(origin: String, pem: String?, completion: @escaping @Sendable ([String: Any]) -> Void) {
    let certificates: [SecCertificate]
    do {
      certificates = try pem.map { try CertificateParser.parsePem($0) } ?? []
    } catch {
      completion(["ok": false, "reason": "invalid", "message": error.localizedDescription])
      return
    }
    guard let url = URL(string: "https://\(origin)/") else {
      completion(["ok": false, "reason": "network"])
      return
    }
    let delegate = TlsProbeDelegate(origin: origin, certificates: certificates, completion: completion)
    let configuration = URLSessionConfiguration.ephemeral
    configuration.timeoutIntervalForRequest = 5
    configuration.timeoutIntervalForResource = 5
    configuration.httpShouldSetCookies = false
    let session = URLSession(configuration: configuration, delegate: delegate, delegateQueue: nil)
    delegate.session = session
    session.dataTask(with: url).resume()
  }
}
