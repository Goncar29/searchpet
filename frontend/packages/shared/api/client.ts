// ============================================================
// Lost Pets - Cliente API compartido (Mobile + Web)
// ============================================================

import type {
  AuthResponse,
  RegisterRequest,
  LoginRequest,
  User,
  UserPreferences,
  Pet,
  CreatePetRequest,
  UpdatePetRequest,
  UpdateProfileRequest,
  PetSearchParams,
  PetSearchFilters,
  PetListResponse,
  Report,
  CreateReportRequest,
  NearbySearchParams,
  NearbyReportsResponse,
  Message,
  SendMessageRequest,
  ShareLink,
  SharedPetResponse,
  GenerateShareRequest,
  Stats,
  UploadPhotoResponse,
  LocationAlert,
  LocationAlertListResponse,
  CreateLocationAlertRequest,
  UpdateLocationAlertRequest,
} from '../types';

// En Vite usamos import.meta.env, en Expo usamos process.env
// El try/catch maneja el caso donde import.meta no existe (Expo/Node)
const getAPIBaseURL = (): string => {
  try {
    return import.meta.env?.VITE_API_URL || 'http://localhost:8081';
  } catch {
    return (typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_API_URL)
      || 'http://localhost:8081';
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

  async getMe(): Promise<User> {
    return this.request<User>('GET', '/api/auth/me');
  }

  async updateMe(data: UpdateProfileRequest): Promise<User> {
    return this.request<User>('PUT', '/api/auth/me', data);
  }

  async updatePreferences(prefs: UserPreferences): Promise<UserPreferences> {
    return this.request<UserPreferences>('PUT', '/api/users/me/preferences', prefs);
  }

  async uploadProfilePhoto(file: File): Promise<User> {
    const url = `${this.baseURL}/api/auth/me/photo`;
    const formData = new FormData();
    formData.append('photo', file);

    const headers: Record<string, string> = {};
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;

    const response = await fetch(url, { method: 'POST', headers, body: formData });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Error desconocido' }));
      throw new Error(error.error || `HTTP Error ${response.status}`);
    }
    return response.json();
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

  async markPetAsFound(id: string): Promise<Pet> {
    return this.request<Pet>('PATCH', `/api/pets/${id}/found`);
  }

  /** @deprecated Usa searchPets(filters: PetSearchFilters) en su lugar */
  async searchPetsLegacy(params: PetSearchParams): Promise<Pet[]> {
    return this.request<Pet[]>('GET', '/api/pets/search', undefined, params as Record<string, string | number>);
  }

  async searchPets(filters: PetSearchFilters): Promise<PetListResponse> {
    const params: Record<string, string | number> = {};
    if (filters.type) params['type'] = filters.type;
    if (filters.breed) params['breed'] = filters.breed;
    if (filters.color) params['color'] = filters.color;
    if (filters.status) params['status'] = filters.status;
    if (filters.from) params['from'] = filters.from;
    if (filters.to) params['to'] = filters.to;
    if (filters.page !== undefined) params['page'] = filters.page;
    if (filters.limit !== undefined) params['limit'] = filters.limit;
    return this.request<PetListResponse>('GET', '/api/pets/search', undefined, params);
  }

  // uploadPhoto usa FormData crudo — NO usa this.request() porque ese método
  // hardcodea Content-Type: application/json y rompería el boundary de multipart.
  async uploadPhoto(petId: string, file: File): Promise<UploadPhotoResponse> {
    const url = `${this.baseURL}/api/pets/${petId}/photos`;

    const formData = new FormData();
    formData.append('photo', file);

    const headers: Record<string, string> = {};
    // NO seteamos Content-Type — el browser lo pone con el boundary correcto
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: formData,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Error desconocido' }));
      throw new Error(error.error || `HTTP Error ${response.status}`);
    }

    return response.json();
  }

  // Versión para React Native — FormData con objeto { uri, name, type }
  // porque RN no tiene la API File del browser.
  async uploadPhotoNative(petId: string, uri: string): Promise<UploadPhotoResponse> {
    const url = `${this.baseURL}/api/pets/${petId}/photos`;

    const formData = new FormData();
    const filename = uri.split('/').pop() || 'photo.jpg';
    const ext = (filename.split('.').pop() || 'jpg').toLowerCase();
    const mimeType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
    // React Native entiende este formato como un archivo multipart
    formData.append('photo', { uri, name: filename, type: mimeType } as unknown as Blob);

    const headers: Record<string, string> = {};
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: formData,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Error desconocido' }));
      throw new Error(error.error || `HTTP Error ${response.status}`);
    }

    return response.json();
  }

  // ============================================================
  // REPORTS
  // ============================================================

  async createReport(data: CreateReportRequest): Promise<Report> {
    return this.request<Report>('POST', '/api/reports', data);
  }

  async getNearbyReports(params: NearbySearchParams): Promise<NearbyReportsResponse> {
    const queryParams: Record<string, string | number> = {
      lat: params.lat,
      lng: params.lng,
    };
    // radius is in meters — passed directly to the backend
    if (params.radius !== undefined) {
      queryParams['radius'] = params.radius;
    }
    if (params.limit !== undefined) {
      queryParams['limit'] = params.limit;
    }
    return this.request<NearbyReportsResponse>('GET', '/api/reports/nearby', undefined, queryParams);
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

  async getConversations(): Promise<Message[]> {
    return this.request<Message[]>('GET', '/api/messages');
  }

  async getConversation(userID: string, limit = 50, offset = 0): Promise<Message[]> {
    return this.request<Message[]>('GET', `/api/messages/${userID}`, undefined, { limit, offset });
  }

  async sendMessageTo(receiverID: string, text: string, reportID?: string): Promise<Message> {
    return this.request<Message>('POST', '/api/messages', {
      receiver_id: receiverID,
      text,
      ...(reportID && { report_id: reportID }),
    });
  }

  // ============================================================
  // SHARE
  // ============================================================

  async generateShareLink(petID: string, data?: GenerateShareRequest): Promise<ShareLink> {
    return this.request<ShareLink>('POST', `/api/share/generate/${petID}`, data);
  }

  async getSharedPet(token: string): Promise<SharedPetResponse> {
    return this.request<SharedPetResponse>('GET', `/api/share/pet/${token}`);
  }

  // ============================================================
  // STATS (público)
  // ============================================================

  async getStats(): Promise<Stats> {
    return this.request<Stats>('GET', '/api/stats');
  }

  // ============================================================
  // DEVICES (push notifications)
  // ============================================================

  async registerDeviceToken(token: string, platform: 'ios' | 'android' | 'web'): Promise<void> {
    return this.request<void>('POST', '/api/devices/token', { token, platform });
  }

  // ============================================================
  // LOCATION ALERTS
  // ============================================================

  async createAlert(data: CreateLocationAlertRequest): Promise<LocationAlert> {
    return this.request<LocationAlert>('POST', '/api/alerts', data);
  }

  async getAlerts(): Promise<LocationAlert[]> {
    const resp = await this.request<LocationAlertListResponse>('GET', '/api/alerts');
    return resp.data;
  }

  async getAlert(id: string): Promise<LocationAlert> {
    return this.request<LocationAlert>('GET', `/api/alerts/${id}`);
  }

  async updateAlert(id: string, data: UpdateLocationAlertRequest): Promise<LocationAlert> {
    return this.request<LocationAlert>('PUT', `/api/alerts/${id}`, data);
  }

  async deleteAlert(id: string): Promise<void> {
    return this.request<void>('DELETE', `/api/alerts/${id}`);
  }
}

// Exportar instancia única (singleton)
export const apiClient = new APIClient();
export { APIClient };
