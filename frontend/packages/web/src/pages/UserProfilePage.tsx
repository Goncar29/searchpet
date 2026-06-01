import { useParams, Link } from 'react-router';
import { useState } from 'react';
import { usePublicProfile, useUserReviews, useCreateReview, useUpdateReview, useDeleteReview, useBlockUser, useBlockedUsers, useUnblockUser, useSubmitAbuseReport } from '@shared/hooks';
import type { Badge, UserReview, AbuseReason } from '@shared/types';
import { BADGE_META } from '@shared/types';
import { useAuth } from '../context/AuthContext';

const BADGE_COLOR: Record<string, string> = {
  first_helper: 'bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300',
  pet_rescuer: 'bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800 text-green-700 dark:text-green-300',
  social_butterfly: 'bg-purple-50 dark:bg-purple-950 border-purple-200 dark:border-purple-800 text-purple-700 dark:text-purple-300',
  verified_finder: 'bg-orange-50 dark:bg-orange-950 border-orange-200 dark:border-orange-800 text-orange-700 dark:text-orange-300',
};
const DEFAULT_BADGE_COLOR = 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300';

function BadgeCard({ badge }: { badge: Badge }) {
  const meta = BADGE_META[badge.badge_type] ?? {
    emoji: '🏅',
    label: badge.badge_type,
    description: '',
  };
  const color = BADGE_COLOR[badge.badge_type] ?? DEFAULT_BADGE_COLOR;

  return (
    <div className={`flex items-start gap-3 p-3 rounded-xl border ${color}`}>
      <span className="text-2xl flex-shrink-0">{meta.emoji}</span>
      <div>
        <p className="text-sm font-semibold">{meta.label}</p>
        {meta.description && (
          <p className="text-xs opacity-75 mt-0.5">{meta.description}</p>
        )}
        <p className="text-xs opacity-50 mt-1">
          {new Date(badge.earned_at).toLocaleDateString('es-UY', { day: 'numeric', month: 'short', year: 'numeric' })}
        </p>
      </div>
    </div>
  );
}

function StarDisplay({ stars, size = 'text-sm' }: { stars: number; size?: string }) {
  return (
    <span className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={`${size} ${i <= stars ? 'text-yellow-400' : 'text-gray-300 dark:text-gray-600'}`}>
          ★
        </span>
      ))}
    </span>
  );
}

function StarSelector({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <span className="flex gap-1">
      {[1, 2, 3, 4, 5].map((i) => (
        <button
          key={i}
          type="button"
          onClick={() => onChange(i)}
          className={`text-3xl leading-none transition-colors ${i <= value ? 'text-yellow-400' : 'text-gray-300 dark:text-gray-600 hover:text-yellow-300'}`}
        >
          ★
        </button>
      ))}
    </span>
  );
}

function ReviewCard({ review, onDelete }: { review: UserReview; onDelete?: () => void }) {
  const initials = review.reviewer_name.trim().charAt(0).toUpperCase();
  const date = new Date(review.created_at).toLocaleDateString('es-UY', {
    day: 'numeric', month: 'short', year: 'numeric',
  });

  return (
    <div className="flex gap-3 py-4 border-b border-gray-100 dark:border-gray-800 last:border-0">
      {review.reviewer_photo ? (
        <img
          src={review.reviewer_photo}
          alt={review.reviewer_name}
          className="w-9 h-9 rounded-full object-cover flex-shrink-0"
        />
      ) : (
        <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary flex-shrink-0">
          {initials}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold text-gray-900 dark:text-gray-50 truncate">
            {review.reviewer_name}
          </span>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="text-xs text-gray-400 dark:text-gray-500">{date}</span>
            {onDelete && (
              <button
                type="button"
                onClick={onDelete}
                className="text-xs text-red-500 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 font-medium transition-colors"
              >
                Eliminar
              </button>
            )}
          </div>
        </div>
        <StarDisplay stars={review.stars} />
        {review.text && (
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 leading-relaxed">{review.text}</p>
        )}
      </div>
    </div>
  );
}

function StatPill({ label, value }: { label: string; value: number }) {
  return (
    <div className="text-center">
      <p className="text-2xl font-bold text-gray-900 dark:text-gray-50">{value}</p>
      <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{label}</p>
    </div>
  );
}

export function UserProfilePage() {
  const { id } = useParams<{ id: string }>();
  const { user, isAuthenticated } = useAuth();
  const { data: profile, isLoading, error } = usePublicProfile(id ?? '');
  const { data: reviewsData, isLoading: reviewsLoading } = useUserReviews(id ?? '');

  const [showForm, setShowForm] = useState(false);
  const [formStars, setFormStars] = useState(0);
  const [formText, setFormText] = useState('');
  const [formError, setFormError] = useState('');
  const [showReportMenu, setShowReportMenu] = useState(false);
  const [reportSuccess, setReportSuccess] = useState(false);

  const createReview = useCreateReview(id ?? '');
  const updateReview = useUpdateReview(id ?? '');
  const deleteReview = useDeleteReview();
  const blockUser = useBlockUser();
  const unblockUser = useUnblockUser();
  const submitAbuseReport = useSubmitAbuseReport();
  const { data: blockedList } = useBlockedUsers();

  const reviews = reviewsData?.reviews ?? [];
  const isOwnProfile = !!user && user.id === id;
  const canReview = isAuthenticated && !isOwnProfile;
  const isBlockedByMe = blockedList?.some((b) => b.blocked_id === id) ?? false;

  const handleBlockToggle = () => {
    if (isBlockedByMe) {
      if (!window.confirm(`¿Querés desbloquear a ${profile?.name ?? 'este usuario'}?`)) return;
      unblockUser.mutate(id ?? '');
    } else {
      if (!window.confirm(`¿Querés bloquear a ${profile?.name ?? 'este usuario'}? Ya no podrán enviarse mensajes.`)) return;
      blockUser.mutate({ userId: id ?? '' });
    }
  };

  const handleReport = (reason: AbuseReason) => {
    submitAbuseReport.mutate(
      { target_user_id: id ?? '', reason },
      {
        onSuccess: () => {
          setShowReportMenu(false);
          setReportSuccess(true);
          setTimeout(() => setReportSuccess(false), 4000);
        },
        onError: () => {
          // keep menu open so user can retry
        },
      },
    );
  };

  const myReview = canReview ? reviews.find((r) => r.reviewer_id === user?.id) : undefined;

  const handleOpenForm = () => {
    setFormError('');
    if (myReview) {
      setFormStars(myReview.stars);
      setFormText(myReview.text);
    } else {
      setFormStars(0);
      setFormText('');
    }
    setShowForm(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    if (formStars < 1 || formStars > 5) {
      setFormError('Seleccioná entre 1 y 5 estrellas.');
      return;
    }
    if (!formText.trim()) {
      setFormError('Escribí un comentario.');
      return;
    }
    const payload = { stars: formStars, text: formText.trim() };
    const action = myReview ? updateReview : createReview;
    action.mutate(payload, {
      onSuccess: () => {
        setShowForm(false);
        setFormStars(0);
        setFormText('');
      },
      onError: (err) => {
        setFormError(err.message || 'No se pudo guardar la reseña.');
      },
    });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 py-10 px-4">
        <div className="max-w-lg mx-auto space-y-4">
          <div className="h-32 rounded-2xl bg-gray-200 dark:bg-gray-800 animate-pulse" />
          <div className="h-24 rounded-2xl bg-gray-200 dark:bg-gray-800 animate-pulse" />
          <div className="h-48 rounded-2xl bg-gray-200 dark:bg-gray-800 animate-pulse" />
        </div>
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center px-4">
        <div className="text-center">
          <p className="text-5xl mb-4">🐾</p>
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-50 mb-2">Perfil no encontrado</h2>
          <p className="text-gray-500 dark:text-gray-400 text-sm mb-6">
            Este usuario no existe o su perfil no está disponible.
          </p>
          <Link
            to="/"
            className="inline-block px-5 py-2 bg-primary hover:bg-primary-dark text-white font-semibold rounded-lg text-sm transition-colors"
          >
            Volver al inicio
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 py-10 px-4">
      <div className="max-w-lg mx-auto space-y-4">

        {/* Header de perfil */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
          <div className="flex items-center gap-4">
            {/* Avatar */}
            {profile.profile_photo_url ? (
              <img
                src={profile.profile_photo_url}
                alt={profile.name}
                className="w-20 h-20 rounded-full object-cover border-2 border-gray-200 dark:border-gray-700 flex-shrink-0"
              />
            ) : (
              <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center text-3xl font-bold text-primary flex-shrink-0">
                {profile.name.charAt(0).toUpperCase()}
              </div>
            )}

            {/* Info */}
            <div className="flex-1 min-w-0">
              <h1 className="text-xl font-bold text-gray-900 dark:text-gray-50 truncate">{profile.name}</h1>
              {profile.city && (
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">📍 {profile.city}</p>
              )}
              <div className="flex items-center gap-2 mt-2">
                <span className="text-lg font-bold text-primary">{profile.total_points}</span>
                <span className="text-xs text-gray-400 dark:text-gray-500">puntos totales</span>
              </div>
            </div>
          </div>

          {/* Block / Unblock + Report — only for authenticated non-self users */}
          {isAuthenticated && !isOwnProfile && (
            <div className="mt-4 space-y-2">
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => { setShowReportMenu((v) => !v); setReportSuccess(false); }}
                  disabled={submitAbuseReport.isPending}
                  className="text-sm font-semibold px-4 py-2 rounded-lg border border-orange-300 dark:border-orange-700 text-orange-600 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-950 transition-colors disabled:opacity-60"
                >
                  {submitAbuseReport.isPending ? 'Enviando...' : 'Denunciar'}
                </button>
                <button
                  type="button"
                  onClick={handleBlockToggle}
                  disabled={blockUser.isPending || unblockUser.isPending}
                  className={`text-sm font-semibold px-4 py-2 rounded-lg border transition-colors disabled:opacity-60 ${
                    isBlockedByMe
                      ? 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                      : 'border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950'
                  }`}
                >
                  {blockUser.isPending || unblockUser.isPending
                    ? 'Procesando...'
                    : isBlockedByMe
                    ? 'Desbloquear usuario'
                    : 'Bloquear usuario'}
                </button>
              </div>

              {/* Report reason picker */}
              {showReportMenu && (
                <div className="flex flex-col gap-1 p-3 bg-orange-50 dark:bg-orange-950 rounded-xl border border-orange-200 dark:border-orange-800">
                  <p className="text-xs font-semibold text-orange-700 dark:text-orange-300 mb-1">Motivo de la denuncia:</p>
                  {(['spam', 'fake', 'abuse', 'inappropriate', 'other'] as AbuseReason[]).map((reason) => (
                    <button
                      key={reason}
                      type="button"
                      onClick={() => handleReport(reason)}
                      disabled={submitAbuseReport.isPending}
                      className="text-left text-sm px-3 py-1.5 rounded-lg hover:bg-orange-100 dark:hover:bg-orange-900 text-orange-800 dark:text-orange-200 disabled:opacity-60 transition-colors"
                    >
                      {{ spam: 'Spam', fake: 'Publicación falsa', abuse: 'Abuso', inappropriate: 'Contenido inapropiado', other: 'Otro' }[reason]}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setShowReportMenu(false)}
                    className="text-left text-xs px-3 py-1 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-400 transition-colors mt-1"
                  >
                    Cancelar
                  </button>
                </div>
              )}

              {/* Success feedback */}
              {reportSuccess && (
                <p className="text-xs text-green-600 dark:text-green-400 text-right font-medium">
                  Denuncia enviada. Gracias por reportarlo.
                </p>
              )}
            </div>
          )}
        </div>

        {/* Stats */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 p-5">
          <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-4">
            Actividad
          </h2>
          <div className="grid grid-cols-3 divide-x divide-gray-100 dark:divide-gray-800">
            <StatPill label="Reportes" value={profile.total_reports} />
            <StatPill label="Reunidos" value={profile.found_count} />
            <StatPill label="Compartidos" value={profile.share_count} />
          </div>
        </div>

        {/* Badges */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 p-5">
          <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-4">
            Logros ({profile.badges.length})
          </h2>
          {profile.badges.length === 0 ? (
            <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-4">
              Aún no tiene logros desbloqueados.
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {profile.badges.map((badge: Badge) => (
                <BadgeCard key={badge.id} badge={badge} />
              ))}
            </div>
          )}
        </div>

        {/* Rating summary */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 p-5">
          <div className="flex items-center gap-3">
            <span className="text-3xl font-bold text-gray-900 dark:text-gray-50">
              {profile.avg_rating > 0 ? profile.avg_rating.toFixed(1) : '—'}
            </span>
            <div>
              <StarDisplay stars={Math.round(profile.avg_rating)} size="text-lg" />
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                {profile.review_count === 1 ? '1 reseña' : `${profile.review_count} reseñas`}
              </p>
            </div>
          </div>
        </div>

        {/* Reviews */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
              Reseñas
            </h2>
            {canReview && (
              <button
                type="button"
                onClick={handleOpenForm}
                className="text-sm font-semibold text-primary hover:text-primary-dark transition-colors"
              >
                {myReview ? 'Editar reseña' : 'Dejar reseña'}
              </button>
            )}
          </div>

          {/* Inline form */}
          {showForm && (
            <form onSubmit={handleSubmit} className="mb-4 p-4 bg-gray-50 dark:bg-gray-800 rounded-xl space-y-3">
              <div>
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Tu calificación</p>
                <StarSelector value={formStars} onChange={setFormStars} />
              </div>
              <textarea
                value={formText}
                onChange={(e) => setFormText(e.target.value)}
                placeholder="Escribí tu reseña..."
                maxLength={2000}
                rows={4}
                className="w-full text-sm border border-gray-200 dark:border-gray-700 rounded-lg p-2.5 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-50 placeholder-gray-400 resize-none focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              {formError && (
                <p className="text-xs text-red-500">{formError}</p>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="flex-1 py-2 text-sm font-semibold border border-gray-200 dark:border-gray-700 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={createReview.isPending || updateReview.isPending}
                  className="flex-[2] py-2 text-sm font-semibold bg-primary text-white rounded-lg hover:bg-primary-dark disabled:opacity-60 transition-colors"
                >
                  {createReview.isPending || updateReview.isPending
                    ? 'Guardando...'
                    : myReview ? 'Guardar cambios' : 'Publicar reseña'}
                </button>
              </div>
            </form>
          )}

          {/* List */}
          {reviewsLoading ? (
            <div className="space-y-3 py-2">
              {[1, 2].map((i) => (
                <div key={i} className="h-16 rounded-xl bg-gray-100 dark:bg-gray-800 animate-pulse" />
              ))}
            </div>
          ) : reviews.length === 0 ? (
            <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-4">
              Aún no hay reseñas.
            </p>
          ) : (
            <div>
              {reviews.map((review) => (
                <ReviewCard
                  key={review.id}
                  review={review}
                  onDelete={
                    user && review.reviewer_id === user.id
                      ? () => {
                          if (!window.confirm('¿Eliminar tu reseña?')) return;
                          deleteReview.mutate(id ?? '');
                        }
                      : undefined
                  }
                />
              ))}
            </div>
          )}
        </div>

        {/* Link al leaderboard */}
        <div className="text-center">
          <Link
            to="/leaderboard"
            className="text-sm text-primary hover:text-primary-dark font-medium transition-colors"
          >
            Ver ranking por ciudad →
          </Link>
        </div>
      </div>
    </div>
  );
}
