import { useAuthStore } from '../store';
import { apiClient } from '../../shared/api/client';
import * as SecureStore from 'expo-secure-store';
import { registerPushToken } from '../utils/notifications';

const RESPONSE = {
  user: { id: 'u1', name: 'Carlos', email: 'c@example.com' },
  token: 'jwt-token',
  is_new_user: true,
};

beforeEach(() => {
  jest.clearAllMocks();
  useAuthStore.setState({ user: null, token: null, isAuthenticated: false });
});

test('persists the session and reports a new user', async () => {
  (apiClient.loginWithGoogle as jest.Mock).mockResolvedValue(RESPONSE);

  const isNew = await useAuthStore.getState().loginWithGoogle('google-id-token');

  expect(isNew).toBe(true);
  expect(apiClient.loginWithGoogle).toHaveBeenCalledWith('google-id-token');
  expect(SecureStore.setItemAsync).toHaveBeenCalledWith('auth_token', 'jwt-token');
  expect(apiClient.setToken).toHaveBeenCalledWith('jwt-token');
  expect(useAuthStore.getState().isAuthenticated).toBe(true);
  expect(useAuthStore.getState().user).toEqual(RESPONSE.user);
});

// El registro de FCM es lo que hace que las push lleguen. Si el login por Google
// no lo dispara, el usuario entra pero nunca recibe una alerta de mascota cerca.
test('registers the push token like the password login does', async () => {
  (apiClient.loginWithGoogle as jest.Mock).mockResolvedValue({ ...RESPONSE, is_new_user: false });

  const isNew = await useAuthStore.getState().loginWithGoogle('google-id-token');

  expect(isNew).toBe(false);
  expect(registerPushToken).toHaveBeenCalled();
});

test('leaves the session untouched when the backend rejects the token', async () => {
  (apiClient.loginWithGoogle as jest.Mock).mockRejectedValue(new Error('401'));

  await expect(useAuthStore.getState().loginWithGoogle('bad')).rejects.toThrow();

  expect(useAuthStore.getState().isAuthenticated).toBe(false);
  expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
});
