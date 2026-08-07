'use strict';

module.exports = {
  preset: 'jest-expo',
  transformIgnorePatterns: [
    // Standard node_modules: ignore everything except RN/Expo packages AND .pnpm itself
    'node_modules/(?!(\\.pnpm|(jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|@shopify/.*))',
    // pnpm virtual store: inside .pnpm/<pkg>/node_modules/, ignore everything except RN/Expo
    'node_modules/\\.pnpm/.+/node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|@shopify/.*))',
  ],
  testMatch: ['**/__tests__/**/*.test.(ts|tsx|js)'],
  // El default de jest son 5s, y al PRIMER test de una corrida en frío no le
  // alcanzan: paga la transpilación de todo el grafo de React Native antes de
  // ejecutar una sola línea. Medido — con `npx jest --clearCache` previo,
  // GoogleSignInButton.test.tsx se pasaba de los 5s y su suite tardaba 11.2s;
  // con la caché tibia pasa en milisegundos.
  //
  // Un runner de CI SIEMPRE arranca en frío, así que esto es un rojo esperando
  // a que le toque a cualquiera. No se sube el timeout de ESE test porque el
  // test no es lento: lento es el primer arranque, y le puede tocar a otro.
  testTimeout: 30000,
  setupFilesAfterEnv: ['./jest.setup.js'],
  moduleNameMapper: {
    // Los helpers de @babel/runtime se resuelven desde el directorio del
    // archivo que los pide, y `shared/` no es un paquete pnpm real: no tiene
    // node_modules, así que la búsqueda sube a packages/ → frontend/ → raíz y
    // nunca encuentra la copia que vive en mobile/node_modules. Cualquier
    // módulo de shared/ cuya transpilación emita un helper explota con
    // "Cannot find module '@babel/runtime/helpers/...'".
    //
    // Hasta ahora se venía esquivando MOCKEANDO cada módulo de shared que lo
    // sufría (ver los dos mappers de abajo). Eso no escala y además no sirve
    // cuando el test necesita el comportamiento real del módulo — que es el
    // caso de reportDate, cuya conversión de fechas es justo lo que se prueba.
    //
    // Apuntar el paquete a la copia de mobile lo arregla de raíz para todos.
    // Ojo: LOCAL PUEDE PASAR IGUAL SIN ESTO, porque la caché de transformación
    // de jest sirve un compilado previo; el CI instala limpio y ahí explota.
    '^@babel/runtime/(.*)$': '<rootDir>/node_modules/@babel/runtime/$1',
    // El módulo nativo de Google no carga bajo Jest — se sustituye por el stub.
    '^@react-native-google-signin/google-signin$': '<rootDir>/__mocks__/google-signin.js',
    // Match any relative depth (../../, ../../../, ...) so the real client never
    // loads in tests — its transform requires @babel/runtime helpers that don't
    // resolve from shared/, which is not a real pnpm package.
    '^(\\.\\./)+shared/api/client$': '<rootDir>/__mocks__/shared-api-client.js',
    // Match both the bare alias and any relative depth so the real apiErrors
    // never loads in tests — it pulls in client.ts, whose @babel/runtime
    // helpers don't resolve from shared/ (mirrors the client mapper above).
    '^@shared/utils/apiErrors$': '<rootDir>/__mocks__/shared-api-errors.js',
    '^(\\.\\./)+shared/utils/apiErrors$': '<rootDir>/__mocks__/shared-api-errors.js',
    '^../utils/notifications$': '<rootDir>/__mocks__/notifications.js',
    '^expo-location$': '<rootDir>/__mocks__/expo-location.js',
    '^expo-image-picker$': '<rootDir>/__mocks__/expo-image-picker.js',
    '^react-native-maps$': '<rootDir>/__mocks__/react-native-maps.js',
    '^@shared/(.*)$': '<rootDir>/../shared/$1',
    '^@/(.*)$': '<rootDir>/$1',
  },
};
