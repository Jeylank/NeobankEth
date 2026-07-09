// Minimal stub for the `react-native` package in the Node/Jest server-test
// environment. Only what's exercised by src/utils/storage.ts (Platform.OS)
// is implemented — this is test-environment isolation, not app behavior.
export const Platform = {
  OS: 'ios' as 'ios' | 'android' | 'web',
  select: (obj: Record<string, unknown>) => obj.ios ?? obj.default,
};

export default { Platform };
