const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const sharedRoot = path.resolve(projectRoot, '../shared');

const config = getDefaultConfig(projectRoot);

// Permite que Metro acceda a archivos fuera de su project root
config.watchFolders = [sharedRoot];

// Cuando Metro resuelve desde shared/ (que no tiene node_modules),
// busca también en mobile/node_modules para encontrar @tanstack/react-query, etc.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
];

// Resuelve el alias @shared/* → packages/shared/*
config.resolver.extraNodeModules = {
  '@shared': sharedRoot,
};

module.exports = config;
