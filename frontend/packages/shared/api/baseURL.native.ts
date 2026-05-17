// React Native (Metro/Hermes) — process.env con prefijo EXPO_PUBLIC_
export const API_BASE_URL: string =
  process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8081';
