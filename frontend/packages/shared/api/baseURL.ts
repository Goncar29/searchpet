// Vite (web) uses import.meta.env; Metro (mobile) polyfills it at runtime.
export const API_BASE_URL: string =
  // @ts-ignore: import.meta is Vite-specific; tsc with moduleResolution:node rejects it.
  (import.meta as Record<string, unknown> & { env?: Record<string, string> }).env?.VITE_API_URL ||
  'http://localhost:8081';
