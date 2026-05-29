const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const sharedRoot = path.resolve(projectRoot, '../shared');

const config = getDefaultConfig(projectRoot);

// Permite que Metro acceda a archivos fuera de su project root
config.watchFolders = [sharedRoot];

// Mapeo explícito de módulos críticos.
// react y react-native DEBEN estar pineados acá para evitar múltiples instancias
// en el bundle — symptom: "Cannot read property 'useMemo' of null".
// Con pnpm monorepo, Metro puede resolver react desde rutas distintas al
// atravesar shared/ o los módulos de expo-router. Forzamos una sola instancia.
config.resolver.extraNodeModules = {
  '@shared': sharedRoot,
  'react': path.resolve(projectRoot, 'node_modules/react'),
  'react-native': path.resolve(projectRoot, 'node_modules/react-native'),
  '@tanstack/react-query': path.resolve(projectRoot, 'node_modules/@tanstack/react-query'),
  '@babel/runtime': path.resolve(projectRoot, 'node_modules/@babel/runtime'),
};

module.exports = config;
