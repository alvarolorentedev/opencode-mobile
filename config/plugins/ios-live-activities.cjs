const fs = require('node:fs');
const path = require('node:path');
const plist = require('@expo/plist').default;
const { IOSConfig, withInfoPlist, withXcodeProject } = require('@expo/config-plugins');

const targetName = 'OpencodeLiveActivity';
const swiftFiles = ['OpencodeActivityAttributes.swift', 'OpencodeLiveActivity.swift'];

function writeExtension(config) {
  const destination = path.join(config.modRequest.platformProjectRoot, targetName);
  const source = path.join(path.dirname(require.resolve('../../modules/opencode-activity/expo-module.config.json')), 'ios');
  fs.mkdirSync(destination, { recursive: true });
  fs.copyFileSync(path.join(source, swiftFiles[0]), path.join(destination, swiftFiles[0]));
  fs.copyFileSync(path.join(source, 'LiveActivity', swiftFiles[1]), path.join(destination, swiftFiles[1]));
  fs.writeFileSync(path.join(destination, 'Info.plist'), plist.build({
    CFBundleDisplayName: 'OpenCode',
    CFBundleName: '$(PRODUCT_NAME)',
    CFBundleExecutable: '$(EXECUTABLE_NAME)',
    CFBundleIdentifier: '$(PRODUCT_BUNDLE_IDENTIFIER)',
    CFBundlePackageType: 'XPC!',
    CFBundleShortVersionString: '$(MARKETING_VERSION)',
    CFBundleVersion: '$(CURRENT_PROJECT_VERSION)',
    NSExtension: { NSExtensionPointIdentifier: 'com.apple.widgetkit-extension' },
    NSSupportsLiveActivities: true,
  }));
}

function extensionTarget(project, main) {
  const section = project.pbxNativeTargetSection();
  const existing = Object.entries(section).find(([key, value]) =>
    !key.endsWith('_comment') && IOSConfig.XcodeUtils.unquote(value.name) === targetName);
  if (existing) return { uuid: existing[0], target: existing[1] };

  // xcode's verified addTarget API creates the dependency and an embed phase.
  // It assumes the first target is the app, as does the Expo CNG template.
  if (project.getFirstTarget().uuid !== main.uuid) {
    throw new Error('Live Activities require the CNG application to be the first Xcode target.');
  }
  // The CNG single-target template omits these sections; xcode otherwise
  // silently skips creating its dependency/proxy objects.
  project.hash.project.objects.PBXTargetDependency ||= {};
  project.hash.project.objects.PBXContainerItemProxy ||= {};
  const before = new Set(main.target.buildPhases.map((phase) => phase.value));
  const added = project.addTarget(targetName, 'app_extension', targetName);
  const phases = project.hash.project.objects.PBXCopyFilesBuildPhase;
  const embedReference = main.target.buildPhases.find((phase) => !before.has(phase.value) && phases[phase.value]);
  const embed = phases[embedReference.value];
  const product = Object.entries(project.pbxBuildFileSection()).find(([key, value]) =>
    !key.endsWith('_comment') && value.fileRef === added.pbxNativeTarget.productReference);

  // addTarget can put the product in a pre-existing "Copy Files" phase.
  // Move only our product into the new, application-owned extension phase.
  for (const [key, phase] of Object.entries(phases)) {
    if (!key.endsWith('_comment')) phase.files = phase.files.filter((file) => file.value !== product[0]);
  }
  embed.name = '"Embed App Extensions"';
  embedReference.comment = 'Embed App Extensions';
  phases[`${embedReference.value}_comment`] = 'Embed App Extensions';
  embed.files = [{ value: product[0], comment: `${targetName}.appex in Embed App Extensions` }];
  product[1].settings = { ATTRIBUTES: ['CodeSignOnCopy', 'RemoveHeadersOnCopy'] };
  return { uuid: added.uuid, target: added.pbxNativeTarget };
}

function configureProject(config) {
  const project = config.modResults;
  const main = project.getTarget('com.apple.product-type.application');
  if (!main || !config.ios?.bundleIdentifier) throw new Error('Live Activities require an iOS app bundle identifier.');
  const extension = extensionTarget(project, main);
  const utils = IOSConfig.XcodeUtils;
  const mainConfigurations = utils.getBuildConfigurationsForListId(project, main.target.buildConfigurationList);
  const configurations = utils.getBuildConfigurationsForListId(project, extension.target.buildConfigurationList);
  for (const [, configuration] of configurations) {
    const parent = mainConfigurations.find(([, entry]) => entry.name === configuration.name)?.[1].buildSettings || {};
    Object.assign(configuration.buildSettings, {
      PRODUCT_BUNDLE_IDENTIFIER: `"${config.ios.bundleIdentifier}.LiveActivity"`,
      PRODUCT_NAME: `"${targetName}"`,
      INFOPLIST_FILE: `"${targetName}/Info.plist"`,
      GENERATE_INFOPLIST_FILE: 'NO',
      IPHONEOS_DEPLOYMENT_TARGET: '17.0',
      SWIFT_VERSION: '5.0',
      SWIFT_EMIT_LOC_STRINGS: 'NO',
      TARGETED_DEVICE_FAMILY: '"1,2"',
      SUPPORTED_PLATFORMS: '"iphoneos iphonesimulator"',
      SUPPORTS_MACCATALYST: 'NO',
      APPLICATION_EXTENSION_API_ONLY: 'YES',
      SKIP_INSTALL: 'YES',
      CODE_SIGN_STYLE: parent.CODE_SIGN_STYLE || 'Automatic',
      CURRENT_PROJECT_VERSION: `"${config.ios.buildNumber || '1'}"`,
      MARKETING_VERSION: `"${config.version || '1.0.0'}"`,
    });
    const team = config.ios.appleTeamId || parent.DEVELOPMENT_TEAM;
    if (team) configuration.buildSettings.DEVELOPMENT_TEAM = team;
  }

  if (!extension.target.buildPhases.some((phase) => phase.comment === 'Sources')) {
    project.addBuildPhase([], 'PBXSourcesBuildPhase', 'Sources', extension.uuid);
  }
  if (!extension.target.buildPhases.some((phase) => phase.comment === 'Frameworks')) {
    project.addBuildPhase([], 'PBXFrameworksBuildPhase', 'Frameworks', extension.uuid);
  }
  utils.ensureGroupRecursively(project, targetName);
  for (const filename of swiftFiles) {
    utils.addBuildSourceFileToGroup({
      project, filepath: `${targetName}/${filename}`, groupName: targetName, targetUuid: extension.uuid,
    });
  }
  return config;
}

// The app config owns EXPO_IOS_LIVE_ACTIVITIES=1 gating. This plugin has only
// iOS mods and introduces no entitlements, shared container, or background mode.
function withIOSLiveActivities(config) {
  config = withInfoPlist(config, (mod) => {
    mod.modResults.NSSupportsLiveActivities = true;
    mod.modResults.OpencodeLiveActivitiesEnabled = true;
    return mod;
  });
  return withXcodeProject(config, (mod) => {
    writeExtension(mod);
    return configureProject(mod);
  });
}

module.exports = { withIOSLiveActivities };
