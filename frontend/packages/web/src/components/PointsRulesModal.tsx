import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { BADGE_META } from '@shared/types';
import { POINTS, BADGE_THRESHOLDS } from '@shared/constants/gamification';
import { Icon } from './Icon';

interface PointsRulesModalProps {
  onClose: () => void;
}

/** Badges whose condition carries a number; the rest read the same everywhere. */
const BADGE_THRESHOLD: Record<string, number> = {
  community_guardian: BADGE_THRESHOLDS.communityGuardianReports,
  super_finder: BADGE_THRESHOLDS.superFinderPets,
};

/**
 * Explains how points and badges are earned, and when they are NOT.
 *
 * Every number comes from `@shared/constants/gamification` (which documents the
 * backend lines it mirrors) and goes into the copy by interpolation, so the
 * text and the amounts cannot drift apart. The parent controls mounting.
 */
export function PointsRulesModal({ onClose }: PointsRulesModalProps) {
  const { t } = useTranslation(['pointsRules', 'badges']);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const earn = [
    t('pointsRules:earn.report', { points: POINTS.report }),
    t('pointsRules:earn.share', { points: POINTS.share }),
    t('pointsRules:earn.helper', { points: POINTS.helper }),
    t('pointsRules:earn.review', { points: POINTS.reviewReceived }),
  ];
  const notEarn = [
    t('pointsRules:notEarn.ownFound'),
    t('pointsRules:notEarn.helperOnce'),
    t('pointsRules:notEarn.reviewWritten'),
    t('pointsRules:notEarn.reviewDeleted', { points: POINTS.reviewReceived }),
  ];

  const sectionTitle = 'font-display text-lg text-gray-900 dark:text-gray-100 mb-2';
  const listItem = 'text-sm text-gray-600 dark:text-gray-300';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={t('pointsRules:title')}
    >
      <div
        className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-2xl bg-white dark:bg-gray-900 p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 mb-4">
          <h3 className="font-display text-xl text-gray-900 dark:text-gray-100">
            {t('pointsRules:title')}
          </h3>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label={t('pointsRules:close')}
            className="shrink-0 rounded-lg p-1 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <Icon name="close" className="h-5 w-5" />
          </button>
        </div>

        <section className="mb-5">
          <h4 className={sectionTitle}>{t('pointsRules:earn.title')}</h4>
          <ul className="list-disc pl-5 space-y-1">
            {earn.map((text) => (
              <li key={text} className={listItem}>
                {text}
              </li>
            ))}
          </ul>
        </section>

        <section className="mb-5">
          <h4 className={sectionTitle}>{t('pointsRules:notEarn.title')}</h4>
          <ul className="list-disc pl-5 space-y-1">
            {notEarn.map((text) => (
              <li key={text} className={listItem}>
                {text}
              </li>
            ))}
          </ul>
        </section>

        <section className="mb-5">
          <h4 className={sectionTitle}>{t('pointsRules:badges.title')}</h4>
          <ul className="space-y-3">
            {Object.entries(BADGE_META).map(([type, meta]) => {
              const threshold = BADGE_THRESHOLD[type];
              return (
                <li key={type}>
                  <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                    {t(meta.labelKey)}
                  </p>
                  <p className={listItem}>
                    {threshold == null
                      ? t(`pointsRules:badges.${type}`)
                      : t(`pointsRules:badges.${type}`, { threshold })}
                  </p>
                </li>
              );
            })}
          </ul>
        </section>

        <section>
          <h4 className={sectionTitle}>{t('pointsRules:ranking.title')}</h4>
          <p className={listItem}>{t('pointsRules:ranking.body')}</p>
        </section>
      </div>
    </div>
  );
}
