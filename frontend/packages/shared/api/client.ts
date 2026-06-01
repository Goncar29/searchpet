// ============================================================
// Lost Pets - Cliente API compartido (Mobile + Web)
// ============================================================

import { API_BASE_URL } from './baseURL';

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
  Badge,
  UserProfile,
  LeaderboardEntry,
  BlockedUser,
  AbuseReport,
  CreateAbuseReportRequest,
  BlockUserRequest,
  SuccessStory,
  CreateStoryRequest,
  StoryListResponse,
  UserReview,
  CreateReviewRequest,
  UpdateReviewRequest,
  ReviewListResponse,
  LocalGroup,
  GroupMember,
  VerificationStatus,
} from '../types';


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
      const err = new Error(error.error || `HTTP Error ${response.status}`) as Error & { status: number };
      err.status = response.status;
      throw err;
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

  // Versión para React Native — sube la foto de perfil del usuario autenticado.
  // Mismo patrón que uploadPhotoNative: FormData con { uri, name, type }.
  async uploadProfilePhotoNative(uri: string): Promise<User> {
    const url = `${this.baseURL}/api/auth/me/photo`;

    const formData = new FormData();
    const filename = uri.split('/').pop() || 'avatar.jpg';
    const ext = (filename.split('.').pop() || 'jpg').toLowerCase();
    const mimeType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
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

  async sendMessageTo(receiverID: string, content: string, reportID?: string): Promise<Message> {
    return this.request<Message>('POST', '/api/messages', {
      receiver_id: receiverID,
      content,
      ...(reportID && { report_id: reportID }),
    });
  }

  async markAsRead(messageId: string): Promise<void> {
    return this.request<void>('PATCH', `/api/messages/${messageId}/read`);
  }

  async issueWsTicket(): Promise<{ ticket: string; expires_in: number }> {
    return this.request<{ ticket: string; expires_in: number }>('POST', '/api/ws/ticket');
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

  async deleteDeviceToken(token: string): Promise<void> {
    return this.request<void>('DELETE', `/api/devices/${encodeURIComponent(token)}`);
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

  // ============================================================
  // GAMIFICATION
  // ============================================================

  async getPublicProfile(userID: string): Promise<UserProfile> {
    return this.request<UserProfile>('GET', `/api/users/${userID}/profile`);
  }

  async getLeaderboard(city: string, limit = 10): Promise<LeaderboardEntry[]> {
    return this.request<LeaderboardEntry[]>('GET', '/api/leaderboard', undefined, { city, limit });
  }

  async getMyBadges(): Promise<Badge[]> {
    return this.request<Badge[]>('GET', '/api/users/me/badges');
  }

  // ============================================================
  // BLOCKING & ABUSE REPORTS
  // ============================================================

  async blockUser(userId: string, data?: BlockUserRequest): Promise<void> {
    return this.request<void>('POST', `/api/users/${userId}/block`, data);
  }

  async unblockUser(userId: string): Promise<void> {
    return this.request<void>('DELETE', `/api/users/${userId}/block`);
  }

  async getBlockedUsers(): Promise<BlockedUser[]> {
    return this.request<BlockedUser[]>('GET', '/api/users/blocked');
  }

  async submitAbuseReport(data: CreateAbuseReportRequest): Promise<AbuseReport> {
    return this.request<AbuseReport>('POST', '/api/abuse-reports', data);
  }

  // ============================================================
  // SUCCESS STORIES
  // ============================================================

  async getStories(params?: { featured?: boolean; limit?: number; offset?: number }): Promise<StoryListResponse> {
    const queryParams: Record<string, string | number> = {};
    if (params?.featured !== undefined) queryParams['featured'] = String(params.featured);
    if (params?.limit !== undefined) queryParams['limit'] = params.limit;
    if (params?.offset !== undefined) queryParams['offset'] = params.offset;
    return this.request<StoryListResponse>('GET', '/api/stories', undefined, queryParams);
  }

  async getStory(id: string): Promise<SuccessStory> {
    return this.request<SuccessStory>('GET', `/api/stories/${id}`);
  }

  async getStoryByPetID(petId: string): Promise<SuccessStory> {
    return this.request<SuccessStory>('GET', `/api/stories/pet/${petId}`);
  }

  async createStory(data: CreateStoryRequest): Promise<SuccessStory> {
    return this.request<SuccessStory>('POST', '/api/stories', data);
  }

  async likeStory(id: string): Promise<void> {
    return this.request<void>('POST', `/api/stories/${id}/like`);
  }

  async deleteStory(id: string): Promise<void> {
    return this.request<void>('DELETE', `/api/stories/${id}`);
  }

  // ============================================================
  // REVIEWS
  // ============================================================

  async getUserReviews(userId: string, page = 1, pageSize = 20): Promise<ReviewListResponse> {
    return this.request<ReviewListResponse>('GET', `/api/users/${userId}/reviews`, undefined, {
      page,
      page_size: pageSize,
    });
  }

  async createReview(userId: string, data: CreateReviewRequest): Promise<UserReview> {
    return this.request<UserReview>('POST', `/api/users/${userId}/reviews`, data);
  }

  async updateReview(userId: string, data: UpdateReviewRequest): Promise<UserReview> {
    return this.request<UserReview>('PUT', `/api/users/${userId}/reviews`, data);
  }

  // ============================================================
  // LOCAL GROUPS
  // ============================================================

  async listGroups(params?: { city?: string }): Promise<LocalGroup[]> {
    const queryParams: Record<string, string | number> = {};
    if (params?.city) queryParams['city'] = params.city;
    return this.request<LocalGroup[]>('GET', '/api/groups', undefined, queryParams);
  }

  async getGroup(id: string): Promise<LocalGroup> {
    return this.request<LocalGroup>('GET', `/api/groups/${id}`);
  }

  async getGroupMembers(id: string): Promise<GroupMember[]> {
    return this.request<GroupMember[]>('GET', `/api/groups/${id}/members`);
  }

  async joinGroup(id: string): Promise<void> {
    return this.request<void>('POST', `/api/groups/${id}/join`);
  }

  async leaveGroup(id: string): Promise<void> {
    return this.request<void>('DELETE', `/api/groups/${id}/leave`);
  }

  // ============================================================
  // VERIFICATION
  // ============================================================

  async getVerificationStatus(): Promise<VerificationStatus> {
    return this.request<VerificationStatus>('GET', '/api/verification/status');
  }

  async sendEmailOTP(): Promise<void> {
    return this.request<void>('POST', '/api/verification/send-email');
  }

  async confirmEmailOTP(code: string): Promise<void> {
    return this.request<void>('POST', '/api/verification/confirm-email', { code });
  }

  async sendSmsOtp(phone: string): Promise<void> {
    return this.request<void>('POST', '/api/verification/send-sms', { phone });
  }

  async confirmSmsOtp(phone: string, code: string): Promise<void> {
    return this.request<void>('POST', '/api/verification/confirm-sms', { phone, code });
  }
}

// Exportar instancia única (singleton)
export const apiClient = new APIClient();
export { APIClient };
