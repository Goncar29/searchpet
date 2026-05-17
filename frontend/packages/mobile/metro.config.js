const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const sharedRoot = path.resolve(projectRoot, '../shared');

const config = getDefaultConfig(projectRoot);

// Permite que Metro acceda a archivos fuera de su project root
config.watchFolders = [sharedRoot];

// Resuelve el alias @shared/* → packages/shared/*
config.resolver.extraNodeModules = {
  '@shared': sharedRoot,
};

module.exports = config;
