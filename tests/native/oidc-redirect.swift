import Foundation

private final class RedirectClient: NSObject, URLProtocolClient, @unchecked Sendable {
  var failures = 0
  func urlProtocol(_ protocol: URLProtocol, didFailWithError error: Error) { failures += 1 }
  func urlProtocol(_ protocol: URLProtocol, wasRedirectedTo request: URLRequest, redirectResponse: URLResponse) {}
  func urlProtocol(_ protocol: URLProtocol, cachedResponseIsValid cachedResponse: CachedURLResponse) {}
  func urlProtocol(_ protocol: URLProtocol, didReceive response: URLResponse, cacheStoragePolicy policy: URLCache.StoragePolicy) {}
  func urlProtocol(_ protocol: URLProtocol, didLoad data: Data) {}
  func urlProtocolDidFinishLoading(_ protocol: URLProtocol) {}
  func urlProtocol(_ protocol: URLProtocol, didReceive challenge: URLAuthenticationChallenge) {}
  func urlProtocol(_ protocol: URLProtocol, didCancel challenge: URLAuthenticationChallenge) {}
}

@main enum OidcRedirectChecks {
  static func main() {
    for follow in [false, true] {
      let original = NSMutableURLRequest(url: URL(string: "https://server.test/api/info")!)
      URLProtocol.setProperty(follow, forKey: "shouldFollowRedirects", in: original)
      let client = RedirectClient()
      let owner = OpencodeTlsURLProtocol(request: original as URLRequest, cachedResponse: nil, client: client)
      let delegate = TlsSessionDelegate(owner: owner, origin: "server.test:443", fallbackURL: original.url)
      for destination in ["https://other.test/capture", "http://server.test/capture"] {
        let redirected = URLRequest(url: URL(string: destination)!)
        let response = HTTPURLResponse(url: original.url!, statusCode: 307, httpVersion: "HTTP/1.1", headerFields: ["Location": destination])!
        let task = URLSession.shared.dataTask(with: original as URLRequest)
        var sent = false
        delegate.urlSession(URLSession.shared, task: task, willPerformHTTPRedirection: response, newRequest: redirected) { sent = $0 != nil }
        precondition(sent == follow, "Custom-CA redirect policy was not preserved")
        task.cancel()
      }
      precondition(client.failures == (follow ? 0 : 2), "Redirect rejection was not delivered")
    }
    print("Custom-CA redirect rejection and legacy follow policy passed")
  }
}
