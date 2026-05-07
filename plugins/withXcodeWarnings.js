const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const POST_INSTALL_HOOK = `
  installer.pods_project.targets.each do |target|
    target.build_configurations.each do |config|
      config.build_settings['SWIFT_TREAT_WARNINGS_AS_ERRORS'] = 'NO'
      config.build_settings['GCC_TREAT_WARNINGS_AS_ERRORS'] = 'NO'
      config.build_settings['CLANG_WARN_UNREACHABLE_CODE'] = 'NO'
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

      const postInstallBlock = `
${marker}
post_install do |installer|
${POST_INSTALL_HOOK}
end
`;

      if (podfile.includes('post_install do |installer|')) {
        podfile = podfile.replace(
          /post_install do \|installer\|/,
          `post_install do |installer|\n${POST_INSTALL_HOOK}\n  # --- original post_install continues ---`
        );
      } else {
        podfile = podfile + postInstallBlock;
      }

      fs.writeFileSync(podfilePath, podfile);
      return modConfig;
    },
  ]);
};

module.exports = withXcodeWarnings;
