import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { COLORS, SPACING, FONTS, RADIUS } from '../../constants';
import { Icon } from '../Icon';

interface IntentStepProps {
  onSelect: (intent: 'lost' | 'stray' | 'adoption') => void;
}

export function IntentStep({ onSelect }: IntentStepProps) {
  const { t } = useTranslation();

  return (
    <View>
      <Text style={styles.title}>{t('publish:intent.title')}</Text>
      <TouchableOpacity style={styles.card} onPress={() => onSelect('lost')}>
        <Icon name="pets" size={36} color={COLORS.primary} />
        <Text style={styles.cardTitle}>{t('publish:intent.lostTitle')}</Text>
        <Text style={styles.cardDescription}>{t('publish:intent.lostDescription')}</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.card} onPress={() => onSelect('stray')}>
        <Icon name="location-on" size={36} color={COLORS.primary} />
        <Text style={styles.cardTitle}>{t('publish:intent.strayTitle')}</Text>
        <Text style={styles.cardDescription}>{t('publish:intent.strayDescription')}</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.card} onPress={() => onSelect('adoption')}>
        <Icon name="home" size={36} color={COLORS.primary} />
        <Text style={styles.cardTitle}>{t('adoption:publish.intentOption')}</Text>
        <Text style={styles.cardDescription}>{t('adoption:publish.intentHelp')}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: FONTS.sizes.xl, fontWeight: '700', color: COLORS.textPrimary, marginBottom: SPACING.lg, textAlign: 'center' },
  card: { backgroundColor: COLORS.white, borderWidth: 2, borderColor: COLORS.border, borderRadius: RADIUS.lg, padding: SPACING.lg, marginBottom: SPACING.md },
  cardTitle: { fontSize: FONTS.sizes.md, fontWeight: '700', color: COLORS.textPrimary, marginTop: SPACING.sm },
  cardDescription: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary, marginTop: SPACING.xs },
});
