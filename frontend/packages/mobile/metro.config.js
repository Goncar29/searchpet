const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const packagesRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);

// Incluir todos los packages del monorepo en el watch de Metro
config.watchFolders = [packagesRoot];

// Resolver: buscar node_modules primero en mobile/, luego en packages/
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(packagesRoot, 'node_modules'),
];

// Alias para @shared/* → packages/shared/*
config.resolver.extraNodeModules = {
  '@shared': path.resolve(packagesRoot, 'shared'),
};

module.exports = config;
