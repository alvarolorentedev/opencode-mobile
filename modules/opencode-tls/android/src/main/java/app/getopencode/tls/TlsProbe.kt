package app.getopencode.tls

import java.net.InetSocketAddress
import java.net.SocketTimeoutException
import java.net.URI
import java.security.cert.CertPathValidatorException
import java.security.cert.CertificateExpiredException
import java.security.cert.CertificateNotYetValidException
import javax.net.ssl.SNIHostName
import javax.net.ssl.SNIServerName
import javax.net.ssl.SSLHandshakeException
import javax.net.ssl.SSLPeerUnverifiedException
import javax.net.ssl.SSLSocket

object TlsProbe {
  private const val TIMEOUT_MS = 5000

  fun probe(origin: String, pem: String?): ProbeResult {
    val uri = try {
      URI("https://$origin")
    } catch (_: Exception) {
      return ProbeResult().apply { reason = "network" }
    }
    val host = uri.host?.removeSurrounding("[", "]") ?: return ProbeResult().apply { reason = "network" }
    val port = if (uri.port > 0) uri.port else 443
    val certificates = try {
      pem?.let { CertificateParser.parsePem(it) } ?: emptyList()
    } catch (error: Exception) {
      return ProbeResult().apply {
        reason = "invalid"
        message = error.message
      }
    }
    val context = when {
      certificates.isNotEmpty() -> TrustStore.contextForCertificates(certificates)
      else -> TrustStore.contextFor(origin) ?: TrustStore.systemContext()
    }
    var socket: SSLSocket? = null
    return try {
      socket = context.socketFactory.createSocket() as SSLSocket
      socket.connect(InetSocketAddress(host, port), TIMEOUT_MS)
      socket.soTimeout = TIMEOUT_MS
      val parameters = socket.sslParameters
      parameters.endpointIdentificationAlgorithm = "HTTPS"
      if (host.any { it.isLetter() }) parameters.serverNames = listOf<SNIServerName>(SNIHostName(host))
      socket.sslParameters = parameters
      socket.startHandshake()
      ProbeResult().apply {
        ok = true
        reason = "ok"
      }
    } catch (error: SSLHandshakeException) {
      ProbeResult().apply {
        reason = classify(error)
        message = error.message
      }
    } catch (error: SSLPeerUnverifiedException) {
      ProbeResult().apply {
        reason = "hostname-mismatch"
        message = error.message
      }
    } catch (error: SocketTimeoutException) {
      ProbeResult().apply {
        reason = "network"
        message = error.message
      }
    } catch (error: Exception) {
      ProbeResult().apply {
        reason = "network"
        message = error.message
      }
    } finally {
      try {
        socket?.close()
      } catch (_: Exception) {
        // Best-effort cleanup.
      }
    }
  }

  private fun classify(error: SSLHandshakeException): String {
    var cause: Throwable? = error
    while (cause != null) {
      when (cause) {
        is CertificateExpiredException, is CertificateNotYetValidException -> return "expired"
        is CertPathValidatorException -> {
          val reason = cause.reason
          if (reason == CertPathValidatorException.BasicReason.EXPIRED || reason == CertPathValidatorException.BasicReason.NOT_YET_VALID) return "expired"
          if (cause.message?.contains("Trust anchor", ignoreCase = true) == true) return "untrusted"
        }
      }
      if (cause.message?.contains("hostname", ignoreCase = true) == true) return "hostname-mismatch"
      if (cause.message?.contains("expired", ignoreCase = true) == true) return "expired"
      if (cause.message?.contains("Trust anchor", ignoreCase = true) == true) return "untrusted"
      cause = cause.cause
    }
    return "untrusted"
  }
}
