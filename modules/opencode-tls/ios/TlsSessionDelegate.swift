import Foundation
import Security

/// Owns one nested-ephemeral-session load for `OpencodeTlsURLProtocol`.
///
/// Kept separate from the protocol subclass because `URLProtocol` subclasses
/// cannot adopt `URLSessionDataDelegate` under Swift 6 concurrency checking.
/// Lifetime: the protocol owns the delegate strongly and releases it in
/// `stopLoading`; the delegate invalidates the session once the task finishes.
final class TlsSessionDelegate: NSObject, URLSessionDataDelegate {
  private let origin: String
  private let fallbackURL: URL?
  private weak var owner: OpencodeTlsURLProtocol?
  private var finished = false
  var session: URLSession?

  init(owner: OpencodeTlsURLProtocol, origin: String, fallbackURL: URL?) {
    self.owner = owner
    self.origin = origin
    self.fallbackURL = fallbackURL
  }

  func urlSession(
    _ session: URLSession,
    task: URLSessionTask,
    willPerformHTTPRedirection response: HTTPURLResponse,
    newRequest request: URLRequest,
    completionHandler: @escaping (URLRequest?) -> Void
  ) {
    // Expo marks redirect:error requests; the nested CA session must honor it
    // before sending any credentials to the redirect destination.
    if let owner,
       URLProtocol.property(forKey: "shouldFollowRedirects", in: owner.request) as? Bool == false {
      completionHandler(nil)
      finish()
      owner.client?.urlProtocol(owner, didFailWithError: URLError(.httpTooManyRedirects))
      return
    }
    completionHandler(request)
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
    let certificates = TrustStore.certificates(for: origin)
    if TrustStore.evaluate(trust, host: challenge.protectionSpace.host, certificates: certificates) {
      completionHandler(.useCredential, URLCredential(trust: trust))
    } else {
      completionHandler(.cancelAuthenticationChallenge, nil)
    }
  }

  func urlSession(
    _ session: URLSession,
    dataTask: URLSessionDataTask,
    didReceive response: URLResponse,
    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void
  ) {
    guard let owner else {
      completionHandler(.cancel)
      return
    }
    guard let http = response as? HTTPURLResponse else {
      owner.client?.urlProtocol(owner, didReceive: response, cacheStoragePolicy: .notAllowed)
      completionHandler(.allow)
      return
    }
    var headers = http.allHeaderFields as? [String: String] ?? [:]
    // The nested URLSession already decoded the body; forwarding the encoding
    // headers would make the outer client decode it a second time.
    headers.removeValue(forKey: "Content-Encoding")
    headers.removeValue(forKey: "Content-Length")
    let forwarded = HTTPURLResponse(
      url: http.url ?? fallbackURL ?? owner.request.url!,
      statusCode: http.statusCode,
      httpVersion: "HTTP/1.1",
      headerFields: headers
    ) ?? http
    owner.client?.urlProtocol(owner, didReceive: forwarded, cacheStoragePolicy: .notAllowed)
    completionHandler(.allow)
  }

  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
    guard let owner else { return }
    owner.client?.urlProtocol(owner, didLoad: data)
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    guard !finished else { return }
    finish()
    guard let owner else { return }
    if let error {
      owner.client?.urlProtocol(owner, didFailWithError: error)
    } else {
      owner.client?.urlProtocolDidFinishLoading(owner)
    }
  }

  private func finish() {
    guard !finished else { return }
    finished = true
    session?.invalidateAndCancel()
  }
}
