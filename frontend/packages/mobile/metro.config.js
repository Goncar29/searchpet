const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const sharedRoot = path.resolve(projectRoot, '../shared');

const config = getDefaultConfig(projectRoot);

// Permite que Metro acceda a archivos fuera de su project root
config.watchFolders = [sharedRoot];

// Proxy: @shared → shared/, cualquier otro módulo → mobile/node_modules/
// Necesario porque shared/ no tiene su propio node_modules.
config.resolver.extraNodeModules = new Proxy(
  { '@shared': sharedRoot },
  {
    get(target, name) {
      if (name in target) return target[name];
      return path.join(projectRoot, 'node_modules', name.toString());
    },
  }
);

module.exports = config;
