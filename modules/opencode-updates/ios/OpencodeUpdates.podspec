Pod::Spec.new do |s|
  s.name = 'OpencodeUpdates'
  s.version = '1.0.0'
  s.summary = 'Read-only App Store installation classification for OpenCode Mobile'
  s.description = s.summary
  s.license = 'Apache-2.0'
  s.author = 'OpenCode Mobile'
  s.homepage = 'https://getopencode.app'
  s.source = { :path => '.' }
  s.platform = :ios, '16.4'
  s.swift_version = '6.0'
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.swift'
end
