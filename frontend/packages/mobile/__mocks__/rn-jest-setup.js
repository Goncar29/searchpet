// Setup mínimo de React Native para tests
// Reemplaza @react-native/jest-preset/jest/setup.js que usa sintaxis Flow+TS incompatible.

global.IS_REACT_ACT_ENVIRONMENT = true;
global.IS_REACT_NATIVE_TEST_ENVIRONMENT = true;
global.__DEV__ = true;
global.window = global;

global.cancelAnimationFrame = (id) => clearTimeout(id);
global.requestAnimationFrame = (callback) => setTimeout(() => callback(Date.now()), 0);
global.performance = { now: () => Date.now() };

// Suprimir warnings de react-test-renderer en entornos de test
global.nativeFabricUIManager = {};

try {
  require('@react-native/js-polyfills/error-guard');
} catch {
  // Opcional — no bloquear si no está disponible
}
