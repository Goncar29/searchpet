// Los módulos nativos están mapeados via moduleNameMapper en jest.config.js:
//   expo-secure-store → __mocks__/expo-secure-store.js
//   ../../shared/api/client → __mocks__/shared-api-client.js
//   ../utils/notifications → __mocks__/notifications.js

import * as SecureStore from 'expo-secure-store';
import { apiClient } from '../../shared/api/client';
import { useAuthStore, useLocationStore } from '../store';

const mockSecureStore = SecureStore as jest.Mocked<typeof SecureStore>;
const mockApiClient = apiClient as jest.Mocked<typeof apiClient>;

// ============================================================
// Helpers
// ============================================================

const mockUser = {
  id: 'user-1',
  email: 'carlos@example.com',
  name: 'Carlos',
  is_verified: false,
  created_at: '',
};

const resetAuthStore = () =>
  useAuthStore.setState({
    user: null,
    token: null,
    isLoading: true,
    isAuthenticated: false,
  });

// Builds an unsigned JWT-shaped string with the given payload (base64url).
function makeJwt(payload: object): string {
  const enc = (obj: object) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  return `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc(payload)}.signature`;
}

// ============================================================
// Tests: useAuthStore — login
// ============================================================

describe('useAuthStore — login', () => {
  beforeEach(() => {
    resetAuthStore();
    jest.clearAllMocks();
  });

  it('actualiza el estado tras login exitoso', async () => {
    mockApiClient.login.mockResolvedValue({ token: 'jwt-123', user: mockUser } as any);

    await useAuthStore.getState().login('carlos@example.com', 'password');

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(true);
    expect(state.token).toBe('jwt-123');
    expect(state.user?.name).toBe('Carlos');
  });

  it('persiste token en SecureStore tras login', async () => {
    mockApiClient.login.mockResolvedValue({ token: 'jwt-123', user: mockUser } as any);

    await useAuthStore.getState().login('carlos@example.com', 'password');

    expect(mockSecureStore.setItemAsync).toHaveBeenCalledWith('auth_token', 'jwt-123');
    expect(mockSecureStore.setItemAsync).toHaveBeenCalledWith(
      'user_data',
      JSON.stringify(mockUser)
    );
  });

  it('propaga el error cuando login falla', async () => {
    mockApiClient.login.mockRejectedValue(new Error('Credenciales inválidas'));

    await expect(
      useAuthStore.getState().login('carlos@example.com', 'wrong')
    ).rejects.toThrow('Credenciales inválidas');

    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });
});

// ============================================================
// Tests: useAuthStore — logout
// ============================================================

describe('useAuthStore — logout', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: mockUser, token: 'jwt-123', isAuthenticated: true, isLoading: false });
    jest.clearAllMocks();
  });

  it('limpia el estado tras logout', async () => {
    await useAuthStore.getState().logout();

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.token).toBeNull();
    expect(state.user).toBeNull();
  });

  it('elimina los items de SecureStore al hacer logout', async () => {
    await useAuthStore.getState().logout();

    expect(mockSecureStore.deleteItemAsync).toHaveBeenCalledWith('auth_token');
    expect(mockSecureStore.deleteItemAsync).toHaveBeenCalledWith('user_data');
  });
});

// ============================================================
// Tests: useAuthStore — loadToken
// ============================================================

describe('useAuthStore — loadToken', () => {
  beforeEach(() => {
    resetAuthStore();
    jest.clearAllMocks();
  });

  it('rehidrata el estado desde SecureStore si hay token guardado', async () => {
    mockSecureStore.getItemAsync.mockImplementation((key: string) => {
      if (key === 'auth_token') return Promise.resolve('saved-jwt');
      if (key === 'user_data') return Promise.resolve(JSON.stringify(mockUser));
      return Promise.resolve(null);
    });

    await useAuthStore.getState().loadToken();

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(true);
    expect(state.token).toBe('saved-jwt');
    expect(state.user?.email).toBe('carlos@example.com');
    expect(state.isLoading).toBe(false);
  });

  it('termina con isLoading=false cuando no hay token guardado', async () => {
    mockSecureStore.getItemAsync.mockResolvedValue(null);

    await useAuthStore.getState().loadToken();

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.isLoading).toBe(false);
  });

  it('no rehidrata una sesión con token expirado y limpia SecureStore', async () => {
    const expired = makeJwt({ exp: Math.floor(Date.now() / 1000) - 100 });
    mockSecureStore.getItemAsync.mockImplementation((key: string) => {
      if (key === 'auth_token') return Promise.resolve(expired);
      if (key === 'user_data') return Promise.resolve(JSON.stringify(mockUser));
      return Promise.resolve(null);
    });

    await useAuthStore.getState().loadToken();

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.token).toBeNull();
    expect(state.isLoading).toBe(false);
    expect(mockSecureStore.deleteItemAsync).toHaveBeenCalledWith('auth_token');
    expect(mockSecureStore.deleteItemAsync).toHaveBeenCalledWith('user_data');
  });

  it('rehidrata una sesión con token JWT vigente', async () => {
    const valid = makeJwt({ exp: Math.floor(Date.now() / 1000) + 3600 });
    mockSecureStore.getItemAsync.mockImplementation((key: string) => {
      if (key === 'auth_token') return Promise.resolve(valid);
      if (key === 'user_data') return Promise.resolve(JSON.stringify(mockUser));
      return Promise.resolve(null);
    });

    await useAuthStore.getState().loadToken();

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(true);
    expect(state.token).toBe(valid);
    expect(state.isLoading).toBe(false);
  });
});

// ============================================================
// Tests: useLocationStore
// ============================================================

describe('useLocationStore', () => {
  beforeEach(() => {
    useLocationStore.setState({ latitude: null, longitude: null });
  });

  it('setLocation actualiza latitud y longitud', () => {
    useLocationStore.getState().setLocation(-34.9011, -56.1645);

    const state = useLocationStore.getState();
    expect(state.latitude).toBe(-34.9011);
    expect(state.longitude).toBe(-56.1645);
  });

  it('inicia con latitud y longitud null', () => {
    const state = useLocationStore.getState();
    expect(state.latitude).toBeNull();
    expect(state.longitude).toBeNull();
  });
});
