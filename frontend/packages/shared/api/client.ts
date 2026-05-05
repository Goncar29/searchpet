// ============================================================
// Lost Pets - Cliente API compartido (Mobile + Web)
// ============================================================

import type {
  AuthResponse,
  RegisterRequest,
  LoginRequest,
  Pet,
  CreatePetRequest,
  UpdatePetRequest,
  PetSearchParams,
  Report,
  CreateReportRequest,
  NearbySearchParams,
  Message,
  SendMessageRequest,
  ShareLink,
  GenerateShareRequest,
  Stats,
} from '../types';

// En Vite usamos import.meta.env, en Expo usamos process.env
// El try/catch maneja el caso donde import.meta no existe (Expo/Node)
const getAPIBaseURL = (): string => {
  try {
    return import.meta.env?.VITE_API_URL || 'http://localhost:8080';
  } catch {
    return (typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_API_URL)
      || 'http://localhost:8080';
  }
};

const API_BASE_URL = getAPIBaseURL();

class APIClient {
  private baseURL: string;
  private token: string | null = null;

  constructor(baseURL: string = API_BASE_URL) {
    this.baseURL = baseURL;
  }

  // Configurar token de autenticación
  setToken(token: string | null) {
    this.token = token;
  }

  // Método base para requests
  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    params?: Record<string, string | number>
  ): Promise<T> {
    const url = new URL(`${this.baseURL}${path}`);

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          url.searchParams.append(key, String(value));
        }
      });
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const response = await fetch(url.toString(), {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Error desconocido' }));
      throw new Error(error.error || `HTTP Error ${response.status}`);
    }

    if (response.status === 204) {
      return {} as T;
    }

    return response.json();
  }

  // ============================================================
  // AUTH
  // ============================================================

  async register(data: RegisterRequest): Promise<AuthResponse> {
    const resp = await this.request<AuthResponse>('POST', '/api/auth/register', data);
    this.token = resp.token;
    return resp;
  }

  async login(data: LoginRequest): Promise<AuthResponse> {
    const resp = await this.request<AuthResponse>('POST', '/api/auth/login', data);
    this.token = resp.token;
    return resp;
  }

  logout() {
    this.token = null;
  }

  // ============================================================
  // PETS
  // ============================================================

  async createPet(data: CreatePetRequest): Promise<Pet> {
    return this.request<Pet>('POST', '/api/pets', data);
  }

  async getPetByID(id: string): Promise<Pet> {
    return this.request<Pet>('GET', `/api/pets/${id}`);
  }

  async getMyPets(): Promise<Pet[]> {
    return this.request<Pet[]>('GET', '/api/pets/mine');
  }

  async updatePet(id: string, data: UpdatePetRequest): Promise<Pet> {
    return this.request<Pet>('PUT', `/api/pets/${id}`, data);
  }

  async deletePet(id: string): Promise<void> {
    return this.request<void>('DELETE', `/api/pets/${id}`);
  }

  async searchPets(params: PetSearchParams): Promise<Pet[]> {
    return this.request<Pet[]>('GET', '/api/pets/search', undefined, params as Record<string, string | number>);
  }

  // ============================================================
  // REPORTS
  // ============================================================

  async createReport(data: CreateReportRequest): Promise<Report> {
    return this.request<Report>('POST', '/api/reports', data);
  }

  async getNearbyReports(params: NearbySearchParams): Promise<Report[]> {
    return this.request<Report[]>('GET', '/api/reports/nearby', undefined, params as Record<string, string | number>);
  }

  async getReportsByPetID(petID: string): Promise<Report[]> {
    return this.request<Report[]>('GET', `/api/reports/pet/${petID}`);
  }

  async getReportByID(id: string): Promise<Report> {
    return this.request<Report>('GET', `/api/reports/${id}`);
  }

  // ============================================================
  // MESSAGES
  // ============================================================

  async sendMessage(data: SendMessageRequest): Promise<Message> {
    return this.request<Message>('POST', '/api/messages', data);
  }

  async getConversation(userID: string, limit = 50, offset = 0): Promise<Message[]> {
    return this.request<Message[]>('GET', `/api/messages/${userID}`, undefined, { limit, offset });
  }

  // ============================================================
  // SHARE
  // ============================================================

  async generateShareLink(petID: string, data?: GenerateShareRequest): Promise<ShareLink> {
    return this.request<ShareLink>('POST', `/api/share/generate/${petID}`, data);
  }

  async getSharedPet(token: string): Promise<Pet> {
    return this.request<Pet>('GET', `/api/share/pet/${token}`);
  }

  // ============================================================
  // STATS (público)
  // ============================================================

  async getStats(): Promise<Stats> {
    return this.request<Stats>('GET', '/api/stats');
  }
}

// Exportar instancia única (singleton)
export const apiClient = new APIClient();
export { APIClient };
