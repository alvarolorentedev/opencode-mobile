import Foundation
import Security

/// Host-scoped HTTPS trust for manual connections with an imported CA.
///
/// Intercepts only origins that have stored anchors; every other request
/// falls through to the system stack. Trust stays additive: system anchors
/// are evaluated first and the imported certificates are checked after them
/// (`SecTrustSetAnchorCertificatesOnly(trust, false)` in `TrustStore`).
final class OpencodeTlsURLProtocol: URLProtocol {
  private var runningSession: URLSession?
  private var runningTask: URLSessionDataTask?
  private var delegate: TlsSessionDelegate?

  override class func canInit(with request: URLRequest) -> Bool {
    guard request.url?.scheme?.lowercased() == "https",
          let host = request.url?.host else { return false }
    let port = request.url?.port ?? 443
    return !TrustStore.certificates(for: TrustStore.originKey(host: host, port: port)).isEmpty
  }

  override class func canonicalRequest(for request: URLRequest) -> URLRequest {
    request
  }

  override func startLoading() {
    guard let url = request.url, let host = url.host else {
      client?.urlProtocol(self, didFailWithError: URLError(.badURL))
      return
    }
    let origin = TrustStore.originKey(host: host, port: url.port ?? 443)
    let delegate = TlsSessionDelegate(owner: self, origin: origin, fallbackURL: url)
    self.delegate = delegate
    let configuration = URLSessionConfiguration.ephemeral
    configuration.httpShouldSetCookies = true
    configuration.httpCookieAcceptPolicy = .always
    configuration.httpCookieStorage = .shared
    configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
    configuration.urlCache = nil
    let session = URLSession(configuration: configuration, delegate: delegate, delegateQueue: nil)
    delegate.session = session
    self.runningSession = session
    let task = session.dataTask(with: request)
    self.runningTask = task
    task.resume()
  }

  override func stopLoading() {
    runningTask?.cancel()
    runningSession?.invalidateAndCancel()
    runningTask = nil
    runningSession = nil
    delegate = nil
  }
}
