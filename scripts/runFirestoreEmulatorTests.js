const { spawnSync } = require('child_process');

const result = spawnSync(
  'npm',
  ['test', '--', 'agentCashFirestoreEmulator', '--runInBand'],
  {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, RUN_FIRESTORE_EMULATOR_TESTS: '1' },
  },
);

if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
