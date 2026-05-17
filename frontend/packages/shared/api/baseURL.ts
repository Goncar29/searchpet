// Web (Vite) — import.meta.env es válido acá
export const API_BASE_URL: string =
  (import.meta as Record<string, unknown> & { env?: Record<string, string> }).env?.VITE_API_URL ||
  'http://localhost:8081';
