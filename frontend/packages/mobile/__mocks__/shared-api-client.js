// Mirrors ApiError from shared/api/client.ts so `instanceof` checks work in tests.
class ApiError extends Error {
  constructor(code, status, message, retryAfter) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    // Seconds from the Retry-After header. Keep in step with the real class:
    // the profile screen reads it to seed the OTP cooldown countdown.
    this.retryAfter = retryAfter;
  }
}

module.exports = {
  ApiError,
  apiClient: {
    login: jest.fn(),
    loginWithGoogle: jest.fn(),
    register: jest.fn(),
    setToken: jest.fn(),
    logout: jest.fn(),
    registerDeviceToken: jest.fn(),
    updateMyLocation: jest.fn(),
    forgotPassword: jest.fn(),
    resetPassword: jest.fn(),
  },
};
