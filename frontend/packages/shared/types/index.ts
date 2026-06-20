// ============================================================
// Lost Pets - Tipos compartidos entre Mobile y Web
// ============================================================

export interface User {
  id: string;
  email: string;
  name: string;
  phone?: string;
  city?: string;
  profile_photo_url?: string;
  latitude?: number;
  longitude?: number;
  is_verified: boolean;
  is_admin?: boolean;
  email_verified?: boolean;
  phone_verified?: boolean;
  search_radius_meters?: number;
  created_at: string;
}

export interface VerificationStatus {
  email_verified: boolean;
  phone_verified: boolean;
  is_verified: boolean;
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
  owner_id?: string;
  reporter_id?: string;
  version?: number;
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
  content: string;
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

// ============================================================
// SHELTERS
// ============================================================

export interface Shelter {
  id: string;
  name: string;
  city: string;
  latitude?: number;
  longitude?: number;
  phone?: string;
  email?: string;
  website_url?: string;
  donation_url?: string;
  description?: string;
  is_verified: boolean;
  created_at: string;
}

// ============================================================
// GAMIFICATION
// ============================================================

export interface Badge {
  id: string;
  badge_type: string;
  earned_at: string;
}

export interface UserProfile {
  id: string;
  name: string;
  city: string;
  profile_photo_url?: string;
  total_points: number;
  total_reports: number;
  found_count: number;
  share_count: number;
  badges: Badge[];
  avg_rating: number;
  review_count: number;
}

export interface LeaderboardEntry {
  user_id: string;
  name: string;
  city: string;
  total_points: number;
  rank: number;
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
export type PetStatus = 'registered' | 'lost' | 'stray' | 'found' | 'archived';
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
  city?: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface InitialReportRequest {
  latitude: number;
  longitude: number;
  note?: string;
}

export interface CreatePetRequest {
  name: string;
  type: PetType;
  breed?: string;
  color?: string;
  description?: string;
  status?: 'registered' | 'stray';
  initial_report?: InitialReportRequest;
}

export interface PublishLostRequest {
  latitude: number;
  longitude: number;
  note?: string;
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

export interface Vet {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  address?: string;
  phone?: string;
  website?: string;
  opening_hours?: string;
  distance_meters: number;
}

export interface VetsNearbyParams {
  lat: number;
  lng: number;
  radius?: number; // meters
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
  // Optional distance filter — all three together restrict results to pets
  // with a report within `radiusMeters` of (lat, lng). Omit for no geo filter.
  lat?: number;
  lng?: number;
  radiusMeters?: number; // meters
  page?: number;
  limit?: number;
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
  content: string;
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
  city?: string;
}

// ============================================================
// SAFETY — Blocking & Abuse Reports
// ============================================================

export type AbuseReason = 'spam' | 'fake' | 'abuse' | 'inappropriate' | 'other';

export interface BlockedUser {
  id: string;
  blocked_id: string;
  name: string;
  blocked_at: string;
}

export interface AbuseReport {
  id: string;
  target_user_id?: string;
  target_report_id?: string;
  reporter_id: string;
  reason: AbuseReason;
  status: string;
  created_at: string;
}

export interface CreateAbuseReportRequest {
  target_user_id?: string;
  target_report_id?: string;
  reason: AbuseReason;
}

export interface BlockUserRequest {
  reason?: string;
}

// ============================================================
// SUCCESS STORIES
// ============================================================

export interface SuccessStory {
  id: string;
  pet_id: string;
  user_id: string;
  title: string;
  body: string;
  photo_before?: string;
  photo_after?: string;
  like_count: number;
  liked_by_me: boolean;
  featured: boolean;
  pet_name: string;
  user_name: string;
  hero_name?: string;
  created_at: string;
}

export interface CreateStoryRequest {
  pet_id: string;
  title?: string;
  body: string;
  hero_name?: string;
}

export type StoryListResponse = SuccessStory[];

// ============================================================
// REVIEWS
// ============================================================

export interface UserReview {
  id: string;
  reviewer_id: string;
  reviewer_name: string;
  reviewer_photo: string | null;
  stars: number;
  text: string;
  created_at: string;
  updated_at: string;
}

export const BADGE_META: Record<string, { emoji: string; labelKey: string; descriptionKey: string }> = {
  first_helper:       { emoji: '🤝', labelKey: 'badges:first_helper.label',       descriptionKey: 'badges:first_helper.description' },
  pet_rescuer:        { emoji: '🦸', labelKey: 'badges:pet_rescuer.label',        descriptionKey: 'badges:pet_rescuer.description' },
  social_butterfly:   { emoji: '📣', labelKey: 'badges:social_butterfly.label',   descriptionKey: 'badges:social_butterfly.description' },
  verified_finder:    { emoji: '✅', labelKey: 'badges:verified_finder.label',    descriptionKey: 'badges:verified_finder.description' },
  community_guardian: { emoji: '🛡️', labelKey: 'badges:community_guardian.label', descriptionKey: 'badges:community_guardian.description' },
  super_finder:       { emoji: '🌟', labelKey: 'badges:super_finder.label',       descriptionKey: 'badges:super_finder.description' },
};

export interface CreateReviewRequest {
  stars: number;
  text: string;
}

export interface UpdateReviewRequest {
  stars: number;
  text: string;
}

export interface ReviewListResponse {
  reviews: UserReview[];
  total: number;
  page: number;
  page_size: number;
}

// ============================================================
// LOCAL GROUPS
// ============================================================

export interface LocalGroup {
  id: string;
  city: string;
  name: string;
  description?: string;
  member_count: number;
  created_by: string;
  created_at: string;
  is_member?: boolean;
}

export interface GroupMember {
  user_id: string;
  name: string;
  profile_photo_url?: string;
  joined_at: string;
}

export type GroupListResponse = LocalGroup[];

// ============================================================
// IMAGE SEARCH (server-side CLIP similarity)
// ============================================================

/**
 * A single result from POST /api/pets/search/image.
 * The search photo is never persisted — embeddings are generated on the fly.
 */
export interface ImageSearchResult {
  pet_id: string;
  name: string;
  type: string;
  photo_url: string;
  similarity: number;
  owner_id: string;
}

/** Response body of POST /api/pets/search/image. */
export interface ImageSearchResponse {
  results: ImageSearchResult[];
}

// ============================================================
// IMAGE CLASSIFICATION
// ============================================================

/**
 * Result returned by useImageClassify after running MobileNet inference.
 * type and breed are null when no pet is detected above the confidence threshold.
 */
export interface ClassifyResult {
  type: PetType | null;    // SearchPet pet type ('perro', 'gato', etc.) or null if no match
  breed: string | null;    // breed string or null if no breed mapping
  confidence: number;      // 0-1, highest confidence score of the matched prediction
  rawLabels: string[];     // top-5 MobileNet class names returned by the model
}
