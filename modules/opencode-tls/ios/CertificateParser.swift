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

/// Minimal DER reader for the X.509 fields the app displays.
///
/// `SecCertificateCopyValues` and the `kSecOID*`/`kSecPropertyKey*` constants
/// are macOS-only, so validity dates, distinguished names and the CA flag are
/// read from `SecCertificateCopyData` here. Anything structurally unexpected
/// throws `.invalid`, matching the Android parser's rejection behavior.
private struct DERReader {
  let bytes: [UInt8]
  var offset: Int

  init(_ data: Data) {
    self.bytes = [UInt8](data)
    self.offset = 0
  }

  var isAtEnd: Bool { offset >= bytes.count }

  mutating func readByte() throws -> UInt8 {
    guard offset < bytes.count else { throw CertificateParserError.invalid }
    defer { offset += 1 }
    return bytes[offset]
  }

  mutating func readLength() throws -> Int {
    let first = try readByte()
    if first & 0x80 == 0 { return Int(first) }
    let count = Int(first & 0x7F)
    guard count > 0, count <= 4 else { throw CertificateParserError.invalid }
    var length = 0
    for _ in 0..<count {
      length = (length << 8) | Int(try readByte())
    }
    guard length >= 0, offset + length <= bytes.count else { throw CertificateParserError.invalid }
    return length
  }

  mutating func readTLV() throws -> (tag: UInt8, content: Data) {
    let tag = try readByte()
    let length = try readLength()
    let content = Data(bytes[offset ..< offset + length])
    offset += length
    return (tag, content)
  }

  mutating func readSequenceContent() throws -> DERReader {
    let (tag, content) = try readTLV()
    guard tag == 0x30 else { throw CertificateParserError.invalid }
    return DERReader(content)
  }

  mutating func readChildren() throws -> [(tag: UInt8, content: Data)] {
    var children: [(tag: UInt8, content: Data)] = []
    while !isAtEnd {
      children.append(try readTLV())
    }
    return children
  }
}

private func oidString(_ content: Data) -> String {
  let bytes = [UInt8](content)
  guard !bytes.isEmpty else { return "" }
  var numbers: [UInt32] = [UInt32(bytes[0] / 40), UInt32(bytes[0] % 40)]
  var value: UInt32 = 0
  for byte in bytes.dropFirst() {
    value = (value << 7) | UInt32(byte & 0x7F)
    if byte & 0x80 == 0 {
      numbers.append(value)
      value = 0
    }
  }
  return numbers.map(String.init).joined(separator: ".")
}

private func dnAttributeName(oid: String) -> String {
  switch oid {
  case "2.5.4.3": return "CN"
  case "2.5.4.4": return "SN"
  case "2.5.4.5": return "SERIALNUMBER"
  case "2.5.4.6": return "C"
  case "2.5.4.7": return "L"
  case "2.5.4.8": return "ST"
  case "2.5.4.9": return "STREET"
  case "2.5.4.10": return "O"
  case "2.5.4.11": return "OU"
  case "2.5.4.12": return "TITLE"
  case "2.5.4.42": return "GN"
  case "2.5.4.43": return "INITIALS"
  case "1.2.840.113549.1.9.1": return "E"
  case "0.9.2342.19200300.100.1.25": return "DC"
  case "0.9.2342.19200300.100.1.1": return "UID"
  default: return oid
  }
}

private func dnStringValue(tag: UInt8, content: Data) -> String {
  switch tag {
  case 0x13, 0x16, 0x0C, 0x14: // PrintableString, IA5String, UTF8String, TeletexString
    if let text = String(data: content, encoding: .utf8), !text.isEmpty { return text }
    if let text = String(data: content, encoding: .isoLatin1) { return text }
    return content.map { String(format: "%02x", $0) }.joined()
  case 0x1E: // BMPString (UTF-16BE)
    if let text = String(data: content, encoding: .utf16BigEndian) { return text }
    return content.map { String(format: "%02x", $0) }.joined()
  default:
    return content.map { String(format: "%02x", $0) }.joined()
  }
}

private func parseDistinguishedName(_ content: Data) throws -> (display: String, raw: Data) {
  var reader = DERReader(content)
  let rdns = try reader.readChildren()
  var parts: [String] = []
  for rdn in rdns {
    guard rdn.tag == 0x31 else { throw CertificateParserError.invalid }
    var setReader = DERReader(rdn.content)
    for atv in try setReader.readChildren() {
      guard atv.tag == 0x30 else { throw CertificateParserError.invalid }
      var atvReader = DERReader(atv.content)
      let atvChildren = try atvReader.readChildren()
      guard atvChildren.count == 2, atvChildren[0].tag == 0x06 else {
        throw CertificateParserError.invalid
      }
      let name = dnAttributeName(oid: oidString(atvChildren[0].content))
      let value = dnStringValue(tag: atvChildren[1].tag, content: atvChildren[1].content)
      parts.append("\(name)=\(value)")
    }
  }
  return (parts.joined(separator: ", "), content)
}

private func parseTime(tag: UInt8, content: Data) throws -> Date {
  guard let text = String(data: content, encoding: .ascii) else {
    throw CertificateParserError.invalid
  }
  let yearLength: Int
  if tag == 0x17 { // UTCTime YYMMDDHHMMSS
    yearLength = 2
  } else if tag == 0x18 { // GeneralizedTime YYYYMMDDHHMMSS
    yearLength = 4
  } else {
    throw CertificateParserError.invalid
  }
  // Seconds are always present in certificate validity; skip fractions/offsets.
  let minimum = yearLength + 10
  guard text.count >= minimum else { throw CertificateParserError.invalid }
  let head = String(text.prefix(minimum))
  guard head.allSatisfy({ $0.isASCII && $0.isNumber }) else { throw CertificateParserError.invalid }
  guard let yearDigits = Int(String(head.prefix(yearLength))),
        let month = Int(String(head.dropFirst(yearLength).prefix(2))),
        let day = Int(String(head.dropFirst(yearLength + 2).prefix(2))),
        let hour = Int(String(head.dropFirst(yearLength + 4).prefix(2))),
        let minute = Int(String(head.dropFirst(yearLength + 6).prefix(2))),
        let second = Int(String(head.dropFirst(yearLength + 8).prefix(2))) else {
    throw CertificateParserError.invalid
  }
  var year = yearDigits
  if yearLength == 2 { year += year >= 50 ? 1900 : 2000 }
  guard (1 ... 12).contains(month), (1 ... 31).contains(day),
        hour < 24, minute < 60, second <= 60 else {
    throw CertificateParserError.invalid
  }
  var components = DateComponents()
  components.calendar = Calendar(identifier: .gregorian)
  components.timeZone = TimeZone(secondsFromGMT: 0)
  components.year = year
  components.month = month
  components.day = day
  components.hour = hour
  components.minute = minute
  components.second = second
  guard let date = components.date else { throw CertificateParserError.invalid }
  return date
}

private struct TbsInfo {
  let issuerDisplay: String
  let issuerRaw: Data
  let subjectDisplay: String
  let subjectRaw: Data
  let notBefore: Date
  let notAfter: Date
  let isCA: Bool
}

private func parseTbs(_ der: Data) throws -> TbsInfo {
  var root = DERReader(der)
  var tbs = try root.readSequenceContent()
  let fields = try tbs.readChildren()
  var cursor = 0
  if cursor < fields.count, fields[cursor].tag == 0xA0 { cursor += 1 } // version
  cursor += 2 // serialNumber, signature
  guard cursor + 2 < fields.count,
        fields[cursor].tag == 0x30,
        fields[cursor + 1].tag == 0x30,
        fields[cursor + 2].tag == 0x30 else {
    throw CertificateParserError.invalid
  }
  let (issuerDisplay, issuerRaw) = try parseDistinguishedName(fields[cursor].content)
  var validityReader = DERReader(fields[cursor + 1].content)
  let validity = try validityReader.readChildren()
  guard validity.count == 2 else { throw CertificateParserError.invalid }
  let notBefore = try parseTime(tag: validity[0].tag, content: validity[0].content)
  let notAfter = try parseTime(tag: validity[1].tag, content: validity[1].content)
  let (subjectDisplay, subjectRaw) = try parseDistinguishedName(fields[cursor + 2].content)
  var isCA = false
  for field in fields.dropFirst(cursor + 3) {
    guard field.tag == 0xA3 else { continue } // extensions [3]
    var extensionsReader = DERReader(field.content)
    var extensionsSequence = try extensionsReader.readSequenceContent()
    for entry in try extensionsSequence.readChildren() {
      guard entry.tag == 0x30 else { continue }
      var extensionReader = DERReader(entry.content)
      let parts = try extensionReader.readChildren()
      guard parts.count >= 2, parts[0].tag == 0x06 else { continue }
      guard [UInt8](parts[0].content) == [0x55, 0x1D, 0x13] else { continue } // 2.5.29.19 basicConstraints
      let valuePart = parts.last!
      guard valuePart.tag == 0x04 else { continue }
      var constraintsReader = DERReader(valuePart.content)
      var constraintsSequence = try constraintsReader.readSequenceContent()
      for child in try constraintsSequence.readChildren() {
        if child.tag == 0x01, let flag = child.content.first {
          isCA = flag != 0
        }
      }
    }
  }
  return TbsInfo(
    issuerDisplay: issuerDisplay,
    issuerRaw: issuerRaw,
    subjectDisplay: subjectDisplay,
    subjectRaw: subjectRaw,
    notBefore: notBefore,
    notAfter: notAfter,
    isCA: isCA
  )
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
    let infos = try certificates.map { certificate -> TbsInfo in
      let der = SecCertificateCopyData(certificate) as Data
      return try parseTbs(der)
    }
    for info in infos {
      if info.notAfter < now { throw CertificateParserError.expired }
      if info.notBefore > now { throw CertificateParserError.notYetValid }
    }
    let first = infos[0]
    let kind: String
    if first.isCA {
      kind = "ca"
    } else if first.subjectRaw == first.issuerRaw {
      kind = "self-signed"
    } else {
      kind = "server"
    }
    return CertificateInfo(
      pem: pem(from: certificates),
      fingerprint: fingerprint(certificates[0]),
      subject: first.subjectDisplay,
      issuer: first.issuerDisplay,
      notBefore: iso(first.notBefore),
      notAfter: iso(first.notAfter),
      kind: kind,
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

  private static func iso(_ date: Date) -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime]
    return formatter.string(from: date)
  }
}
