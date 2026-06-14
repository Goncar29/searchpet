// Mirrors ApiError from shared/api/client.ts so `instanceof` checks work in tests.
class ApiError extends Error {
  constructor(code, status, message) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

module.exports = {
  ApiError,
  apiClient: {
    login: jest.fn(),
    register: jest.fn(),
    setToken: jest.fn(),
    logout: jest.fn(),
  },
};
