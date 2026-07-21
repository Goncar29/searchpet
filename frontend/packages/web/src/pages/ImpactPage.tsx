import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useImpactStats } from '@shared/hooks';
import { getErrorMessage } from '@shared/utils/apiErrors';
import { ImpactLineChart } from '../components/ImpactLineChart';

function StatTile({ value, label, accent }: { value: string; label: string; accent?: string }) {
  return (
    <div className="rounded-xl border border-gray-200 p-4 text-center dark:border-gray-700">
      <div
        className="text-3xl font-extrabold text-gray-900 dark:text-gray-50"
        style={accent ? { color: accent } : undefined}
      >
        {value}
      </div>
      <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">{label}</div>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 p-4 dark:border-gray-700">
      <div className="mb-3 text-sm font-bold text-gray-900 dark:text-gray-100">{title}</div>
      {children}
    </div>
  );
}

// Known pet types get an emoji + a localized label; unknown ones render verbatim.
const PET_TYPE_EMOJI: Record<string, string> = {
  perro: '🐶',
  gato: '🐱',
  ave: '🐦',
  otro: '🐾',
};

export function ImpactPage() {
  const { t, i18n } = useTranslation('impact');
  const { data, isLoading, isError, error } = useImpactStats();

  const cardRef = useRef<HTMLDivElement | null>(null);
  const [isSharing, setIsSharing] = useState(false);
  const [shareMsg, setShareMsg] = useState<string | null>(null);

  // useGrouping: true — the bare "es" locale's default ("auto") grouping
  // strategy requires 5+ digits before it groups 4-digit numbers (a real
  // CLDR/ICU quirk: 1247 renders as "1247", not "1.247"). Forcing grouping on
  // keeps thousands separators consistent across en/es/pt for these tiles.
  const nf = new Intl.NumberFormat(i18n.language, { useGrouping: true });

  // Generates a PNG snapshot of the (offscreen) share card and shares it via the
  // Web Share API, falling back to a download. We share an IMAGE, never a link:
  // the underlying dashboard is admin-only and a public link would re-expose it.
  async function handleShare() {
    if (!cardRef.current || isSharing) return;
    setIsSharing(true);
    try {
      const { default: html2canvas } = await import('html2canvas');
      const canvas = await html2canvas(cardRef.current, {
        useCORS: true,
        scale: 2,
        logging: false,
        backgroundColor: '#ffffff',
      });
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), 'image/png'),
      );
      if (!blob) return;

      const file = new File([blob], 'searchpet-impact.png', { type: 'image/png' });
      const shareText = t('impact:shareText');

      if (navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], text: shareText });
          return;
        } catch (err) {
          if ((err as Error)?.name === 'AbortError') return;
        }
      }

      // Fallback (desktop / no file-share support): download the PNG.
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'searchpet-impact.png';
      a.click();
      URL.revokeObjectURL(url);
      setShareMsg(t('impact:shareDownloaded'));
      setTimeout(() => setShareMsg(null), 4000);
    } finally {
      setIsSharing(false);
    }
  }

  if (isLoading) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-16 text-center text-gray-500">
        {t('impact:loading')}
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-16 text-center text-red-600">
        <p>{t('impact:error')}</p>
        {isError ? <p className="mt-2 text-sm text-gray-400">{getErrorMessage(error, t)}</p> : null}
      </div>
    );
  }

  const { totals, reunions_by_month, new_users_by_month, reports_by_month, pets_by_type, moderation } = data;

  const petTypeLabel = (type: string) =>
    i18n.exists(`impact:petType.${type}`) ? t(`impact:petType.${type}`) : type;
  const maxTypeCount = Math.max(1, ...pets_by_type.map((s) => s.count));
  const reunionRatePct = `${Math.round(totals.reunion_rate * 100)}%`;

  return (
    <div className="mx-auto max-w-4xl">
      <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-gray-900 dark:text-gray-50">
            {t('impact:title')} 🐾
          </h1>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">{t('impact:subtitle')}</p>
        </div>
        <button
          onClick={handleShare}
          disabled={isSharing}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSharing ? <span className="animate-spin">⏳</span> : '📸'}
          {isSharing ? t('impact:sharing') : t('impact:share')}
        </button>
      </header>

      {shareMsg && (
        <p className="mb-4 rounded-lg bg-green-50 px-3 py-2 text-center text-sm text-green-700 dark:bg-green-950 dark:text-green-300">
          {shareMsg}
        </p>
      )}

      {/* Headline tiles */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile value={nf.format(totals.pets_reunited)} label={t('impact:reunited')} accent="#22c55e" />
        <StatTile value={nf.format(totals.searches_started)} label={t('impact:searches')} accent="#3b82f6" />
        <StatTile value={nf.format(totals.total_users)} label={t('impact:community')} />
        <StatTile value={nf.format(totals.total_pets)} label={t('impact:registered')} />
      </div>

      {/* Time series */}
      <div className="mb-6 space-y-6">
        <ChartCard title={t('impact:reunionsByMonth')}>
          <ImpactLineChart data={reunions_by_month} color="#22c55e" label={t('impact:reunionsByMonth')} />
        </ChartCard>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <ChartCard title={t('impact:newUsersByMonth')}>
            <ImpactLineChart data={new_users_by_month} color="#8b5cf6" label={t('impact:newUsersByMonth')} />
          </ChartCard>
          <ChartCard title={t('impact:reportsByMonth')}>
            <ImpactLineChart data={reports_by_month} color="#f59e0b" label={t('impact:reportsByMonth')} />
          </ChartCard>
        </div>
      </div>

      {/* Pets by type + moderation */}
      <div className="mb-6 grid grid-cols-1 gap-6 md:grid-cols-2">
        <ChartCard title={t('impact:petsByType')}>
          {pets_by_type.length === 0 ? (
            <p className="text-sm text-gray-400">—</p>
          ) : (
            <ul className="space-y-3">
              {pets_by_type.map((slice) => (
                <li key={slice.type}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="font-medium text-gray-700 dark:text-gray-300">
                      {PET_TYPE_EMOJI[slice.type] ?? '🐾'} {petTypeLabel(slice.type)}
                    </span>
                    <span className="tabular-nums text-gray-500 dark:text-gray-400">
                      {nf.format(slice.count)}
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${(slice.count / maxTypeCount) * 100}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </ChartCard>

        <ChartCard title={t('impact:moderation')}>
          <div className="grid grid-cols-3 gap-3">
            <StatTile value={nf.format(moderation.pending)} label={t('impact:moderationPending')} accent="#f59e0b" />
            <StatTile value={nf.format(moderation.resolved)} label={t('impact:moderationResolved')} accent="#22c55e" />
            <StatTile value={nf.format(moderation.dismissed)} label={t('impact:moderationDismissed')} accent="#6b7280" />
          </div>
        </ChartCard>
      </div>

      {/* Live snapshot */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <StatTile value={nf.format(totals.active_searches)} label={t('impact:activeSearches')} accent="#3b82f6" />
        <StatTile value={reunionRatePct} label={t('impact:reunionRate')} accent="#22c55e" />
      </div>

      {/* ---- Offscreen share card (fixed light design, 1080x1080) ---- */}
      <div
        ref={cardRef}
        aria-hidden="true"
        style={{
          position: 'fixed',
          top: '-9999px',
          left: '-9999px',
          width: '1080px',
          height: '1080px',
          backgroundColor: '#ffffff',
          fontFamily: 'Arial, sans-serif',
          padding: '72px',
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: '56px' }}>
          <div style={{ fontSize: '64px', marginBottom: '12px' }}>🐾</div>
          <div style={{ fontSize: '52px', fontWeight: 800, color: '#111827' }}>{t('impact:title')}</div>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '32px',
            flex: 1,
            alignContent: 'center',
          }}
        >
          {[
            { v: nf.format(totals.pets_reunited), l: t('impact:reunited'), c: '#22c55e' },
            { v: nf.format(totals.searches_started), l: t('impact:searches'), c: '#3b82f6' },
            { v: nf.format(totals.total_users), l: t('impact:community'), c: '#111827' },
            { v: reunionRatePct, l: t('impact:reunionRate'), c: '#22c55e' },
          ].map((tile) => (
            <div
              key={tile.l}
              style={{
                border: '2px solid #e5e7eb',
                borderRadius: '24px',
                padding: '40px 24px',
                textAlign: 'center',
              }}
            >
              <div style={{ fontSize: '80px', fontWeight: 800, color: tile.c }}>{tile.v}</div>
              <div style={{ fontSize: '26px', color: '#6b7280', marginTop: '12px' }}>{tile.l}</div>
            </div>
          ))}
        </div>

        <div style={{ textAlign: 'center', marginTop: '48px' }}>
          <div style={{ fontSize: '30px', fontWeight: 700, color: '#111827' }}>
            {t('impact:shareCardTagline')}
          </div>
        </div>
      </div>
    </div>
  );
}
