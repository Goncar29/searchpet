const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const sharedRoot = path.resolve(projectRoot, '../shared');

const config = getDefaultConfig(projectRoot);

// Permite que Metro acceda a archivos fuera de su project root
config.watchFolders = [sharedRoot];

// Mapeo explícito de:
// - @shared → packages/shared/
// - @tanstack/react-query → la versión instalada en mobile/node_modules
// (shared/ no tiene su propio node_modules, así que sus deps vienen de acá)
config.resolver.extraNodeModules = {
  '@shared': sharedRoot,
  '@tanstack/react-query': path.resolve(projectRoot, 'node_modules/@tanstack/react-query'),
  '@babel/runtime': path.resolve(projectRoot, 'node_modules/@babel/runtime'),
};

module.exports = config;
