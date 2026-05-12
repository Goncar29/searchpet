// ============================================================
// Lost Pets - Tipos compartidos entre Mobile y Web
// ============================================================

export interface User {
  id: string;
  email: string;
  name: string;
  phone?: string;
  profile_photo_url?: string;
  latitude?: number;
  longitude?: number;
  is_verified: boolean;
  search_radius_meters?: number;
  created_at: string;
}

export interface UserPreferences {
  search_radius_meters: number;
}

export interface PetOwner {
  id: string;
  name: string;
  phone?: string;
  is_verified: boolean;
}

export interface Pet {
  id: string;
  owner_id: string;
  name: string;
  type: PetType;
  breed?: string;
  color?: string;
  description?: string;
  status: PetStatus;
  photos: Photo[];
  owner?: PetOwner;
  created_at: string;
}

export interface Report {
  id: string;
  pet_id: string;
  reporter_id: string;
  status: ReportStatus;
  latitude: number;
  longitude: number;
  location_description?: string;
  is_verified: boolean;
  pet?: Pet;
  reporter?: User;
  occurred_at?: string | null;
  created_at: string;
}

export interface Photo {
  id: string;
  url: string;
  is_primary: boolean;
  created_at: string;
}

export interface Message {
  id: string;
  sender_id: string;
  receiver_id: string;
  report_id?: string;
  text: string;
  is_read: boolean;
  sender?: User;
  created_at: string;
}

export interface ShareLink {
  share_token: string;
  share_url: string;
  expires_at?: string;
}

export interface SharedPetOwner {
  name: string;
  phone?: string;
}

export interface SharedPetInfo {
  id: string;
  name: string;
  type: PetType;
  breed?: string;
  color?: string;
  description?: string;
  status: PetStatus;
  photos: Photo[];
}

export interface SharedPetResponse {
  token: string;
  pet: SharedPetInfo;
  owner: SharedPetOwner;
  expires_at?: string;
  view_count: number;
}

export interface Stats {
  total_users: number;
  total_pets: number;
  total_reports: number;
  found_pets: number;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface UploadPhotoResponse {
  id: string;
  url: string;
  is_primary: boolean;
  created_at: string;
}

// ============================================================
// ENUMS / UNION TYPES
// ============================================================

export type PetType = 'perro' | 'gato' | 'pajaro' | 'otro';
export type PetStatus = 'active' | 'found' | 'archived';
export type ReportStatus = 'lost' | 'found' | 'sighting';
export type Platform = 'instagram' | 'facebook' | 'whatsapp' | 'twitter';

// ============================================================
// REQUEST TYPES
// ============================================================

export interface RegisterRequest {
  email: string;
  password: string;
  name: string;
  phone?: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface CreatePetRequest {
  name: string;
  type: PetType;
  breed?: string;
  color?: string;
  description?: string;
}

export interface UpdatePetRequest {
  name?: string;
  breed?: string;
  color?: string;
  description?: string;
  status?: PetStatus;
}

export interface CreateReportRequest {
  pet_id: string;
  status: ReportStatus;
  latitude: number;
  longitude: number;
  location_description?: string;
  occurred_at?: string; // ISO 8601, opcional; no puede ser fecha futura
}

export interface NearbySearchParams {
  lat: number;
  lng: number;
  radius?: number;
  limit?: number;
}

export interface NearbyReportsResponse {
  data: Report[];
  radius_used: number;
}

export interface PetSearchFilters {
  type?: PetType;
  breed?: string;
  color?: string;
  status?: PetStatus;
  from?: string; // RFC3339
  to?: string;   // RFC3339
  page?: number;
  limit?: number;
}

/** @deprecated Usa PetSearchFilters en su lugar */
export interface PetSearchParams {
  type?: PetType;
  breed?: string;
  color?: string;
  limit?: number;
  offset?: number;
}

export interface PetListResponse {
  data: Pet[];
  total: number;
  page: number;
  limit: number;
}

export interface SendMessageRequest {
  receiver_id: string;
  report_id?: string;
  text: string;
}

// ============================================================
// LOCATION ALERTS
// ============================================================

export interface LocationAlert {
  id: string;
  user_id: string;
  pet_id?: string;
  pet_type?: PetType | string;
  name?: string;
  alert_latitude: number;
  alert_longitude: number;
  radius_km: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateLocationAlertRequest {
  latitude: number;
  longitude: number;
  radius_km?: number;    // default 5 cuando se omite
  pet_type?: string;     // opcional: "perro", "gato", etc.
  name?: string;         // etiqueta amigable, opcional
}

export interface UpdateLocationAlertRequest {
  latitude?: number;
  longitude?: number;
  radius_km?: number;
  pet_type?: string;
  name?: string;
  is_active?: boolean;
}

export interface LocationAlertListResponse {
  data: LocationAlert[];
}

export interface GenerateShareRequest {
  platform?: Platform;
}

export interface UpdateProfileRequest {
  name?: string;
  phone?: string;
}
