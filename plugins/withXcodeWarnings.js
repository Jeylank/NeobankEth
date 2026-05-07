const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

// Xcode 26 defaults to Swift 6 language mode where non-exhaustive switches
// on non-frozen Apple enums are HARD ERRORS (not warnings). Pinning pods to
// Swift 5 mode keeps the old behaviour (warning, suppressible) and lets the
// build pass while Expo/RN upstream catch up to the iOS 26 SDK changes.
const POST_INSTALL_HOOK = `
  installer.pods_project.targets.each do |target|
    target.build_configurations.each do |config|
      # Pin all pods to Swift 5 language mode so non-exhaustive switch
      # statements on non-frozen Apple enums remain warnings, not errors.
      config.build_settings['SWIFT_VERSION'] = '5'
      # Belt-and-suspenders: also disable warnings-as-errors.
      config.build_settings['SWIFT_TREAT_WARNINGS_AS_ERRORS'] = 'NO'
      config.build_settings['GCC_TREAT_WARNINGS_AS_ERRORS'] = 'NO'
      config.build_settings['SWIFT_SUPPRESS_WARNINGS'] = 'YES'
    end
  end
`;

const withXcodeWarnings = (config) => {
  return withDangerousMod(config, [
    'ios',
    (modConfig) => {
      const podfilePath = path.join(modConfig.modRequest.platformProjectRoot, 'Podfile');
      let podfile = fs.readFileSync(podfilePath, 'utf8');

      const marker = '# @generated sumsuma-xcode-warnings';

      if (podfile.includes(marker)) {
        return modConfig;
      }

      // If there's already a post_install block, inject our settings at the top of it.
      if (podfile.includes('post_install do |installer|')) {
        podfile = podfile.replace(
          'post_install do |installer|',
          `post_install do |installer|\n${POST_INSTALL_HOOK}`
        );
      } else {
        // No existing post_install — append one.
        podfile = podfile + `\n${marker}\npost_install do |installer|\n${POST_INSTALL_HOOK}\nend\n`;
      }

      fs.writeFileSync(podfilePath, podfile);
      return modConfig;
    },
  ]);
};

module.exports = withXcodeWarnings;
