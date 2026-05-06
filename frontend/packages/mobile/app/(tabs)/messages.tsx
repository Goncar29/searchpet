// ============================================================
// SearchPet - Messages Screen (Lista de conversaciones)
// ============================================================

import { View, Text, StyleSheet, FlatList, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../../store';
import { COLORS, SPACING, FONTS, RADIUS } from '../../constants';

export default function MessagesScreen() {
  const router = useRouter();
  const { isAuthenticated } = useAuthStore();

  if (!isAuthenticated) {
    return (
      <View style={styles.center}>
        <Text style={{ fontSize: 48, marginBottom: SPACING.md }}>💬</Text>
        <Text style={styles.title}>Mensajes</Text>
        <Text style={styles.subtitle}>
          Inicia sesión para ver tus conversaciones
        </Text>
        <TouchableOpacity
          style={styles.loginButton}
          onPress={() => router.push('/login')}
        >
          <Text style={styles.loginText}>Iniciar Sesión</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // TODO: Implementar lista de conversaciones real
  return (
    <View style={styles.container}>
      <View style={styles.center}>
        <Text style={{ fontSize: 48, marginBottom: SPACING.md }}>📭</Text>
        <Text style={styles.title}>Sin mensajes</Text>
        <Text style={styles.subtitle}>
          Cuando alguien te contacte sobre una mascota, aparecerá aquí
        </Text>
      </View>
    </View>
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
  loginButton: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: SPACING.xl,
    paddingVertical: 14,
    borderRadius: RADIUS.md,
  },
  loginText: {
    color: COLORS.white,
    fontSize: FONTS.sizes.md,
    fontWeight: '700',
  },
});
