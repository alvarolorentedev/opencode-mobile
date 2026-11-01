package app.getopencode.tls

import com.facebook.react.modules.network.OkHttpClientProvider
import java.security.KeyStore
import java.security.cert.X509Certificate
import java.util.concurrent.ConcurrentHashMap
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLSocketFactory
import javax.net.ssl.TrustManagerFactory
import javax.net.ssl.X509TrustManager

object TrustStore {
  private val anchors = ConcurrentHashMap<String, List<X509Certificate>>()
  private val contexts = ConcurrentHashMap<String, SSLContext>()
  private val system: X509TrustManager = defaultTrustManager()
  private val defaultFactory: SSLSocketFactory = SSLContext.getInstance("TLS").apply { init(null, null, null) }.socketFactory

  val socketFactory: HostTrustSocketFactory by lazy { HostTrustSocketFactory(defaultFactory) }

  fun originKey(host: String, port: Int): String {
    val normalized = if (host.contains(':') && !host.startsWith("[")) "[$host]" else host
    return "$normalized:$port"
  }

  fun set(origin: String, certificates: List<X509Certificate>) {
    anchors[origin] = certificates
    contexts.clear()
    evictConnections()
  }

  fun clear(origin: String) {
    anchors.remove(origin)
    contexts.clear()
    evictConnections()
  }

  fun contextFor(origin: String): SSLContext? {
    val certificates = anchors[origin] ?: return null
    if (certificates.isEmpty()) return null
    return contexts.getOrPut(origin) { buildContext(certificates) }
  }

  fun contextForCertificates(certificates: List<X509Certificate>): SSLContext = buildContext(certificates)

  fun systemContext(): SSLContext = SSLContext.getInstance("TLS").apply {
    init(null, arrayOf(HostTrustManager(system, null, emptyList())), null)
  }

  fun combinedTrustManager(): X509TrustManager {
    val union = anchors.values.flatten().distinctBy { it.encoded.contentToString() }
    return HostTrustManager(system, customTrustManager(union), union)
  }

  fun defaultSocketFactory(): SSLSocketFactory = defaultFactory

  private fun buildContext(certificates: List<X509Certificate>): SSLContext {
    val trustManager = HostTrustManager(system, customTrustManager(certificates), certificates)
    return SSLContext.getInstance("TLS").apply {
      init(null, arrayOf(trustManager), null)
    }
  }

  private fun customTrustManager(certificates: List<X509Certificate>): X509TrustManager? {
    if (certificates.isEmpty()) return null
    return try {
      val keyStore = KeyStore.getInstance(KeyStore.getDefaultType())
      keyStore.load(null, null)
      certificates.forEachIndexed { index, certificate ->
        keyStore.setCertificateEntry("opencode-ca-$index", certificate)
      }
      val factory = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm())
      factory.init(keyStore)
      factory.trustManagers.filterIsInstance<X509TrustManager>().firstOrNull()
    } catch (_: Exception) {
      null
    }
  }

  private fun defaultTrustManager(): X509TrustManager {
    val factory = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm())
    factory.init(null as KeyStore?)
    return factory.trustManagers.filterIsInstance<X509TrustManager>().first()
  }

  private fun evictConnections() {
    try {
      OkHttpClientProvider.getOkHttpClient().connectionPool.evictAll()
    } catch (_: Exception) {
      // A client may not exist yet; the next request creates one with the
      // current trust configuration.
    }
  }
}
