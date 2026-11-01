import Foundation
import Security

final class OpencodeTlsURLProtocol: URLProtocol, URLSessionDataDelegate {
  private var session: URLSession?
  private var task: URLSessionDataTask?
  private var origin: String?

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
    origin = TrustStore.originKey(host: host, port: url.port ?? 443)
    let configuration = URLSessionConfiguration.ephemeral
    configuration.httpShouldSetCookies = true
    configuration.httpCookieAcceptPolicy = .always
    configuration.httpCookieStorage = .shared
    configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
    configuration.urlCache = nil
    let session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
    self.session = session
    let task = session.dataTask(with: request)
    self.task = task
    task.resume()
  }

  override func stopLoading() {
    task?.cancel()
    session?.invalidateAndCancel()
    task = nil
    session = nil
  }

  func urlSession(
    _ session: URLSession,
    task: URLSessionTask,
    didReceive challenge: URLAuthenticationChallenge,
    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
  ) {
    guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
          let trust = challenge.protectionSpace.serverTrust,
          let origin else {
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
    guard let http = response as? HTTPURLResponse else {
      client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
      completionHandler(.allow)
      return
    }
    var headers = http.allHeaderFields as? [String: String] ?? [:]
    // The nested URLSession already decoded the body; forwarding the encoding
    // headers would make the outer client decode it a second time.
    headers.removeValue(forKey: "Content-Encoding")
    headers.removeValue(forKey: "Content-Length")
    let forwarded = HTTPURLResponse(url: http.url ?? request.url!, statusCode: http.statusCode, httpVersion: "HTTP/1.1", headerFields: headers) ?? http
    client?.urlProtocol(self, didReceive: forwarded, cacheStoragePolicy: .notAllowed)
    completionHandler(.allow)
  }

  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
    client?.urlProtocol(self, didLoad: data)
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    if let error {
      client?.urlProtocol(self, didFailWithError: error)
    } else {
      client?.urlProtocolDidFinishLoading(self)
    }
  }
}
