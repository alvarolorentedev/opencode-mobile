import CryptoKit
import Foundation
import Security

struct CertificateInfo {
  let pem: String
  let fingerprint: String
  let subject: String
  let issuer: String
  let notBefore: String
  let notAfter: String
  let kind: String
  let count: Int
  let certificates: [SecCertificate]
}

enum CertificateParserError: LocalizedError {
  case invalid
  case tooLarge
  case expired
  case notYetValid

  var errorDescription: String? {
    switch self {
    case .invalid: return "This is not a valid X.509 certificate."
    case .tooLarge: return "The certificate file is too large."
    case .expired: return "This certificate has expired."
    case .notYetValid: return "This certificate is not yet valid."
    }
  }
}

enum CertificateParser {
  static let maxBytes = 64 * 1024

  static func parseBase64(_ input: String) throws -> CertificateInfo {
    guard let data = Data(base64Encoded: input, options: .ignoreUnknownCharacters) else {
      throw CertificateParserError.invalid
    }
    return try parse(data: data)
  }

  static func parse(data: Data) throws -> CertificateInfo {
    guard data.count <= maxBytes else { throw CertificateParserError.tooLarge }
    let certificates: [SecCertificate]
    if let text = String(data: data, encoding: .utf8), text.contains("BEGIN CERTIFICATE") {
      certificates = try parsePem(text)
    } else if let certificate = SecCertificateCreateWithData(nil, data as CFData) {
      certificates = [certificate]
    } else {
      throw CertificateParserError.invalid
    }
    guard !certificates.isEmpty else { throw CertificateParserError.invalid }
    let now = Date()
    for certificate in certificates {
      if let after = dateValue(certificate, oid: kSecOIDX509V1ValidityNotAfter), after < now {
        throw CertificateParserError.expired
      }
      if let before = dateValue(certificate, oid: kSecOIDX509V1ValidityNotBefore), before > now {
        throw CertificateParserError.notYetValid
      }
    }
    let first = certificates[0]
    return CertificateInfo(
      pem: pem(from: certificates),
      fingerprint: fingerprint(first),
      subject: distinguishedName(first, oid: kSecOIDX509V1SubjectName) ?? (SecCertificateCopySubjectSummary(first) as String?) ?? "",
      issuer: distinguishedName(first, oid: kSecOIDX509V1IssuerName) ?? (SecCertificateCopySubjectSummary(first) as String?) ?? "",
      notBefore: iso(dateValue(first, oid: kSecOIDX509V1ValidityNotBefore) ?? Date()),
      notAfter: iso(dateValue(first, oid: kSecOIDX509V1ValidityNotAfter) ?? Date()),
      kind: kind(first),
      count: certificates.count,
      certificates: certificates
    )
  }

  static func parsePem(_ pem: String) throws -> [SecCertificate] {
    let pattern = "-----BEGIN CERTIFICATE-----([\\s\\S]*?)-----END CERTIFICATE-----"
    let regex = try NSRegularExpression(pattern: pattern)
    let range = NSRange(pem.startIndex..<pem.endIndex, in: pem)
    let matches = regex.matches(in: pem, range: range)
    guard !matches.isEmpty else { throw CertificateParserError.invalid }
    return try matches.map { match in
      guard let bodyRange = Range(match.range(at: 1), in: pem) else { throw CertificateParserError.invalid }
      let body = pem[bodyRange].components(separatedBy: .whitespacesAndNewlines).joined()
      guard let data = Data(base64Encoded: body, options: .ignoreUnknownCharacters),
            let certificate = SecCertificateCreateWithData(nil, data as CFData) else {
        throw CertificateParserError.invalid
      }
      return certificate
    }
  }

  static func pem(from certificates: [SecCertificate]) -> String {
    certificates.map { certificate in
      let data = SecCertificateCopyData(certificate) as Data
      let body = data.base64EncodedString(options: [.lineLength64Characters, .endLineWithLineFeed])
      return "-----BEGIN CERTIFICATE-----\n\(body)\n-----END CERTIFICATE-----"
    }.joined(separator: "\n")
  }

  static func fingerprint(_ certificate: SecCertificate) -> String {
    let data = SecCertificateCopyData(certificate) as Data
    return SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
  }

  private static func kind(_ certificate: SecCertificate) -> String {
    if let constraints = value(certificate, oid: kSecOIDBasicConstraints) as? String, constraints.contains("CA:TRUE") {
      return "ca"
    }
    let subject = SecCertificateCopyNormalizedSubjectSequence(certificate) as Data?
    let issuer = SecCertificateCopyNormalizedIssuerSequence(certificate) as Data?
    if let subject, let issuer, subject == issuer { return "self-signed" }
    return "server"
  }

  private static func value(_ certificate: SecCertificate, oid: CFString) -> Any? {
    guard let values = SecCertificateCopyValues(certificate, [oid] as CFArray, nil) as NSDictionary?,
          let entry = values[oid] as? NSDictionary else { return nil }
    return entry[kSecPropertyKeyValue]
  }

  private static func dateValue(_ certificate: SecCertificate, oid: CFString) -> Date? {
    guard let raw = value(certificate, oid: oid) else { return nil }
    if let date = raw as? Date { return date }
    if let number = raw as? NSNumber { return Date(timeIntervalSinceReferenceDate: number.doubleValue) }
    return nil
  }

  private static func distinguishedName(_ certificate: SecCertificate, oid: CFString) -> String? {
    guard let entries = value(certificate, oid: oid) as? [NSDictionary] else { return nil }
    let parts = entries.compactMap { entry -> String? in
      let label = entry[kSecPropertyKeyLabel] as? String
      let value = entry[kSecPropertyKeyValue] as? String
      guard let value else { return nil }
      return label.map { "\($0)=\(value)" } ?? value
    }
    return parts.isEmpty ? nil : parts.joined(separator: ", ")
  }

  private static func iso(_ date: Date) -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime]
    return formatter.string(from: date)
  }
}
