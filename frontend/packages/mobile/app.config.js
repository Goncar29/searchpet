// app.config.js — dynamic config que puede leer process.env en build time
// Expo usa este archivo en lugar de app.json cuando existe.
// Las vars EXPO_PUBLIC_* también están disponibles vía process.env en Metro,
// pero para pasarlas a Constants.expoConfig.extra las inyectamos acá.

const baseConfig = require('./app.json');

module.exports = {
  ...baseConfig.expo,
  extra: {
    ...baseConfig.expo.extra,
    maptilerKey: process.env.EXPO_PUBLIC_MAPTILER_KEY || '',
  },
};
