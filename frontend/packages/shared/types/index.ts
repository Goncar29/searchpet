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
  created_at: string;
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
  platforms: Record<string, string>;
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
}

export interface NearbySearchParams {
  lat: number;
  lng: number;
  radius?: number;
  limit?: number;
}

export interface PetSearchParams {
  type?: PetType;
  breed?: string;
  color?: string;
  limit?: number;
  offset?: number;
}

export interface SendMessageRequest {
  receiver_id: string;
  report_id?: string;
  text: string;
}

export interface GenerateShareRequest {
  platform?: Platform;
}
