// ============================================================
// SearchPet - Botón de inicio de sesión con Google (mobile)
// ============================================================

import { useEffect, useState } from 'react';
import { Text, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin';
import { useTranslation } from 'react-i18next';
import i18next from 'i18next';
import { COLORS, SPACING, FONTS, RADIUS } from '../constants';

interface Props {
  /**
   * OAuth 2.0 **Web** client id. Es lo que hace que el idToken devuelto quede
   * dirigido a NUESTRO backend: su audiencia es este client id, el mismo valor
   * que `GOOGLE_CLIENT_ID` verifica del lado del servidor. NO es el de Android.
   *
   * Entra por prop y no se lee de process.env acá adentro a propósito: babel
   * inlinea las EXPO_PUBLIC_* en tiempo de build, así que un test no podría
   * controlarlo. Además deja este componente puro.
   */
  clientId: string;
  /** Recibe el ID token de Google cuando el flujo nativo termina bien. */
  onToken: (idToken: string) => void | Promise<void>;
}

/**
 * No renderiza nada si `clientId` viene vacío: un build sin la credencial
 * simplemente no ofrece Google, en vez de mostrar un botón que falla al tocarlo.
 */
export function GoogleSignInButton({ clientId, onToken }: Props) {
  const { t } = useTranslation('auth');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!clientId) return;
    GoogleSignin.configure({ webClientId: clientId });
  }, [clientId]);

  if (!clientId) return null;

  const handlePress = async () => {
    setIsLoading(true);
    try {
      await GoogleSignin.hasPlayServices();
      const result = await GoogleSignin.signIn();

      // v16 resuelve con una unión discriminada: cancelar NO es una excepción.
      if (result.type === 'cancelled') return;

      const idToken = result.data?.idToken;
      if (!idToken) {
        // Un success sin token significa webClientId ausente o equivocado. No hay
        // nada que mandarle al backend, y mandarlo daría un 401 desorientador.
        Alert.alert(i18next.t('common:error'), i18next.t('auth:google.failed'));
        return;
      }

      await onToken(idToken);
    } catch (error) {
      const code = (error as { code?: string })?.code;
      if (code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        Alert.alert(i18next.t('common:error'), i18next.t('auth:google.playServices'));
      } else if (code === statusCodes.IN_PROGRESS) {
        // Segundo toque con el diálogo ya abierto. No hay nada que reportar.
      } else {
        // Acá cae DEVELOPER_ERROR (SHA-1 o client id mal configurados). El usuario
        // no puede hacer nada con eso: mensaje genérico y el detalle al log.
        console.warn('[GoogleSignInButton] sign-in failed:', error);
        Alert.alert(i18next.t('common:error'), i18next.t('auth:google.failed'));
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <TouchableOpacity
      accessibilityRole="button"
      style={styles.button}
      onPress={handlePress}
      disabled={isLoading}
    >
      {isLoading ? (
        <ActivityIndicator color={COLORS.textPrimary} />
      ) : (
        <Text style={styles.label}>{t('google.signIn')}</Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.md,
    marginTop: SPACING.md,
  },
  label: {
    fontSize: FONTS.sizes.md,
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
});
