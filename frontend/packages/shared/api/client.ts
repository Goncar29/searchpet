// ============================================================
// Lost Pets - Cliente API compartido (Mobile + Web)
// ============================================================

import { API_BASE_URL } from './baseURL';

// Typed error class — carries the machine-readable `code` from the backend
// ErrorResponse (`{code, message}`). UI layers use `code` to drive i18n lookups.
export class ApiError extends Error {
  code: string;
  status: number;
  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

import type {
  AuthResponse,
  RegisterRequest,
  LoginRequest,
  User,
  UserPreferences,
  Pet,
  CreatePetRequest,
  UpdatePetRequest,
  PublishLostRequest,
  UpdateProfileRequest,
  PetSearchFilters,
  PetListResponse,
  Report,
  CreateReportRequest,
  NearbySearchParams,
  NearbyReportsResponse,
  Vet,
  VetsNearbyParams,
  Message,
  SendMessageRequest,
  ShareLink,
  SharedPetResponse,
  GenerateShareRequest,
  Stats,
  UploadPhotoResponse,
  ImageSearchResponse,
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
  Shelter,
  AdminAuditListResponse,
  AdminRoleResult,
} from '../types';


// Default ceiling for normal API requests. Generous on purpose: the backend
// runs on Render's free tier, which sleeps after inactivity and can take
// ~30-50s to cold-start. A tighter ceiling would fail every first request
// after the service idles. This bounds failure (a down/hung backend surfaces
// an error instead of an infinite spinner) — it does NOT make requests "fast".
const REQUEST_TIMEOUT_MS = 45000;
// Wider ceiling for multipart uploads and CLIP image search, which legitimately
// take longer (large request bodies, HuggingFace inference latency).
const UPLOAD_TIMEOUT_MS = 90000;

// fetch() has no built-in timeout: if the server accepts the connection but
// never responds, the promise hangs forever. AbortController gives the request
// a deadline so the UI can show an error instead of spinning indefinitely.
// On timeout we throw a typed ApiError with the `request_timeout` code so the
// existing getErrorMessage()/i18n path renders a translated message.
async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (err) {
    // AbortController.abort() rejects fetch with an AbortError. Translate it
    // into our typed error; re-throw anything else (real network failures).
    if (err instanceof Error && err.name === 'AbortError') {
      throw new ApiError('request_timeout', 0, `Request timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}


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

    const response = await fetchWithTimeout(url.toString(), {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    }, REQUEST_TIMEOUT_MS);

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      const code = body.code ?? 'unknown_error';
      const message = body.message ?? `HTTP Error ${response.status}`;
      if (response.status === 401) {
        this.token = null;
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('auth:session-expired'));
        }
      }
      throw new ApiError(code, response.status, message);
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

    const response = await fetchWithTimeout(url, { method: 'POST', headers, body: formData }, UPLOAD_TIMEOUT_MS);
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      const code = body.code ?? 'unknown_error';
      const message = body.message ?? `HTTP Error ${response.status}`;
      if (response.status === 401) {
        this.token = null;
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('auth:session-expired'));
        }
      }
      throw new ApiError(code, response.status, message);
    }
    return response.json();
  }

  // ============================================================
  // PETS
  // ============================================================

  async createPet(data: CreatePetRequest): Promise<Pet> {
    return this.request<Pet>('POST', '/api/pets', data);
  }

  async publishPetLost(petId: string, data: PublishLostRequest): Promise<Pet> {
    return this.request<Pet>('POST', `/api/pets/${petId}/publish-lost`, data);
  }

  async getPetByID(id: string): Promise<Pet> {
    return this.request<Pet>('GET', `/api/pets/${id}`);
  }

  async getMyPets(): Promise<Pet[]> {
    return this.request<Pet[]>('GET', '/api/pets/mine');
  }

  async getReportedPets(): Promise<Pet[]> {
    return this.request<Pet[]>('GET', '/api/pets/reported');
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
    // Geo filter — only sent when all three are present (the backend requires
    // lat+lng+radius together; partial params are rejected with 400).
    if (filters.lat !== undefined && filters.lng !== undefined && filters.radiusMeters !== undefined) {
      params['lat'] = filters.lat;
      params['lng'] = filters.lng;
      params['radius'] = filters.radiusMeters;
    }
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

    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers,
      body: formData,
    }, UPLOAD_TIMEOUT_MS);

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      const code = body.code ?? 'unknown_error';
      const message = body.message ?? `HTTP Error ${response.status}`;
      if (response.status === 401) {
        this.token = null;
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('auth:session-expired'));
        }
      }
      throw new ApiError(code, response.status, message);
    }

    return response.json();
  }

  // searchPetsByImage envía una foto por multipart (campo "photo") a
  // POST /api/pets/search/image y retorna las mascotas perdidas/callejeras más
  // similares ordenadas por similitud. La foto NUNCA se persiste — requiere auth.
  async searchPetsByImage(file: File): Promise<ImageSearchResponse> {
    const url = `${this.baseURL}/api/pets/search/image`;

    const formData = new FormData();
    formData.append('photo', file);

    const headers: Record<string, string> = {};
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const response = await fetchWithTimeout(url, { method: 'POST', headers, body: formData }, UPLOAD_TIMEOUT_MS);

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      const code = body.code ?? 'unknown_error';
      const message = body.message ?? `HTTP Error ${response.status}`;
      if (response.status === 401) {
        this.token = null;
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('auth:session-expired'));
        }
      }
      throw new ApiError(code, response.status, message);
    }

    return response.json();
  }

  // Versión para React Native — mismo endpoint que searchPetsByImage pero con
  // FormData { uri, name, type } porque RN no tiene la API File del browser.
  async searchPetsByImageNative(uri: string): Promise<ImageSearchResponse> {
    const url = `${this.baseURL}/api/pets/search/image`;

    const formData = new FormData();
    const filename = uri.split('/').pop() || 'photo.jpg';
    const ext = (filename.split('.').pop() || 'jpg').toLowerCase();
    const mimeType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
    formData.append('photo', { uri, name: filename, type: mimeType } as unknown as Blob);

    const headers: Record<string, string> = {};
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const response = await fetchWithTimeout(url, { method: 'POST', headers, body: formData }, UPLOAD_TIMEOUT_MS);

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      const code = body.code ?? 'unknown_error';
      const message = body.message ?? `HTTP Error ${response.status}`;
      if (response.status === 401) {
        this.token = null;
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('auth:session-expired'));
        }
      }
      throw new ApiError(code, response.status, message);
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

    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers,
      body: formData,
    }, UPLOAD_TIMEOUT_MS);

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      const code = body.code ?? 'unknown_error';
      const message = body.message ?? `HTTP Error ${response.status}`;
      if (response.status === 401) {
        this.token = null;
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('auth:session-expired'));
        }
      }
      throw new ApiError(code, response.status, message);
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

    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers,
      body: formData,
    }, UPLOAD_TIMEOUT_MS);

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      const code = body.code ?? 'unknown_error';
      const message = body.message ?? `HTTP Error ${response.status}`;
      if (response.status === 401) {
        this.token = null;
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('auth:session-expired'));
        }
      }
      throw new ApiError(code, response.status, message);
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

  async getNearbyVets(params: VetsNearbyParams): Promise<Vet[]> {
    const queryParams: Record<string, string | number> = {
      lat: params.lat,
      lng: params.lng,
    };
    if (params.radius) {
      queryParams['radius'] = params.radius;
    }
    return this.request<Vet[]>('GET', '/api/vets/nearby', undefined, queryParams);
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

  // Public, idempotent share link for lost/stray pets. No auth required: returns
  // the pet's existing active link or creates one. The backend enforces the
  // lost/stray status guard (404 for anything else), so a finder can share even
  // when logged out. Repeating the call does NOT create new rows.
  async getOrCreatePublicShareLink(petID: string): Promise<ShareLink> {
    return this.request<ShareLink>('POST', `/api/pets/${petID}/share-link`);
  }

  // Auth-aware resolver used by the pet-detail share/flyer controls so EVERY
  // finder can share a lost/stray pet:
  //  - Logged out → public endpoint directly.
  //  - Logged in  → protected endpoint first (the owner earns share.created
  //    points), falling back to the public endpoint on 401/403 (e.g. a
  //    logged-in neighbor who is not the owner/reporter).
  // Non-lost/stray pets surface the public endpoint's 404 to the caller, which
  // the UI turns into an "iniciá sesión / no disponible" message.
  async getOrCreateShareLink(petID: string, data?: GenerateShareRequest): Promise<ShareLink> {
    if (!this.token) {
      return this.getOrCreatePublicShareLink(petID);
    }
    try {
      return await this.generateShareLink(petID, data);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        return this.getOrCreatePublicShareLink(petID);
      }
      throw err;
    }
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
  // SHELTERS (público)
  // ============================================================

  async getShelters(city?: string): Promise<Shelter[]> {
    const params: Record<string, string> = {};
    if (city) params.city = city;
    return this.request<Shelter[]>('GET', '/api/shelters', undefined, params);
  }

  async getShelterByID(id: string): Promise<Shelter> {
    return this.request<Shelter>('GET', `/api/shelters/${encodeURIComponent(id)}`);
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

  async getBlockStatus(userId: string): Promise<{ is_blocked: boolean }> {
    return this.request<{ is_blocked: boolean }>('GET', `/api/users/${userId}/block-status`);
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

  async likeStory(id: string): Promise<{ like_count: number; liked: boolean }> {
    return this.request<{ like_count: number; liked: boolean }>('POST', `/api/stories/${id}/like`);
  }

  async unlikeStory(id: string): Promise<{ like_count: number; liked: boolean }> {
    return this.request<{ like_count: number; liked: boolean }>('DELETE', `/api/stories/${id}/like`);
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

  async deleteReview(userId: string): Promise<void> {
    return this.request<void>('DELETE', `/api/users/${userId}/reviews`);
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

  // ============================================================
  // ADMIN
  // ============================================================

  async listAbuseReports(params?: { resolved?: boolean; limit?: number; offset?: number }): Promise<AbuseReport[]> {
    const queryParams: Record<string, string | number> = {};
    if (params?.resolved !== undefined) queryParams['resolved'] = String(params.resolved);
    if (params?.limit !== undefined) queryParams['limit'] = params.limit;
    if (params?.offset !== undefined) queryParams['offset'] = params.offset;
    return this.request<AbuseReport[]>('GET', '/api/abuse-reports', undefined, queryParams);
  }

  async getAbuseReport(id: string): Promise<AbuseReport> {
    return this.request<AbuseReport>('GET', `/api/abuse-reports/${id}`);
  }

  async resolveAbuseReport(id: string, body: { status: 'resolved' | 'dismissed' }): Promise<AbuseReport> {
    return this.request<AbuseReport>('PATCH', `/api/admin/abuse-reports/${id}/resolve`, body);
  }

  // Admin moderation actions. `id` is the REPORT id for deleteReport and the
  // USER id for ban/unban. An empty reason is sent as no body (backend treats it
  // as "no reason"). All return the backend's { message } acknowledgement.
  async deleteReport(id: string): Promise<{ message: string }> {
    return this.request<{ message: string }>('DELETE', `/api/admin/reports/${id}`);
  }

  async banUser(id: string, reason?: string): Promise<{ message: string }> {
    return this.request<{ message: string }>(
      'PATCH',
      `/api/admin/users/${id}/ban`,
      reason ? { reason } : undefined
    );
  }

  async unbanUser(id: string): Promise<{ message: string }> {
    return this.request<{ message: string }>('PATCH', `/api/admin/users/${id}/unban`);
  }

  async verifyReport(id: string): Promise<Report> {
    return this.request<Report>('PATCH', `/api/admin/reports/${id}/verify`);
  }

  async setStoryFeatured(id: string, featured: boolean): Promise<SuccessStory> {
    return this.request<SuccessStory>('PATCH', `/api/admin/stories/${id}/featured`, { featured });
  }

  async adminDeleteStory(id: string): Promise<void> {
    return this.request<void>('DELETE', `/api/admin/stories/${id}`);
  }

  async createGroup(body: { name: string; city: string; description?: string }): Promise<LocalGroup> {
    return this.request<LocalGroup>('POST', '/api/groups', body);
  }

  async setUserAdmin(email: string, grant: boolean): Promise<AdminRoleResult> {
    return this.request<AdminRoleResult>('POST', '/api/admin/users/admin-role', { email, grant });
  }

  async getRoleChanges(page = 1, limit = 50): Promise<AdminAuditListResponse> {
    return this.request<AdminAuditListResponse>('GET', `/api/admin/role-changes?page=${page}&limit=${limit}`);
  }
}

// Exportar instancia única (singleton)
export const apiClient = new APIClient();
export { APIClient };
