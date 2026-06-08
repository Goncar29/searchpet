const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const sharedRoot = path.resolve(projectRoot, '../shared');

const config = getDefaultConfig(projectRoot);

// Permite que Metro acceda a archivos fuera de su project root
config.watchFolders = [sharedRoot];

// Resuelve la ubicación real de un módulo desde el project root.
// require.resolve sigue symlinks de pnpm correctamente en cualquier entorno.
function resolveModule(mod) {
  try {
    return path.dirname(require.resolve(`${mod}/package.json`, { paths: [projectRoot] }));
  } catch {
    return path.resolve(projectRoot, 'node_modules', mod);
  }
}

// Mapeo explícito de módulos críticos.
// react y react-native deben apuntar a UNA sola instancia para evitar el crash
// "Cannot read property 'useMemo' of null" en pnpm monorepo.
config.resolver.extraNodeModules = {
  '@shared': sharedRoot,
  'react': resolveModule('react'),
  'react-native': resolveModule('react-native'),
  '@tanstack/react-query': resolveModule('@tanstack/react-query'),
  '@babel/runtime': resolveModule('@babel/runtime'),
  // TF.js is declared in mobile but imported via shared/hooks/useImageClassify.ts —
  // pin resolution to the mobile project so Metro finds it in any workspace layout.
  '@tensorflow/tfjs': resolveModule('@tensorflow/tfjs'),
  '@tensorflow/tfjs-react-native': resolveModule('@tensorflow/tfjs-react-native'),
  '@tensorflow-models/mobilenet': resolveModule('@tensorflow-models/mobilenet'),
};

// Excluir paquetes de tipos de la resolución de módulos en runtime.
// @types/* no tienen código ejecutable — Metro no debe usarlos como módulos.
config.resolver.blockList = [
  /node_modules\/.*\/node_modules\/@types\/.*/,
];

module.exports = config;
