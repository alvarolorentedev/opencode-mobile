package app.getopencode.tls

import android.util.Base64
import java.io.ByteArrayInputStream
import java.security.MessageDigest
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

data class ParsedCertificate(
  val pem: String,
  val fingerprint: String,
  val subject: String,
  val issuer: String,
  val notBefore: String,
  val notAfter: String,
  val kind: String,
  val count: Int,
  val certificates: List<X509Certificate>,
)

object CertificateParser {
  private const val MAX_BYTES = 64 * 1024

  fun parseBase64(input: String): ParsedCertificate {
    val bytes = try {
      Base64.decode(input, Base64.DEFAULT)
    } catch (_: Exception) {
      throw IllegalArgumentException("This is not a valid X.509 certificate.")
    }
    return parseBytes(bytes)
  }

  fun parsePem(pem: String): List<X509Certificate> = parseCertificates(pem.toByteArray(Charsets.UTF_8))

  fun parseBytes(bytes: ByteArray): ParsedCertificate {
    if (bytes.size > MAX_BYTES) throw IllegalArgumentException("The certificate file is too large.")
    val certificates = parseCertificates(bytes)
    if (certificates.isEmpty()) throw IllegalArgumentException("This is not a valid X.509 certificate.")
    val now = System.currentTimeMillis()
    for (certificate in certificates) {
      if (certificate.notAfter.time < now) throw IllegalArgumentException("This certificate has expired.")
      if (certificate.notBefore.time > now) throw IllegalArgumentException("This certificate is not yet valid.")
    }
    val first = certificates.first()
    val kind = when {
      first.basicConstraints >= 0 -> "ca"
      first.subjectX500Principal == first.issuerX500Principal -> "self-signed"
      else -> "server"
    }
    return ParsedCertificate(
      pem = normalizePem(certificates),
      fingerprint = fingerprint(first),
      subject = first.subjectX500Principal.name,
      issuer = first.issuerX500Principal.name,
      notBefore = iso(first.notBefore),
      notAfter = iso(first.notAfter),
      kind = kind,
      count = certificates.size,
      certificates = certificates,
    )
  }

  private fun parseCertificates(bytes: ByteArray): List<X509Certificate> {
    val factory = CertificateFactory.getInstance("X.509")
    return try {
      factory.generateCertificates(ByteArrayInputStream(bytes)).mapNotNull { it as? X509Certificate }
    } catch (_: Exception) {
      throw IllegalArgumentException("This is not a valid X.509 certificate.")
    }
  }

  fun normalizePem(certificates: List<X509Certificate>): String = certificates.joinToString("\n") { certificate ->
    val encoded = Base64.encodeToString(certificate.encoded, Base64.NO_WRAP)
    "-----BEGIN CERTIFICATE-----\n" + encoded.chunked(64).joinToString("\n") + "\n-----END CERTIFICATE-----"
  }

  fun fingerprint(certificate: X509Certificate): String =
    MessageDigest.getInstance("SHA-256").digest(certificate.encoded).joinToString("") { "%02x".format(it.toInt() and 0xff) }

  private fun iso(date: Date): String {
    val format = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US)
    format.timeZone = TimeZone.getTimeZone("UTC")
    return format.format(date)
  }
}
