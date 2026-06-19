// Unit tests for the push-notification helper.
//
// NOTE: jest.config maps '^../utils/notifications$' to a mock so SCREEN tests
// get a stub. To test the REAL module here we import it via the '@/' alias,
// which resolves to <rootDir>/utils/notifications and dodges that mapper.
import { registerPushToken, configureNotificationHandler } from '@/utils/notifications';
import { apiClient } from '../../shared/api/client';

// Controllable platform + device flags (mock-prefixed for jest hoisting).
let mockOS = 'android';
let mockIsDevice = true;

jest.mock('react-native', () => ({
  Platform: {
    get OS() {
      return mockOS;
    },
  },
}));

jest.mock('expo-device', () => ({
  get isDevice() {
    return mockIsDevice;
  },
}));

const mockGetPermissions = jest.fn();
const mockRequestPermissions = jest.fn();
const mockGetToken = jest.fn();
const mockSetHandler = jest.fn();

jest.mock('expo-notifications', () => ({
  getPermissionsAsync: (...args: unknown[]) => mockGetPermissions(...args),
  requestPermissionsAsync: (...args: unknown[]) => mockRequestPermissions(...args),
  getDevicePushTokenAsync: (...args: unknown[]) => mockGetToken(...args),
  setNotificationHandler: (...args: unknown[]) => mockSetHandler(...args),
}));

const mockRegisterDeviceToken = apiClient.registerDeviceToken as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockOS = 'android';
  mockIsDevice = true;
  mockGetPermissions.mockResolvedValue({ status: 'granted' });
  mockRequestPermissions.mockResolvedValue({ status: 'granted' });
  mockGetToken.mockResolvedValue({ data: 'mock-push-token' });
  // Silence the helper's console output during tests.
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  (console.log as jest.Mock).mockRestore?.();
  (console.warn as jest.Mock).mockRestore?.();
});

describe('registerPushToken', () => {
  it('omite el registro en un simulador (no es dispositivo físico)', async () => {
    mockIsDevice = false;
    await registerPushToken();
    expect(mockGetToken).not.toHaveBeenCalled();
    expect(mockRegisterDeviceToken).not.toHaveBeenCalled();
  });

  it('registra el token cuando el permiso ya estaba otorgado', async () => {
    await registerPushToken();
    expect(mockRequestPermissions).not.toHaveBeenCalled();
    expect(mockRegisterDeviceToken).toHaveBeenCalledWith('mock-push-token', 'android');
  });

  it('pide permiso y registra cuando inicialmente no estaba otorgado', async () => {
    mockGetPermissions.mockResolvedValue({ status: 'undetermined' });
    mockRequestPermissions.mockResolvedValue({ status: 'granted' });
    await registerPushToken();
    expect(mockRequestPermissions).toHaveBeenCalled();
    expect(mockRegisterDeviceToken).toHaveBeenCalledWith('mock-push-token', 'android');
  });

  it('no registra el token si el usuario rechaza el permiso', async () => {
    mockGetPermissions.mockResolvedValue({ status: 'undetermined' });
    mockRequestPermissions.mockResolvedValue({ status: 'denied' });
    await registerPushToken();
    expect(mockGetToken).not.toHaveBeenCalled();
    expect(mockRegisterDeviceToken).not.toHaveBeenCalled();
  });

  it('usa la plataforma ios cuando Platform.OS es ios', async () => {
    mockOS = 'ios';
    await registerPushToken();
    expect(mockRegisterDeviceToken).toHaveBeenCalledWith('mock-push-token', 'ios');
  });

  it('falla silenciosamente si la obtención del token lanza un error', async () => {
    mockGetToken.mockRejectedValue(new Error('boom'));
    await expect(registerPushToken()).resolves.toBeUndefined();
    expect(mockRegisterDeviceToken).not.toHaveBeenCalled();
  });
});

describe('configureNotificationHandler', () => {
  it('configura el handler de notificaciones', () => {
    configureNotificationHandler();
    expect(mockSetHandler).toHaveBeenCalledTimes(1);
  });
});
