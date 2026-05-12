module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      'babel-preset-expo',
      // TypeScript con allExtensions:true para manejar archivos .js de react-native
      // que usan sintaxis TypeScript (catch (e: unknown), as casting, etc.)
      ['@babel/preset-typescript', { allExtensions: true, allowDeclareFields: true }],
    ],
  };
};
