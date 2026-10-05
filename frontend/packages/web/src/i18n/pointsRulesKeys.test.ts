import { describe, it, expect } from 'vitest';
import i18n from './index';
import { BADGE_META } from '@shared/types';
import { POINTS, BADGE_THRESHOLDS } from '@shared/constants/gamification';

// El popup arma `pointsRules:badges.<tipo>` en tiempo de ejecución, así que el
// guard de claves usadas (que sólo ve literales) no lo cubre: este test
// pregunta a la instancia real, en los tres idiomas.
describe.each(['es', 'en', 'pt'])('pointsRules (%s)', (lng) => {
  it('has a condition for every badge the legend can draw', () => {
    for (const type of Object.keys(BADGE_META)) {
      expect(i18n.exists(`pointsRules:badges.${type}`, { lng })).toBe(true);
    }
  });

  it('interpolates the shared numbers into the copy', () => {
    const t = i18n.getFixedT(lng);
    expect(t('pointsRules:earn.report', { points: POINTS.report })).toContain(String(POINTS.report));
    expect(t('pointsRules:earn.helper', { points: POINTS.helper })).toContain(String(POINTS.helper));
    expect(
      t('pointsRules:badges.community_guardian', {
        threshold: BADGE_THRESHOLDS.communityGuardianReports,
      }),
    ).toContain(String(BADGE_THRESHOLDS.communityGuardianReports));
    expect(t('pointsRules:earn.report', { points: POINTS.report })).not.toContain('{{');
  });
});
