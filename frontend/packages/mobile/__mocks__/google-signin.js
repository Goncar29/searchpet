// Stub del módulo nativo de Google Sign-In. El real no carga bajo Jest.
//
// Espeja @react-native-google-signin/google-signin@16:
//   - signIn() RESUELVE con una unión discriminada y NO tira excepción al cancelar:
//       { type: 'success', data: { idToken, user } } | { type: 'cancelled', data: null }
//   - statusCodes son EXACTAMENTE estos cinco. Ojo: NO existe DEVELOPER_ERROR ahí
//     (verificado contra lib/typescript/src/errors/errorCodes.d.ts). Android igual
//     lo emite como error.code === 'DEVELOPER_ERROR', pero no es una constante
//     exportada, así que nunca lo compares contra statusCodes.DEVELOPER_ERROR:
//     sería undefined === undefined y cualquier error sin code entraría por ahí.
const statusCodes = Object.freeze({
  SIGN_IN_CANCELLED: 'SIGN_IN_CANCELLED',
  IN_PROGRESS: 'IN_PROGRESS',
  PLAY_SERVICES_NOT_AVAILABLE: 'PLAY_SERVICES_NOT_AVAILABLE',
  SIGN_IN_REQUIRED: 'SIGN_IN_REQUIRED',
  NULL_PRESENTER: 'NULL_PRESENTER',
});

module.exports = {
  statusCodes,
  GoogleSignin: {
    configure: jest.fn(),
    hasPlayServices: jest.fn().mockResolvedValue(true),
    signIn: jest.fn(),
    signOut: jest.fn().mockResolvedValue(undefined),
  },
};
