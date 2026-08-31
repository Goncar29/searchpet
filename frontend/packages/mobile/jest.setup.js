// jest.setup.js — SearchPet Mobile Test Setup
// Runs after the test framework is installed (setupFilesAfterEnv)

// Same global setup the app performs as the first import of app/_layout.tsx.
// The jest environment lacks CustomEvent/addEventListener/dispatchEvent just as a
// device does, and store/index.ts registers its session-expiry listener on them at
// import time — without this, that listener silently never registers and the tests
// covering it would be testing nothing.
require('./polyfills/domEvents');

// expo-router mocks — must be declared with jest.mock (not vi)
jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: jest.fn(),
    back: jest.fn(),
    replace: jest.fn(),
    navigate: jest.fn(),
  }),
  useLocalSearchParams: () => ({}),
  useSegments: () => [],
  Link: ({ children }) => children,
  Stack: { Screen: () => null },
  Tabs: { Screen: () => null },
  Redirect: () => null,
  // Imperative singleton (usable outside components, e.g. from a Zustand
  // store) — unlike useRouter() above, this is the same object across the
  // whole test file, so a test can assert on it after the fact.
  router: {
    push: jest.fn(),
    back: jest.fn(),
    replace: jest.fn(),
    navigate: jest.fn(),
  },
}));

// expo-notifications mock
jest.mock('expo-notifications', () => ({
  getDevicePushTokenAsync: jest.fn().mockResolvedValue({ data: 'mock-push-token' }),
  requestPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  getPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  setNotificationHandler: jest.fn(),
  addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
}));

// @react-native-community/netinfo — the mock the package ships. Its
// addEventListener is a jest.fn() that never calls the listener back, which is
// what makes the bridge testable: a test can pull the listener out of
// mock.calls and drive the device's connectivity by hand.
jest.mock('@react-native-community/netinfo', () =>
  require('@react-native-community/netinfo/jest/netinfo-mock.js')
);

// react-native-safe-area-context mock
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }) => children,
  SafeAreaView: ({ children }) => children,
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
