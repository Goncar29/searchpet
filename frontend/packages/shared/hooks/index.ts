// ============================================================
// Lost Pets - Custom Hooks compartidos (Mobile + Web)
// Requiere: @tanstack/react-query
// ============================================================

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import type {
  CreatePetRequest,
  UpdatePetRequest,
  UpdateProfileRequest,
  PetSearchParams,
  CreateReportRequest,
  NearbySearchParams,
  NearbyReportsResponse,
  SendMessageRequest,
  GenerateShareRequest,
  SharedPetResponse,
  UploadPhotoResponse,
  User,
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
      // Actualiza el cache de la mascota específica y el listado general
      queryClient.setQueryData(['pets', updatedPet.id], updatedPet);
      queryClient.invalidateQueries({ queryKey: ['pets'] });
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
      queryClient.invalidateQueries({ queryKey: ['reports'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
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

export const useConversation = (userID: string) => {
  return useQuery({
    queryKey: ['messages', userID],
    queryFn: () => apiClient.getConversation(userID),
    enabled: !!userID,
    refetchInterval: 5000, // Refrescar cada 5 segundos cuando el chat está abierto
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
  return useMutation({
    mutationFn: ({ receiverID, text, reportID }: { receiverID: string; text: string; reportID?: string }) =>
      apiClient.sendMessageTo(receiverID, text, reportID),
    onSuccess: (_, { receiverID }) => {
      queryClient.invalidateQueries({ queryKey: ['messages', receiverID] });
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
