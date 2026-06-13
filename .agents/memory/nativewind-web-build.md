---
name: NativeWind v2 web build fix
description: Why nativewind/babel must be skipped during web builds
---

## The Problem
nativewind v2's Babel plugin (`nativewind/babel`) uses PostCSS synchronously internally.
Metro web bundler runs Babel in a worker that requires async PostCSS → throws:
  `Use process(css).then(cb) to work with async plugins`

## The Fix (babel.config.js)
```js
module.exports = function(api) {
  // api.caller() MUST be called before api.cache() — Babel enforces this order.
  const isWeb = api.caller(
    (caller) => !!(caller && caller.name === 'metro' && caller.platform === 'web')
  );
  api.cache.using(() => isWeb ? 'web' : 'native');

  return {
    presets: ['babel-preset-expo'],
    plugins: [
      ['module-resolver', { root: ['./'], alias: { '@': './src' } }],
      ...(!isWeb ? ['nativewind/babel'] : []),
    ],
  };
};
```

**Why:** nativewind v2 is native-only; web uses CSS/Tailwind directly without the transform.
**How to apply:** Any change to babel.config.js must preserve this isWeb guard.
