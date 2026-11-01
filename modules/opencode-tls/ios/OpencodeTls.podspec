Pod::Spec.new do |s|
  s.name = 'OpencodeTls'
  s.version = '1.0.0'
  s.summary = 'Per-connection custom CA trust for OpenCode Mobile.'
  s.description = s.summary
  s.license = 'Apache-2.0'
  s.author = 'OpenCode Mobile'
  s.homepage = 'https://getopencode.app'
  s.source = { :path => '.' }
  s.platform = :ios, '16.4'
  s.swift_version = '6.0'
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.dependency 'SocketRocket'
  s.source_files = '*.swift'
  s.preserve_paths = '*.h'
  s.pod_target_xcconfig = {
    'SWIFT_OBJC_BRIDGING_HEADER' => '${PODS_TARGET_SRCROOT}/OpencodeTls-Bridging-Header.h',
  }
end
