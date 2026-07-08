module.exports = function(api) {
  // api.caller() must be invoked before api.cache(); Babel enforces this order.
  const isWeb = api.caller(
    (caller) => !!(caller && caller.name === 'metro' && caller.platform === 'web')
  );

  // Cache per platform so native and web each get their own compiled config.
  api.cache.using(() => isWeb ? 'web' : 'native');

  return {
    presets: ['babel-preset-expo'],
    plugins: [
      [
        'module-resolver',
        {
          root: ['./'],
          alias: {
            '@': './src',
          },
        },
      ],
    ],
  };
};
