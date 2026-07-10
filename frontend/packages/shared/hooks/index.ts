// ============================================================
// Lost Pets - Custom Hooks compartidos (Mobile + Web)
// Requiere: @tanstack/react-query
// ============================================================

export * from './useWebSocket';
export * from './useImageClassify';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import type {
  CreatePetRequest,
  UpdatePetRequest,
  UpdateProfileRequest,
  PetSearchFilters,
  CreateReportRequest,
  NearbyReportsResponse,
  SendMessageRequest,
  Message,
  GenerateShareRequest,
  SharedPetResponse,
  UploadPhotoResponse,
  ImageSearchResponse,
  User,
  BlockedUser,
  AbuseReport,
  CreateAbuseReportRequest,
  BlockUserRequest,
  SuccessStory,
  CreateStoryRequest,
  StoryListResponse,
  CreateLocationAlertRequest,
  UpdateLocationAlertRequest,
  UserReview,
  CreateReviewRequest,
  UpdateReviewRequest,
  LocalGroup,
  GroupMember,
  VerificationStatus,
  Shelter,
  Pet,
  PublishLostRequest,
  Vet,
} from '../types';

// ============================================================
// AUTH HOOKS
// ============================================================

export const useGetMe = () => {
  return useQuery<User>({
    queryKey: ['me'],
    queryFn: () => apiClient.getMe(),
  });
};

export const useUpdateMe = () => {
  const queryClient = useQueryClient();
  return useMutation<User, Error, UpdateProfileRequest>({
    mutationFn: (data) => apiClient.updateMe(data),
    onSuccess: (updatedUser) => {
      queryClient.setQueryData(['me'], updatedUser);
    },
  });
};

export const useUploadProfilePhoto = () => {
  const queryClient = useQueryClient();
  return useMutation<User, Error, File>({
    mutationFn: (file) => apiClient.uploadProfilePhoto(file),
    onSuccess: (updatedUser) => {
      queryClient.setQueryData(['me'], updatedUser);
    },
  });
};

export const useUploadProfilePhotoNative = () => {
  const queryClient = useQueryClient();
  return useMutation<User, Error, string>({
    mutationFn: (uri) => apiClient.uploadProfilePhotoNative(uri),
    onSuccess: (updatedUser) => {
      queryClient.setQueryData(['me'], updatedUser);
    },
  });
};

export const useLogin = () => {
  return useMutation({
    mutationFn: (data: { email: string; password: string }) =>
      apiClient.login(data),
  });
};

export const useRegister = () => {
  return useMutation({
    mutationFn: (data: { email: string; password: string; name: string; phone?: string }) =>
      apiClient.register(data),
  });
};

// ============================================================
// PET HOOKS
// ============================================================

export const useMyPets = (enabled: boolean = true) => {
  return useQuery({
    queryKey: ['pets', 'mine'],
    queryFn: () => apiClient.getMyPets(),
    enabled,
  });
};

// useReportedPets — stray pets the authenticated user reported (GET /api/pets/reported).
export const useReportedPets = (enabled: boolean = true) => {
  return useQuery({
    queryKey: ['pets', 'reported'],
    queryFn: () => apiClient.getReportedPets(),
    enabled,
  });
};

export const usePetByID = (id: string) => {
  return useQuery({
    queryKey: ['pets', id],
    queryFn: () => apiClient.getPetByID(id),
    enabled: !!id,
  });
};

export const useSearchPets = (params: PetSearchFilters) => {
  return useQuery({
    queryKey: ['pets', 'search', params],
    queryFn: () => apiClient.searchPets(params),
  });
};

export const useCreatePet = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreatePetRequest) => apiClient.createPet(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pets'] });
    },
  });
};

export const useUpdatePet = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdatePetRequest }) =>
      apiClient.updatePet(id, data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['pets'] });
      queryClient.invalidateQueries({ queryKey: ['pets', id] });
      // A status change (e.g. lost/found via the PetCard selector) moves the home
      // lifetime impact counters — refresh them so they don't show a stale value.
      queryClient.invalidateQueries({ queryKey: ['stats'] });
    },
  });
};

export const useDeletePet = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.deletePet(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pets'] });
    },
  });
};

export const useMarkPetAsFound = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.markPetAsFound(id),
    onSuccess: (updatedPet) => {
      queryClient.setQueryData(['pets', updatedPet.id], updatedPet);
      queryClient.invalidateQueries({ queryKey: ['pets'] });
      // Invalidate reports so the map reflects the updated pet status immediately.
      queryClient.invalidateQueries({ queryKey: ['reports'] });
      // Marking found bumps the "pets reunited" home counter.
      queryClient.invalidateQueries({ queryKey: ['stats'] });
    },
  });
};

export const useUploadPhoto = () => {
  const queryClient = useQueryClient();
  return useMutation<UploadPhotoResponse, Error, { petId: string; file: File }>({
    mutationFn: ({ petId, file }) => apiClient.uploadPhoto(petId, file),
    onSuccess: (_, { petId }) => {
      // Invalidar el cache de la mascota para que se refresque con la nueva foto,
      // y las listas donde puede aparecer: "Mis mascotas" y "Mis reportes" (strays).
      queryClient.invalidateQueries({ queryKey: ['pets', petId] });
      queryClient.invalidateQueries({ queryKey: ['pets', 'mine'] });
      queryClient.invalidateQueries({ queryKey: ['pets', 'reported'] });
    },
  });
};

// Versión React Native — recibe URI local en lugar de File
export const useUploadPhotoNative = () => {
  const queryClient = useQueryClient();
  return useMutation<UploadPhotoResponse, Error, { petId: string; uri: string }>({
    mutationFn: ({ petId, uri }) => apiClient.uploadPhotoNative(petId, uri),
    onSuccess: (_, { petId }) => {
      queryClient.invalidateQueries({ queryKey: ['pets', petId] });
      queryClient.invalidateQueries({ queryKey: ['pets', 'mine'] });
      queryClient.invalidateQueries({ queryKey: ['pets', 'reported'] });
    },
  });
};

// ============================================================
// PUBLISH HOOKS
// ============================================================

// usePublishLost — POST /api/pets/:id/publish-lost. Transitions an owned
// registered pet to `lost` and creates its initial location report
// (single backend transaction). Invalidates feed, my-pets, and the pet detail.
export const usePublishLost = () => {
  const queryClient = useQueryClient();
  return useMutation<Pet, Error, { id: string; data: PublishLostRequest }>({
    mutationFn: ({ id, data }) => apiClient.publishPetLost(id, data),
    onSuccess: (pet) => {
      queryClient.invalidateQueries({ queryKey: ['pets'] });
      queryClient.invalidateQueries({ queryKey: ['pets', pet.id] });
      queryClient.invalidateQueries({ queryKey: ['pets', 'mine'] });
      queryClient.invalidateQueries({ queryKey: ['reports'] });
      // Publishing as lost opens a search episode → "searches started" counter.
      queryClient.invalidateQueries({ queryKey: ['stats'] });
    },
  });
};

export interface PublishStrayResult {
  pet: Pet;
  failedPhotoIndexes: number[];
}

// Shared chain logic for usePublishStray / usePublishStrayNative:
// createPet({ status: 'stray', initial_report }) followed by sequential photo
// uploads. If a photo upload fails the pet is already created — we resolve
// with `failedPhotoIndexes` instead of throwing, so the wizard can show a
// one-tap retry screen (design: "photo atomicity"). Generic over the photo
// type (`File` for web, `string` URI for React Native).
const createPublishStrayMutationFn = <TPhoto>(uploadFn: (petId: string, photo: TPhoto) => Promise<unknown>) => {
  return async ({ pet, photos }: { pet: CreatePetRequest; photos: TPhoto[] }): Promise<PublishStrayResult> => {
    const created = await apiClient.createPet(pet);
    const failedPhotoIndexes: number[] = [];
    for (let i = 0; i < photos.length; i++) {
      try {
        await uploadFn(created.id, photos[i]);
      } catch {
        failedPhotoIndexes.push(i);
      }
    }
    return { pet: created, failedPhotoIndexes };
  };
};

// Shared onSuccess invalidation set for usePublishStray / usePublishStrayNative,
// matching sibling usePublishLost's invalidation set.
const invalidatePublishStrayQueries = (queryClient: ReturnType<typeof useQueryClient>, result: PublishStrayResult) => {
  queryClient.invalidateQueries({ queryKey: ['pets'] });
  queryClient.invalidateQueries({ queryKey: ['pets', 'mine'] });
  queryClient.invalidateQueries({ queryKey: ['pets', result.pet.id] });
  queryClient.invalidateQueries({ queryKey: ['reports'] });
  // A stray sighting opens a search episode → "searches started" counter.
  queryClient.invalidateQueries({ queryKey: ['stats'] });
};

// usePublishStray — chains createPet({ status: 'stray', initial_report }) with
// sequential photo uploads (web File[]). See createPublishStrayMutationFn for
// the shared chain logic.
export const usePublishStray = () => {
  const queryClient = useQueryClient();
  const mutationFn = createPublishStrayMutationFn<File>((petId, photo) => apiClient.uploadPhoto(petId, photo));
  return useMutation<PublishStrayResult, Error, { pet: CreatePetRequest; photos: File[] }>({
    mutationFn,
    onSuccess: (result) => invalidatePublishStrayQueries(queryClient, result),
  });
};

// Versión React Native de usePublishStray — recibe URIs locales en lugar de File.
export const usePublishStrayNative = () => {
  const queryClient = useQueryClient();
  const mutationFn = createPublishStrayMutationFn<string>((petId, uri) => apiClient.uploadPhotoNative(petId, uri));
  return useMutation<PublishStrayResult, Error, { pet: CreatePetRequest; photoUris: string[] }>({
    mutationFn: ({ pet, photoUris }) => mutationFn({ pet, photos: photoUris }),
    onSuccess: (result) => invalidatePublishStrayQueries(queryClient, result),
  });
};

// useImageSearch — POST /api/pets/search/image (server-side CLIP similarity).
// Requires auth; the photo is never persisted. Mutation so the caller
// triggers it explicitly when the user picks a photo.
export const useImageSearch = () => {
  return useMutation<ImageSearchResponse, Error, File>({
    mutationFn: (file) => apiClient.searchPetsByImage(file),
  });
};

// Versión React Native de useImageSearch — recibe una URI local en lugar de File.
export const useImageSearchNative = () => {
  return useMutation<ImageSearchResponse, Error, string>({
    mutationFn: (uri) => apiClient.searchPetsByImageNative(uri),
  });
};

// ============================================================
// REPORT HOOKS
// ============================================================

// radius en km (ej: 5 = 5 km). Internamente se convierte a metros para la API.
export const useNearbyReports = (lat: number, lng: number, radius = 5, enabled = true) => {
  const query = useQuery<NearbyReportsResponse>({
    queryKey: ['reports', 'nearby', lat, lng, radius],
    queryFn: () => apiClient.getNearbyReports({ lat, lng, radius: radius * 1000 }),
    enabled: enabled && !!lat && !!lng,
    staleTime: 5 * 60 * 1000, // 5 minutos
  });
  return {
    ...query,
    data: query.data?.data,         // Report[] | undefined — backward compatible
    radiusUsed: query.data?.radius_used,
  };
};

// radiusMeters en metros (default 5000). enabled=false por defecto: la query
// solo dispara cuando la UI lo activa ("buscar en esta zona" / toggle de capa).
export const useNearbyVets = (lat: number, lng: number, radiusMeters = 5000, enabled = false) => {
  return useQuery<Vet[]>({
    queryKey: ['vets', 'nearby', lat, lng, radiusMeters],
    queryFn: () => apiClient.getNearbyVets({ lat, lng, radius: radiusMeters }),
    enabled: enabled && !!lat && !!lng,
    staleTime: 30 * 60 * 1000, // 30 min — los vets casi no cambian
  });
};

export const useReportsByPetID = (petID: string) => {
  return useQuery({
    queryKey: ['reports', 'pet', petID],
    queryFn: () => apiClient.getReportsByPetID(petID),
    enabled: !!petID,
  });
};

export const useCreateReport = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateReportRequest) => apiClient.createReport(data),
    onSuccess: () => {
      // Invalidate all report queries (prefix match covers ['reports', 'nearby', ...]).
      queryClient.invalidateQueries({ queryKey: ['reports'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
      // Creating a report can change the pet's status — invalidate pet cache too.
      queryClient.invalidateQueries({ queryKey: ['pets'] });
    },
  });
};

// ============================================================
// MESSAGE HOOKS
// ============================================================

export const useConversations = () => {
  return useQuery({
    queryKey: ['messages'],
    queryFn: () => apiClient.getConversations(),
    refetchInterval: 15000, // Refrescar cada 15 segundos
  });
};

// Unread badge count. Initial value comes from REST; while connected, the
// WebSocket badge_update envelope overwrites the cache via setQueryData.
// The 30s poll is the fallback for when the socket is down. The key lives
// under the ['messages'] prefix so existing invalidations refresh it too.
export const useUnreadCount = (enabled = true) => {
  return useQuery({
    queryKey: ['messages', 'unread-count'],
    queryFn: () => apiClient.getUnreadCount(),
    enabled,
    refetchInterval: 30_000,
  });
};

// useConversation does NOT poll — real-time updates are pushed via useWebSocket.
// A 30s staleTime ensures we don't hammer the REST API on quick re-mounts.
export const useConversation = (userID: string) => {
  return useQuery({
    queryKey: ['messages', userID],
    queryFn: () => apiClient.getConversation(userID),
    enabled: !!userID,
    staleTime: 30_000,
  });
};

export const useSendMessage = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: SendMessageRequest) => apiClient.sendMessage(data),
    onSuccess: (_, { receiver_id }) => {
      queryClient.invalidateQueries({ queryKey: ['messages', receiver_id.toString()] });
      queryClient.invalidateQueries({ queryKey: ['messages'] });
    },
  });
};

export const useSendMessageTo = () => {
  const queryClient = useQueryClient();
  return useMutation<Message, Error, { receiverID: string; senderID: string; content: string; reportID?: string }>({
    mutationFn: ({ receiverID, content, reportID }) =>
      apiClient.sendMessageTo(receiverID, content, reportID),
    onMutate: async ({ receiverID, senderID, content }) => {
      await queryClient.cancelQueries({ queryKey: ['messages', receiverID] });
      const previous = queryClient.getQueryData<Message[]>(['messages', receiverID]);
      const optimistic: Message = {
        id: `temp-${Date.now()}`,
        sender_id: senderID,
        receiver_id: receiverID,
        content,
        is_read: false,
        created_at: new Date().toISOString(),
      };
      queryClient.setQueryData<Message[]>(['messages', receiverID], (old) => [...(old ?? []), optimistic]);
      return { previous };
    },
    onError: (_err, { receiverID }, context) => {
      const ctx = context as { previous: Message[] | undefined } | undefined;
      if (ctx?.previous) queryClient.setQueryData(['messages', receiverID], ctx.previous);
    },
    onSettled: (_, __, { receiverID }) => {
      queryClient.invalidateQueries({ queryKey: ['messages', receiverID] });
      queryClient.invalidateQueries({ queryKey: ['messages'] });
    },
  });
};

export const useMarkAsRead = () => {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (messageId) => apiClient.markAsRead(messageId),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['messages'] });
    },
  });
};

// ============================================================
// SHARE HOOKS
// ============================================================

export const useGenerateShareLink = () => {
  return useMutation({
    mutationFn: ({ petID, data }: { petID: string; data?: GenerateShareRequest }) =>
      apiClient.generateShareLink(petID, data),
  });
};

// Auth-aware share link for the pet-detail share/flyer controls. Works for
// logged-out finders on lost/stray pets (public endpoint) and keeps the owner's
// protected flow when authenticated. See apiClient.getOrCreateShareLink.
export const useShareLink = () => {
  return useMutation({
    mutationFn: ({ petID, data }: { petID: string; data?: GenerateShareRequest }) =>
      apiClient.getOrCreateShareLink(petID, data),
  });
};

export const useSharedPet = (token: string) => {
  return useQuery<SharedPetResponse>({
    queryKey: ['shared', token],
    queryFn: () => apiClient.getSharedPet(token),
    enabled: !!token,
  });
};

// ============================================================
// LOCATION ALERT HOOKS
// ============================================================

export const useAlerts = () => {
  return useQuery({
    queryKey: ['alerts'],
    queryFn: () => apiClient.getAlerts(),
  });
};

export const useCreateAlert = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateLocationAlertRequest) => apiClient.createAlert(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alerts'] });
    },
  });
};

export const useUpdateAlert = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateLocationAlertRequest }) =>
      apiClient.updateAlert(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alerts'] });
    },
  });
};

export const useDeleteAlert = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.deleteAlert(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alerts'] });
    },
  });
};

// ============================================================
// STATS HOOKS
// ============================================================

export const useStats = () => {
  return useQuery({
    queryKey: ['stats'],
    queryFn: () => apiClient.getStats(),
    staleTime: 30 * 60 * 1000, // 30 minutos
  });
};

// ============================================================
// SHELTER HOOKS
// ============================================================

export const useShelters = (city?: string) => {
  return useQuery<Shelter[]>({
    queryKey: ['shelters', city],
    queryFn: () => apiClient.getShelters(city),
    staleTime: 10 * 60 * 1000, // 10 minutos — datos cambian poco
  });
};

export const useShelterByID = (id: string) => {
  return useQuery<Shelter>({
    queryKey: ['shelter', id],
    queryFn: () => apiClient.getShelterByID(id),
    enabled: !!id,
  });
};

// ============================================================
// GAMIFICATION HOOKS
// ============================================================

export const usePublicProfile = (userID: string) => {
  return useQuery({
    queryKey: ['profile', userID],
    queryFn: () => apiClient.getPublicProfile(userID),
    enabled: !!userID,
  });
};

export const useLeaderboard = (city: string, limit = 10) => {
  return useQuery({
    queryKey: ['leaderboard', city, limit],
    queryFn: () => apiClient.getLeaderboard(city, limit),
    enabled: !!city,
    staleTime: 5 * 60 * 1000, // 5 minutos
  });
};

export const useMyBadges = () => {
  return useQuery({
    queryKey: ['badges', 'me'],
    queryFn: () => apiClient.getMyBadges(),
  });
};

// ============================================================
// BLOCKING & ABUSE REPORT HOOKS
// ============================================================

export const useBlockedUsers = () => {
  return useQuery<BlockedUser[]>({
    queryKey: ['blocked-users'],
    queryFn: () => apiClient.getBlockedUsers(),
  });
};

export const useBlockStatus = (userId: string | undefined) => {
  const query = useQuery<{ is_blocked: boolean }>({
    queryKey: ['block-status', userId],
    queryFn: () => apiClient.getBlockStatus(userId!),
    enabled: !!userId,
  });
  return {
    isBlocked: query.data?.is_blocked ?? false,
    isLoading: query.isLoading,
  };
};

export const useBlockUser = () => {
  const queryClient = useQueryClient();
  return useMutation<void, Error, { userId: string; data?: BlockUserRequest }>({
    mutationFn: ({ userId, data }) => apiClient.blockUser(userId, data),
    onSuccess: (_, { userId }) => {
      queryClient.invalidateQueries({ queryKey: ['blocked-users'] });
      queryClient.invalidateQueries({ queryKey: ['messages'] });
      queryClient.invalidateQueries({ queryKey: ['block-status', userId] });
    },
  });
};

export const useUnblockUser = () => {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (userId) => apiClient.unblockUser(userId),
    onSuccess: (_, userId) => {
      queryClient.invalidateQueries({ queryKey: ['blocked-users'] });
      queryClient.invalidateQueries({ queryKey: ['messages'] });
      queryClient.invalidateQueries({ queryKey: ['block-status', userId] });
    },
  });
};

export const useSubmitAbuseReport = () => {
  return useMutation<AbuseReport, Error, CreateAbuseReportRequest>({
    mutationFn: (data) => apiClient.submitAbuseReport(data),
  });
};

// ============================================================
// SUCCESS STORY HOOKS
// ============================================================

export const useStories = (params?: { featured?: boolean; limit?: number; offset?: number }) => {
  return useQuery<StoryListResponse>({
    queryKey: ['stories', params],
    queryFn: () => apiClient.getStories(params),
  });
};

export const useStory = (id: string) => {
  return useQuery<SuccessStory>({
    queryKey: ['stories', id],
    queryFn: () => apiClient.getStory(id),
    enabled: !!id,
  });
};

export const useCreateStory = () => {
  const queryClient = useQueryClient();
  return useMutation<SuccessStory, Error, CreateStoryRequest>({
    mutationFn: (data) => apiClient.createStory(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stories'] });
    },
  });
};

// ============================================================
// REVIEW HOOKS
// ============================================================

export const useUserReviews = (userId: string, page = 1, pageSize = 20) => {
  return useQuery({
    queryKey: ['reviews', userId, page, pageSize],
    queryFn: () => apiClient.getUserReviews(userId, page, pageSize),
    enabled: !!userId,
  });
};

export const useCreateReview = (userId: string) => {
  const queryClient = useQueryClient();
  return useMutation<UserReview, Error, CreateReviewRequest>({
    mutationFn: (data) => apiClient.createReview(userId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reviews', userId] });
      queryClient.invalidateQueries({ queryKey: ['profile', userId] });
    },
  });
};

export const useUpdateReview = (userId: string) => {
  const queryClient = useQueryClient();
  return useMutation<UserReview, Error, UpdateReviewRequest>({
    mutationFn: (data) => apiClient.updateReview(userId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reviews', userId] });
      queryClient.invalidateQueries({ queryKey: ['profile', userId] });
    },
  });
};

export const useDeleteReview = () => {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (userId) => apiClient.deleteReview(userId),
    onSuccess: (_, userId) => {
      queryClient.invalidateQueries({ queryKey: ['reviews', userId] });
    },
  });
};

// Shared cache reconciliation for useLikeStory / useUnlikeStory: overwrites
// like_count and liked_by_me in every ['stories'] list entry (and any
// single-story entry) from the server-returned { like_count, liked } payload,
// so a double-click can never inflate the count beyond server truth.
function reconcileStoryLikeCache(
  queryClient: ReturnType<typeof useQueryClient>,
  id: string,
  response: { like_count: number; liked: boolean }
) {
  queryClient.setQueriesData<StoryListResponse>({ queryKey: ['stories'] }, (old) => {
    if (!old) return old;
    if (Array.isArray(old)) {
      return old.map((story) =>
        story.id === id ? { ...story, like_count: response.like_count, liked_by_me: response.liked } : story
      );
    }
    return old;
  });
  queryClient.setQueriesData<SuccessStory>({ queryKey: ['stories', id] }, (old) => {
    if (!old) return old;
    return { ...old, like_count: response.like_count, liked_by_me: response.liked };
  });
}

// Shared optimistic toggle for useLikeStory / useUnlikeStory: bumps like_count
// by `delta` and sets liked_by_me to `optimisticLiked` in every cached
// ['stories'] list entry (and single-story entry) before the request resolves.
function optimisticToggleStoryLike(
  queryClient: ReturnType<typeof useQueryClient>,
  id: string,
  delta: number,
  optimisticLiked: boolean
) {
  queryClient.setQueriesData<StoryListResponse>({ queryKey: ['stories'] }, (old) => {
    if (!old) return old;
    if (Array.isArray(old)) {
      return old.map((story) =>
        story.id === id
          ? { ...story, like_count: Math.max(0, story.like_count + delta), liked_by_me: optimisticLiked }
          : story
      );
    }
    return old;
  });
  queryClient.setQueriesData<SuccessStory>({ queryKey: ['stories', id] }, (old) => {
    if (!old) return old;
    return { ...old, like_count: Math.max(0, old.like_count + delta), liked_by_me: optimisticLiked };
  });
}

export const useLikeStory = () => {
  const queryClient = useQueryClient();
  return useMutation<{ like_count: number; liked: boolean }, Error, string>({
    mutationFn: (id) => apiClient.likeStory(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ['stories'] });

      // Snapshot all stories cache entries for rollback
      const previousEntries = queryClient.getQueriesData({ queryKey: ['stories'] });

      // Optimistically mark as liked + bump like_count for snappy UX
      optimisticToggleStoryLike(queryClient, id, 1, true);

      return { previousEntries };
    },
    onSuccess: (data, id) => {
      // Server truth wins — overwrite like_count/liked_by_me from the response
      // so repeated/double clicks never drift from the recompute-based counter.
      reconcileStoryLikeCache(queryClient, id, data);
    },
    onError: (_err, _id, context) => {
      // Rollback on error
      const ctx = context as { previousEntries: [unknown, StoryListResponse | SuccessStory | undefined][] } | undefined;
      if (ctx?.previousEntries) {
        ctx.previousEntries.forEach(([queryKey, data]) => {
          queryClient.setQueryData(queryKey as Parameters<typeof queryClient.setQueryData>[0], data);
        });
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['stories'] });
    },
  });
};

export const useUnlikeStory = () => {
  const queryClient = useQueryClient();
  return useMutation<{ like_count: number; liked: boolean }, Error, string>({
    mutationFn: (id) => apiClient.unlikeStory(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ['stories'] });

      const previousEntries = queryClient.getQueriesData({ queryKey: ['stories'] });

      // Optimistically mark as not liked + decrement like_count for snappy UX
      optimisticToggleStoryLike(queryClient, id, -1, false);

      return { previousEntries };
    },
    onSuccess: (data, id) => {
      reconcileStoryLikeCache(queryClient, id, data);
    },
    onError: (_err, _id, context) => {
      const ctx = context as { previousEntries: [unknown, StoryListResponse | SuccessStory | undefined][] } | undefined;
      if (ctx?.previousEntries) {
        ctx.previousEntries.forEach(([queryKey, data]) => {
          queryClient.setQueryData(queryKey as Parameters<typeof queryClient.setQueryData>[0], data);
        });
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['stories'] });
    },
  });
};

// ============================================================
// LOCAL GROUP HOOKS
// ============================================================

export const useGroups = (city?: string) => {
  return useQuery<LocalGroup[]>({
    queryKey: city ? ['groups', city] : ['groups'],
    queryFn: () => apiClient.listGroups(city ? { city } : undefined),
  });
};

export const useGroup = (id: string) => {
  return useQuery<LocalGroup>({
    queryKey: ['groups', id],
    queryFn: () => apiClient.getGroup(id),
    enabled: !!id,
  });
};

export const useGroupMembers = (id: string) => {
  return useQuery<GroupMember[]>({
    queryKey: ['groups', id, 'members'],
    queryFn: () => apiClient.getGroupMembers(id),
    enabled: !!id,
  });
};

export const useJoinGroup = (groupId: string) => {
  const queryClient = useQueryClient();
  return useMutation<void, Error, void>({
    mutationFn: () => apiClient.joinGroup(groupId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['groups', groupId] });
      queryClient.invalidateQueries({ queryKey: ['groups'] });
    },
  });
};

export const useLeaveGroup = (groupId: string) => {
  const queryClient = useQueryClient();
  return useMutation<void, Error, void>({
    mutationFn: () => apiClient.leaveGroup(groupId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['groups', groupId] });
      queryClient.invalidateQueries({ queryKey: ['groups'] });
    },
  });
};

// ============================================================
// VERIFICATION HOOKS
// ============================================================

export const useVerificationStatus = () =>
  useQuery<VerificationStatus>({
    queryKey: ['verification-status'],
    queryFn: () => apiClient.getVerificationStatus(),
  });

export const useSendEmailOTP = () => {
  const queryClient = useQueryClient();
  return useMutation<void, Error>({
    mutationFn: () => apiClient.sendEmailOTP(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['verification-status'] });
    },
  });
};

export const useConfirmEmailOTP = () => {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (code) => apiClient.confirmEmailOTP(code),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['verification-status'] });
      queryClient.invalidateQueries({ queryKey: ['me'] });
    },
  });
};

export const useSendSmsOTP = () => {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (phone) => apiClient.sendSmsOtp(phone),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['verification-status'] });
    },
  });
};

export const useConfirmSmsOTP = () => {
  const queryClient = useQueryClient();
  return useMutation<void, Error, { phone: string; code: string }>({
    mutationFn: ({ phone, code }) => apiClient.confirmSmsOtp(phone, code),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['verification-status'] });
      queryClient.invalidateQueries({ queryKey: ['me'] });
    },
  });
};
