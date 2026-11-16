Pod::Spec.new do |s|
  s.name = 'OpencodeActivity'
  s.version = '1.0.0'
  s.summary = 'Opt-in local OpenCode Live Activities without an App Group.'
  s.description = s.summary
  s.license = 'Apache-2.0'
  s.author = 'OpenCode Mobile'
  s.homepage = 'https://getopencode.app'
  s.source = { :path => '.' }
  s.platform = :ios, '16.4'
  s.swift_version = '5.0'
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  # The standalone WidgetKit entrypoint is copied by the opt-in CNG plugin,
  # never compiled into the application pod.
  s.source_files = '*.swift'
  s.frameworks = 'ActivityKit', 'UIKit'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
end
