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

export const useMyPets = () => {
  return useQuery({
    queryKey: ['pets', 'mine'],
    queryFn: () => apiClient.getMyPets(),
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
    },
  });
};

export const useUploadPhoto = () => {
  const queryClient = useQueryClient();
  return useMutation<UploadPhotoResponse, Error, { petId: string; file: File }>({
    mutationFn: ({ petId, file }) => apiClient.uploadPhoto(petId, file),
    onSuccess: (_, { petId }) => {
      // Invalidar el cache de la mascota para que se refresque con la nueva foto
      queryClient.invalidateQueries({ queryKey: ['pets', petId] });
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
    },
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

export const useBlockUser = () => {
  const queryClient = useQueryClient();
  return useMutation<void, Error, { userId: string; data?: BlockUserRequest }>({
    mutationFn: ({ userId, data }) => apiClient.blockUser(userId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['blocked-users'] });
      queryClient.invalidateQueries({ queryKey: ['messages'] });
    },
  });
};

export const useUnblockUser = () => {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (userId) => apiClient.unblockUser(userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['blocked-users'] });
      queryClient.invalidateQueries({ queryKey: ['messages'] });
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

export const useLikeStory = () => {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) => apiClient.likeStory(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ['stories'] });

      // Snapshot all stories cache entries for rollback
      const previousEntries = queryClient.getQueriesData<StoryListResponse>({ queryKey: ['stories'] });

      // Optimistically increment like_count in all matching list entries
      queryClient.setQueriesData<StoryListResponse>({ queryKey: ['stories'] }, (old) => {
        if (!old) return old;
        return old.map((story) =>
          story.id === id ? { ...story, like_count: story.like_count + 1 } : story
        );
      });

      return { previousEntries };
    },
    onError: (_err, _id, context) => {
      // Rollback on error
      const ctx = context as { previousEntries: [unknown, StoryListResponse | undefined][] } | undefined;
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
