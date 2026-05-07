const { withXcodeProject } = require('@expo/config-plugins');

const withXcodeWarnings = (config) => {
  return withXcodeProject(config, (xcodeProject) => {
    const project = xcodeProject.modResults;
    const targets = project.pbxNativeTargetSection();

    Object.keys(targets).forEach((key) => {
      if (key.endsWith('_comment')) return;
      const target = targets[key];
      if (!target.buildConfigurationList) return;

      const configListUUID = target.buildConfigurationList;
      const configList = project.pbxXCConfigurationList()[configListUUID];
      if (!configList) return;

      configList.buildConfigurations.forEach(({ value: configUUID }) => {
        const buildConfig = project.pbxXCBuildConfigurationSection()[configUUID];
        if (!buildConfig || !buildConfig.buildSettings) return;

        buildConfig.buildSettings['SWIFT_TREAT_WARNINGS_AS_ERRORS'] = 'NO';
        buildConfig.buildSettings['GCC_TREAT_WARNINGS_AS_ERRORS'] = 'NO';
        buildConfig.buildSettings['CLANG_WARN_UNREACHABLE_CODE'] = 'NO';
      });
    });

    return xcodeProject;
  });
};

module.exports = withXcodeWarnings;
