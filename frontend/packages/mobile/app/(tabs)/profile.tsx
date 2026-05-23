// ============================================================
// SearchPet - Profile Screen
// ============================================================

import { View, Text, StyleSheet, TouchableOpacity, Alert, ScrollView, Image, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useAuthStore } from '../../store';
import { useMyPets, usePublicProfile, useUploadProfilePhotoNative } from '../../../shared/hooks';
import { COLORS, SPACING, FONTS, RADIUS, SHADOWS } from '../../constants';

export default function ProfileScreen() {
  const router = useRouter();
  const { user, isAuthenticated, logout } = useAuthStore();
  const { data: myPets } = useMyPets();
  const { data: myProfile } = usePublicProfile(user?.id ?? '');
  const uploadProfilePhoto = useUploadProfilePhotoNative();

  const pickAndUploadAvatar = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permiso requerido', 'Necesitamos acceso a tu galería para cambiar la foto');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      try {
        await uploadProfilePhoto.mutateAsync(result.assets[0].uri);
      } catch (err: any) {
        Alert.alert('Error', err.message || 'No se pudo subir la foto');
      }
    }
  };

  if (!isAuthenticated) {
    return (
      <View style={styles.center}>
        <Text style={{ fontSize: 48, marginBottom: SPACING.md }}>👤</Text>
        <Text style={styles.title}>Mi Perfil</Text>
        <Text style={styles.subtitle}>
          Inicia sesión para gestionar tu perfil y mascotas
        </Text>
        <TouchableOpacity
          style={styles.primaryButton}
          onPress={() => router.push('/login')}
        >
          <Text style={styles.primaryButtonText}>Iniciar Sesión</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => router.push('/register')}>
          <Text style={styles.linkText}>Crear cuenta nueva</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const handleLogout = () => {
    Alert.alert('Cerrar Sesión', '¿Estás seguro?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Sí, salir', style: 'destructive', onPress: () => logout() },
    ]);
  };

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {/* User Card */}
      <View style={styles.userCard}>
        <TouchableOpacity onPress={pickAndUploadAvatar} style={styles.avatarContainer}>
          {uploadProfilePhoto.isPending ? (
            <View style={styles.avatar}>
              <ActivityIndicator color={COLORS.primary} />
            </View>
          ) : user?.profile_photo_url ? (
            <Image source={{ uri: user.profile_photo_url }} style={styles.avatarImage} />
          ) : (
            <View style={styles.avatar}>
              <Text style={{ fontSize: 36 }}>👤</Text>
            </View>
          )}
        </TouchableOpacity>
        <TouchableOpacity onPress={pickAndUploadAvatar} style={styles.changePhotoButton}>
          <Text style={styles.changePhotoText}>Cambiar foto</Text>
        </TouchableOpacity>
        <Text style={styles.userName}>{user?.name}</Text>
        <Text style={styles.userEmail}>{user?.email}</Text>
        {user?.is_verified && (
          <View style={styles.verifiedBadge}>
            <Text style={styles.verifiedText}>Verificado</Text>
          </View>
        )}
      </View>

      {/* Stats */}
      <View style={styles.statsRow}>
        <View style={styles.statItem}>
          <Text style={styles.statNumber}>{myPets?.length || 0}</Text>
          <Text style={styles.statLabel}>Mis mascotas</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <Text style={styles.statNumber}>{myProfile?.found_count ?? 0}</Text>
          <Text style={styles.statLabel}>Encontradas</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <Text style={styles.statNumber}>{myProfile?.total_reports ?? 0}</Text>
          <Text style={styles.statLabel}>Reportes</Text>
        </View>
      </View>

      {/* Menu Items */}
      <View style={styles.menuSection}>
        <TouchableOpacity
          style={styles.menuItem}
          onPress={() => router.push('/my-pets')}
        >
          <Text style={styles.menuIcon}>🐾</Text>
          <Text style={styles.menuText}>Mis mascotas</Text>
          <Text style={styles.menuArrow}>›</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.menuItem}>
          <Text style={styles.menuIcon}>📋</Text>
          <Text style={styles.menuText}>Mis reportes</Text>
          <Text style={styles.menuArrow}>›</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.menuItem}>
          <Text style={styles.menuIcon}>❤️</Text>
          <Text style={styles.menuText}>Favoritos</Text>
          <Text style={styles.menuArrow}>›</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.menuItem}
          onPress={() => router.push('/badges')}
        >
          <Text style={styles.menuIcon}>🏆</Text>
          <Text style={styles.menuText}>Mis badges</Text>
          <Text style={styles.menuArrow}>›</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.menuItem}
          onPress={() => router.push('/leaderboard')}
        >
          <Text style={styles.menuIcon}>🥇</Text>
          <Text style={styles.menuText}>Tabla de líderes</Text>
          <Text style={styles.menuArrow}>›</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.menuItem}
          onPress={() => router.push('/alerts')}
        >
          <Text style={styles.menuIcon}>🔔</Text>
          <Text style={styles.menuText}>Mis alertas de zona</Text>
          <Text style={styles.menuArrow}>›</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.menuItem}
          onPress={() => router.push('/groups' as any)}
        >
          <Text style={styles.menuIcon}>👥</Text>
          <Text style={styles.menuText}>Mis grupos</Text>
          <Text style={styles.menuArrow}>›</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.menuItem}>
          <Text style={styles.menuIcon}>⚙️</Text>
          <Text style={styles.menuText}>Configuración</Text>
          <Text style={styles.menuArrow}>›</Text>
        </TouchableOpacity>
      </View>

      {/* Logout */}
      <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
        <Text style={styles.logoutText}>Cerrar Sesión</Text>
      </TouchableOpacity>

      <View style={{ height: 100 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.xl,
  },
  title: {
    fontSize: FONTS.sizes.xl,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginBottom: SPACING.sm,
  },
  subtitle: {
    fontSize: FONTS.sizes.md,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginBottom: SPACING.lg,
  },
  primaryButton: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: SPACING.xl,
    paddingVertical: 14,
    borderRadius: RADIUS.md,
    marginBottom: SPACING.md,
  },
  primaryButtonText: {
    color: COLORS.white,
    fontSize: FONTS.sizes.md,
    fontWeight: '700',
  },
  linkText: {
    color: COLORS.primary,
    fontSize: FONTS.sizes.sm,
    fontWeight: '600',
  },
  userCard: {
    alignItems: 'center',
    padding: SPACING.xl,
    backgroundColor: COLORS.white,
    marginHorizontal: SPACING.lg,
    marginTop: SPACING.lg,
    borderRadius: RADIUS.lg,
    ...SHADOWS.md,
  },
  avatarContainer: {
    marginBottom: SPACING.xs,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: COLORS.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarImage: {
    width: 80,
    height: 80,
    borderRadius: 40,
  },
  changePhotoButton: {
    marginBottom: SPACING.md,
    marginTop: 4,
  },
  changePhotoText: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.primary,
    fontWeight: '600',
  },
  userName: {
    fontSize: FONTS.sizes.xl,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  userEmail: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    marginTop: 4,
  },
  verifiedBadge: {
    backgroundColor: COLORS.success,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: RADIUS.full,
    marginTop: SPACING.sm,
  },
  verifiedText: {
    color: COLORS.white,
    fontSize: FONTS.sizes.xs,
    fontWeight: '700',
  },
  statsRow: {
    flexDirection: 'row',
    backgroundColor: COLORS.white,
    marginHorizontal: SPACING.lg,
    marginTop: SPACING.md,
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    ...SHADOWS.sm,
  },
  statItem: { flex: 1, alignItems: 'center' },
  statNumber: {
    fontSize: FONTS.sizes.xxl,
    fontWeight: '700',
    color: COLORS.primary,
  },
  statLabel: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
    marginTop: 4,
  },
  statDivider: {
    width: 1,
    backgroundColor: COLORS.border,
    marginVertical: 4,
  },
  menuSection: {
    backgroundColor: COLORS.white,
    marginHorizontal: SPACING.lg,
    marginTop: SPACING.md,
    borderRadius: RADIUS.lg,
    ...SHADOWS.sm,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  menuIcon: { fontSize: 22, marginRight: SPACING.md },
  menuText: {
    flex: 1,
    fontSize: FONTS.sizes.md,
    color: COLORS.textPrimary,
    fontWeight: '500',
  },
  menuArrow: {
    fontSize: FONTS.sizes.xl,
    color: COLORS.textMuted,
  },
  logoutButton: {
    marginHorizontal: SPACING.lg,
    marginTop: SPACING.lg,
    padding: SPACING.md,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.danger,
    alignItems: 'center',
  },
  logoutText: {
    color: COLORS.danger,
    fontSize: FONTS.sizes.md,
    fontWeight: '600',
  },
});
