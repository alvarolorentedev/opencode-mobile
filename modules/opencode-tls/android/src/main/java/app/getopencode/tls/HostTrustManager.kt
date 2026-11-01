package app.getopencode.tls

import java.net.Socket
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import javax.net.ssl.SSLEngine
import javax.net.ssl.X509ExtendedTrustManager
import javax.net.ssl.X509TrustManager

class HostTrustManager(
  private val system: X509TrustManager,
  private val custom: X509TrustManager?,
  private val anchors: List<X509Certificate>,
) : X509ExtendedTrustManager() {
  private fun accept(chain: Array<X509Certificate>, authType: String) {
    try {
      system.checkServerTrusted(chain, authType)
      return
    } catch (_: CertificateException) {
      // Fall through to the imported anchors.
    }
    if (custom != null) {
      try {
        custom.checkServerTrusted(chain, authType)
        return
      } catch (_: CertificateException) {
        // Fall through to an exact leaf anchor match.
      }
    }
    // Self-signed and non-CA leaf anchors may not build a PKIX chain. Accept
    // the exact leaf only after its validity window has been checked.
    if (chain.isNotEmpty() && anchors.any { it.encoded.contentEquals(chain[0].encoded) }) {
      chain[0].checkValidity()
      return
    }
    throw CertificateException("Trust anchor for certification path not found.")
  }

  override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) = system.checkClientTrusted(chain, authType)
  override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) = accept(chain, authType)
  override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String, socket: Socket?) = system.checkClientTrusted(chain, authType)
  override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String, socket: Socket?) = accept(chain, authType)
  override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String, engine: SSLEngine?) = system.checkClientTrusted(chain, authType)
  override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String, engine: SSLEngine?) = accept(chain, authType)
  override fun getAcceptedIssuers(): Array<X509Certificate> =
    system.acceptedIssuers + (custom?.acceptedIssuers ?: emptyArray<X509Certificate>())
}
