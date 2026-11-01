package app.getopencode.tls

import java.net.InetAddress
import java.net.Socket
import javax.net.ssl.SSLSocketFactory

class HostTrustSocketFactory(private val fallback: SSLSocketFactory) : SSLSocketFactory() {
  override fun getDefaultCipherSuites(): Array<String> = fallback.defaultCipherSuites
  override fun getSupportedCipherSuites(): Array<String> = fallback.supportedCipherSuites

  override fun createSocket(socket: Socket, host: String, port: Int, autoClose: Boolean): Socket =
    (TrustStore.contextFor(TrustStore.originKey(host, port))?.socketFactory ?: fallback)
      .createSocket(socket, host, port, autoClose)

  override fun createSocket(host: String, port: Int): Socket =
    (TrustStore.contextFor(TrustStore.originKey(host, port))?.socketFactory ?: fallback)
      .createSocket(host, port)

  override fun createSocket(host: String, port: Int, localHost: InetAddress, localPort: Int): Socket =
    (TrustStore.contextFor(TrustStore.originKey(host, port))?.socketFactory ?: fallback)
      .createSocket(host, port, localHost, localPort)

  override fun createSocket(host: InetAddress, port: Int): Socket =
    (TrustStore.contextFor(TrustStore.originKey(host.hostAddress.orEmpty(), port))?.socketFactory ?: fallback)
      .createSocket(host, port)

  override fun createSocket(address: InetAddress, port: Int, localAddress: InetAddress, localPort: Int): Socket =
    (TrustStore.contextFor(TrustStore.originKey(address.hostAddress.orEmpty(), port))?.socketFactory ?: fallback)
      .createSocket(address, port, localAddress, localPort)
}
