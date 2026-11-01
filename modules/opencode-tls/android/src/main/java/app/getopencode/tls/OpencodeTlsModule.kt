package app.getopencode.tls

import com.facebook.react.modules.network.NetworkingModule
import com.facebook.react.modules.network.OkHttpClientProvider
import com.facebook.react.modules.websocket.WebSocketModule
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

class CertificateInfo : Record {
  @Field var pem: String = ""
  @Field var fingerprint: String = ""
  @Field var subject: String = ""
  @Field var issuer: String = ""
  @Field var notBefore: String = ""
  @Field var notAfter: String = ""
  @Field var kind: String = "ca"
  @Field var count: Int = 1
}

class ProbeResult : Record {
  @Field var ok: Boolean = false
  @Field var reason: String = "network"
  @Field var message: String? = null
}

class OpencodeTlsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("OpencodeTls")

    OnCreate {
      val socketFactory = TrustStore.socketFactory
      val trustManager = TrustStore.combinedTrustManager()
      NetworkingModule.setCustomClientBuilder { builder ->
        builder.sslSocketFactory(socketFactory, trustManager)
      }
      WebSocketModule.setCustomClientBuilder { builder ->
        builder.sslSocketFactory(socketFactory, trustManager)
      }
      OkHttpClientProvider.setOkHttpClientFactory {
        OkHttpClientProvider.createClientBuilder()
          .sslSocketFactory(socketFactory, trustManager)
          .build()
      }
    }

    AsyncFunction("importCertificate") { input: String ->
      val parsed = CertificateParser.parseBase64(input)
      CertificateInfo().apply {
        pem = parsed.pem
        fingerprint = parsed.fingerprint
        subject = parsed.subject
        issuer = parsed.issuer
        notBefore = parsed.notBefore
        notAfter = parsed.notAfter
        kind = parsed.kind
        count = parsed.count
      }
    }

    AsyncFunction("setTrustAnchors") { origin: String, pems: List<String> ->
      val certificates = pems.flatMap { CertificateParser.parsePem(it) }
      TrustStore.set(origin, certificates)
    }

    AsyncFunction("clearTrustAnchors") { origin: String ->
      TrustStore.clear(origin)
    }

    AsyncFunction("probe") { origin: String, pem: String? ->
      TlsProbe.probe(origin, pem)
    }
  }
}
