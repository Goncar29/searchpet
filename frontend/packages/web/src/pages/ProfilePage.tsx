import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router';
import { useTranslation, Trans } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  useUpdateMe,
  useUploadProfilePhoto,
  useMyBadges,
  useVerificationStatus,
  useSendEmailOTP,
  useConfirmEmailOTP,
  usePublicProfile,
  useMyPets,
  useReportedPets,
} from '@shared/hooks';
import { getErrorMessage } from '@shared/utils/apiErrors';
import { ApiError } from '@shared/api/client';
import { formatPetAge } from '@shared/utils/petAge';
import { splitOwnedPets } from '@shared/utils/ownedPetBuckets';
import { cloudinaryCardThumb, cloudinaryThumb } from '@shared/utils/cloudinaryThumb';
import { useAuth } from '../context/AuthContext';
import type { Badge, Pet } from '@shared/types';
import { BADGE_META } from '@shared/types';
import { Icon } from '../components/Icon';
import { ListState } from '../components/list/ListState';
import { PawPlaceholder } from '../components/PawPlaceholder';
import { statusBadgeBg } from '../utils/statusBadge';
import { myPetsRoute } from '../routes';

/**
 * Cuántas mascotas muestra cada sección antes de derivar a "Mis mascotas" (`/pets/mine`).
 *
 * El perfil es un RESUMEN: `MyPetsPage` sigue siendo la pantalla completa, con
 * sus tres pestañas y sus acciones de edición. Sin tope, alguien con veinte
 * mascotas empuja los logros y las estadísticas fuera de la pantalla y el
 * perfil deja de ser un perfil.
 */
const SUMMARY_LIMIT = 4;

/**
 * "Miembro desde marzo 2025", o cadena vacía si la fecha no sirve.
 *
 * La guarda no es defensiva por costumbre: `created_at` es `string` y una
 * cadena vacía produce `Invalid Date`, que `toLocaleDateString` imprime tal
 * cual — el usuario leería literalmente "Miembro desde Invalid Date". Un dato
 * ausente tiene que desaparecer, no mostrarse roto.
 */
function formatMemberSince(createdAt: string | undefined, language: string): string {
  if (!createdAt) return '';
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(language, { month: 'long', year: 'numeric' });
}

/** Una línea de contacto de la tarjeta de perfil: icono, etiqueta y valor. */
function ContactRow({
  icon,
  label,
  value,
  muted = false,
}: {
  icon: 'mail' | 'call' | 'location-on';
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <span className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 shrink-0">
        <Icon name={icon} className="h-4 w-4" />
        {label}
      </span>
      <span
        className={`text-sm text-right truncate ${
          muted
            ? 'italic text-gray-400 dark:text-gray-500'
            : 'font-medium text-gray-900 dark:text-gray-100'
        }`}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * Un logro, obtenido o no.
 *
 * Los NO obtenidos se muestran en gris con su `howToEarn` en lugar de
 * esconderse: un tablero que sólo lista lo ya conseguido no dice qué hacer
 * después. Los seis tienen esa clave en es/en/pt.
 *
 * El emoji de `BADGE_META` NO se sustituye por un `Icon`: lo comparten ocho
 * archivos entre web y mobile, y cambiarlo sólo acá haría que el mismo logro se
 * vea distinto en el ranking, en el perfil y en el celular. Lo que sí lleva es
 * `role="img"` con su nombre, porque un lector de pantalla anuncia el nombre
 * Unicode del glifo ("handshake"), no "Primer ayudante".
 */
function AchievementTile({
  type,
  earnedAt,
  language,
  t,
}: {
  type: string;
  earnedAt?: string;
  language: string;
  t: TFunction;
}) {
  // Sin `return null` ante un tipo desconocido: la grilla recorre `BADGE_META`,
  // así que un logro que el backend otorgue ANTES de que `shared/types` lo
  // conozca no tendría dónde aparecer y el usuario se lo ganaría sin verlo
  // nunca — sin error, sin hueco, sin nada. La versión anterior tenía este
  // mismo respaldo y se perdió al pasar de "listar lo obtenido" a "listar los
  // seis". La etiqueta cae al tipo crudo, que es feo pero honesto: mejor un
  // nombre técnico que un logro invisible.
  const meta = BADGE_META[type] ?? {
    emoji: '🏅',
    labelKey: type,
    descriptionKey: '',
    howToEarnKey: '',
  };
  const earned = !!earnedAt;

  return (
    <div
      className={`rounded-xl border p-3 text-center transition-colors ${
        earned
          ? 'border-primary/20 bg-primary/5'
          : 'border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/40'
      }`}
    >
      <span
        role="img"
        aria-label={t(meta.labelKey)}
        className={`block text-2xl leading-none mb-2 ${earned ? '' : 'grayscale opacity-50'}`}
      >
        {meta.emoji}
      </span>
      <p
        className={`text-xs font-semibold truncate ${
          earned ? 'text-gray-900 dark:text-gray-100' : 'text-gray-500 dark:text-gray-400'
        }`}
      >
        {t(meta.labelKey)}
      </p>
      {/* Obtenido: cuándo. Pendiente: cómo. Nunca las dos, y nunca ninguna —
          la altura tiene que ser la misma en los cuatro cuadrantes. */}
      <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 line-clamp-2 min-h-[2rem]">
        {earned
          ? new Date(earnedAt!).toLocaleDateString(language, { day: 'numeric', month: 'short' })
          : t(meta.howToEarnKey)}
      </p>
    </div>
  );
}

/** Tarjeta de mascota del resumen: sólo mira, no edita. Eso vive en `/pets/mine`. */
function PetSummaryCard({ pet, t }: { pet: Pet; t: TFunction }) {
  const photo = pet.photos?.find((p) => p.is_primary) ?? pet.photos?.[0];
  const age = formatPetAge(t, pet.birth_date, pet.birth_date_precision);
  const meta = [pet.breed, age].filter(Boolean).join(' · ');

  return (
    <Link
      to={`/pets/${pet.id}`}
      className="group block bg-white dark:bg-gray-900 rounded-2xl overflow-hidden shadow-sm border border-gray-100 dark:border-gray-800 hover:shadow-md transition-shadow"
    >
      <div className="h-40 bg-gray-100 dark:bg-gray-800 relative overflow-hidden">
        {photo ? (
          <img
            src={cloudinaryCardThumb(photo.url, 'compact')}
            loading="lazy"
            alt={pet.name}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <PawPlaceholder className="w-2/5 max-w-16" />
          </div>
        )}
        <span
          className={`absolute top-3 right-3 text-xs font-bold text-white px-2 py-1 rounded-md ${statusBadgeBg(pet.status)}`}
        >
          {t(`pets:status.${pet.status}`)}
        </span>
      </div>
      <div className="p-4">
        <h3 className="font-display text-lg font-semibold text-gray-900 dark:text-gray-100 truncate">
          {pet.name}
        </h3>
        {/* Alto reservado aunque no haya raza ni edad: sin esto las tarjetas de
            una misma fila quedan de altos distintos según qué cargó cada dueño. */}
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5 truncate min-h-[1.25rem]">
          {meta || t(`pets:types.${pet.type}`)}
        </p>
      </div>
    </Link>
  );
}

/** Fila del resumen — el patrón de "Reportes Activos" del diseño. */
function PetSummaryRow({ pet, t }: { pet: Pet; t: TFunction }) {
  const photo = pet.photos?.find((p) => p.is_primary) ?? pet.photos?.[0];

  return (
    <Link
      to={`/pets/${pet.id}`}
      className="flex items-center gap-4 p-3 bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 hover:border-primary/40 hover:shadow-sm transition-all"
    >
      <div className="h-14 w-14 shrink-0 rounded-xl overflow-hidden bg-gray-100 dark:bg-gray-800">
        {photo ? (
          <img src={cloudinaryThumb(photo.url, 112)} alt="" loading="lazy" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <PawPlaceholder className="w-1/2" />
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <p className="font-display text-base font-semibold text-gray-900 dark:text-gray-100 truncate">
          {pet.name}
        </p>
        <p className="text-sm text-gray-500 dark:text-gray-400 truncate">
          {pet.description || [pet.breed, pet.color].filter(Boolean).join(' · ') || t(`pets:types.${pet.type}`)}
        </p>
        {pet.city && (
          <p className="flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500 mt-0.5">
            <Icon name="location-on" className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{pet.city}</span>
          </p>
        )}
      </div>

      <span
        className={`shrink-0 text-xs font-bold text-white px-2 py-1 rounded-md ${statusBadgeBg(pet.status)}`}
      >
        {t(`pets:status.${pet.status}`)}
      </span>
      {/* A 390px el chevron le comía ~28px al texto, que es donde vive la única
          información de la fila. Es decorativo —lo clickeable es la fila
          entera— así que abajo de 640px se va. */}
      <Icon
        name="chevron-right"
        className="hidden sm:block h-5 w-5 shrink-0 text-gray-300 dark:text-gray-600"
      />
    </Link>
  );
}

/**
 * El encabezado de una sección del resumen.
 *
 * El "ver todas" lleva `aria-label` propio porque las tres secciones repiten el
 * mismo texto visible: tres links que se anuncian igual son tres destinos
 * indistinguibles para quien tabula (WCAG 2.4.4). El texto visible sigue
 * contenido en el nombre accesible, como pide 2.5.3.
 */
function SectionHeader({
  title,
  subtitle,
  viewAllLabel,
  viewAllAria,
  viewAllTo,
  action,
}: {
  title: string;
  subtitle: string;
  viewAllLabel?: string;
  viewAllAria?: string;
  viewAllTo?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 mb-4">
      <div className="min-w-0">
        <h2 className="font-display text-headline text-gray-900 dark:text-gray-100">{title}</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">{subtitle}</p>
      </div>
      {/* La separación entre los dos controles va en el contenedor y NO como
          margen del botón: un `mr-3` existe siempre, también cuando el "ver
          todas" no se dibuja, y ahí deja al botón 12px adentro del borde
          derecho de las tarjetas de abajo. Medido: botón en 1236 contra 1248 de
          la columna. Con `gap` la separación sólo existe si hay dos hijos. */}
      <div className="shrink-0 flex items-center gap-3">
        {action}
        {viewAllLabel && viewAllTo && (
          <Link
            to={viewAllTo}
            aria-label={viewAllAria}
            className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:text-primary-dark transition-colors"
          >
            {viewAllLabel}
            <Icon name="chevron-right" className="h-4 w-4" />
          </Link>
        )}
      </div>
    </div>
  );
}

export function ProfilePage() {
  const { t, i18n } = useTranslation(['profile', 'common', 'badges', 'pets', 'adoption']);
  const { user, refreshUser } = useAuth();
  const updateMe = useUpdateMe();
  const uploadPhoto = useUploadProfilePhoto();
  const { data: badges } = useMyBadges();
  const { data: publicProfile, isLoading: statsLoading } = usePublicProfile(user?.id ?? '');
  const petsQuery = useMyPets();
  const reportedQuery = useReportedPets();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // El corte owned/adoption vive en `shared/utils/ownedPetBuckets` y lo comparte
  // con `MyPetsPage`: escrito a mano en los dos lados, un estado nuevo rompería
  // uno solo, en silencio.
  //
  // Estas dos tajadas siguen viviendo acá afuera porque las leen cosas que NO
  // están dentro de la rama que envuelve `ListState`: el "ver todas" del
  // encabezado y la sección "En adopción". Con la query caída las dos dan `[]`,
  // y ahí eso es correcto: ninguna de las dos AFIRMA nada — un link que no
  // aparece y una sección que no se dibuja no le dicen al usuario que no tiene
  // mascotas. El cartel lo pone la sección de arriba, una sola vez.
  const myPets = petsQuery.data;
  const { owned: ownedPets, adoption: adoptionPets } = splitOwnedPets(myPets);

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [city, setCity] = useState('');
  const [nameError, setNameError] = useState('');
  const [success, setSuccess] = useState(false);
  const [apiError, setApiError] = useState('');
  const [photoError, setPhotoError] = useState('');

  // Verification state
  const { data: verificationStatus, error: verificationError } = useVerificationStatus();
  const sendEmailOTP = useSendEmailOTP();
  const confirmEmailOTP = useConfirmEmailOTP();
  const [accordionOpen, setAccordionOpen] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [verifyCode, setVerifyCode] = useState('');
  const [verifyError, setVerifyError] = useState('');
  const [resendCountdown, setResendCountdown] = useState(0);
  const verificationDisabled = (verificationError as any)?.status === 501;

  // Se sincroniza desde el servidor SÓLO fuera del modo edición.
  //
  // El botón del avatar sigue vivo con el formulario abierto, y su éxito llama
  // `refreshUser()` → objeto `user` nuevo → este efecto pisaba lo que la persona
  // estuviera tipeando, con el formulario abierto y sin decir nada. Ahora que
  // editar es un modo explícito con contrato de "cancelar = deshacer", que algo
  // más borre los campos es directamente pérdida de datos.
  //
  // Fuera de edición no hay nada que pisar, y `openEdit` siembra los campos con
  // lo guardado cada vez que se abre, así que nunca se abre con datos viejos.
  useEffect(() => {
    if (!user || editing) return;
    setName(user.name);
    setPhone(user.phone ?? '');
    setCity(user.city ?? '');
  }, [user, editing]);

  useEffect(() => {
    if (resendCountdown <= 0) return;
    const timer = setTimeout(() => setResendCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCountdown]);

  const handleSendOTP = async () => {
    setVerifyError('');
    try {
      await sendEmailOTP.mutateAsync();
      // Vaciar lo tipeado: el backend retira los códigos anteriores al acuñar uno
      // nuevo, así que los dígitos que quedaron en la caja pertenecen a un código
      // que ya no puede matchear. Enviarlos quema uno de los 5 intentos y devuelve
      // "inválido" sin ninguna explicación. Sólo en el camino de ÉXITO: si el
      // pedido se rechazó, no se acuñó nada y lo tipeado puede seguir sirviendo.
      setVerifyCode('');
      setOtpSent(true);
      setResendCountdown(60);
    } catch (err) {
      setVerifyError(getErrorMessage(err, t));
      // El cooldown es el único límite cuya espera se mide en segundos, así que
      // es el único que alimenta el contador. El tope diario se cuenta en horas
      // y su mensaje ya dice "mañana"; la reserva del canal no trae número
      // porque depende del tráfico de terceros.
      //
      // Se pasa al paso de confirmación: un cooldown significa que ya se emitió
      // un código y probablemente esté en la casilla del usuario.
      if (err instanceof ApiError && err.retryAfter) {
        // El cooldown significa que YA se emitió un código y probablemente esté
        // en la casilla, por eso pasa al paso de confirmación.
        //
        // El rate limit de ruta NO acuñó nada: murió en el middleware, antes de
        // llegar al servicio. Arranca el contador —que apaga el botón— pero deja
        // al usuario donde estaba. Es el tercer 429 de este endpoint y hasta
        // ahora era el único sin número, así que no pasaba nada en pantalla.
        if (err.code === 'otp_cooldown') {
          setOtpSent(true);
          setResendCountdown(err.retryAfter);
        } else if (err.code === 'rate_limit_exceeded') {
          setResendCountdown(err.retryAfter);
        }
      }
    }
  };

  const handleConfirmOTP = async (e: React.FormEvent) => {
    e.preventDefault();
    setVerifyError('');
    if (verifyCode.length !== 6) {
      setVerifyError(t('profile:otpLengthError'));
      return;
    }
    try {
      await confirmEmailOTP.mutateAsync(verifyCode);
      // `refreshUser()` NO es opcional acá, y esta línea es la que evita que
      // verificarse quede en silencio absoluto.
      //
      // El distintivo "Verificado" de la tarjeta de arriba lee `user.is_verified`
      // del `AuthContext`, que es `useState` — NO consume React Query. El
      // `invalidateQueries(['me'])` del hook no lo toca: sólo refresca la caché
      // de React Query, y nadie lee `['me']` desde el contexto. Así que al
      // confirmar pasaba esto: `verificationStatus` sí se refrescaba y ocultaba
      // esta sección, mientras el distintivo nunca aparecía. La verificación
      // desaparecía de la pantalla sin que nada dijera que salió bien, hasta
      // recargar la página entera.
      //
      // Lo introdujo el rediseño: antes la sección se quedaba y mostraba su
      // propio "Verificado" desde `verificationStatus`. Al ocultarla, el único
      // acuse de recibo pasó a depender de un estado que nadie actualizaba.
      await refreshUser();
      setAccordionOpen(false);
      setOtpSent(false);
      setVerifyCode('');
    } catch (err) {
      setVerifyError(getErrorMessage(err, t));
    }
  };

  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];
    const MAX = 5 * 1024 * 1024;

    if (!ALLOWED.includes(file.type)) {
      setPhotoError(t('profile:photoFormatError'));
      e.target.value = '';
      return;
    }
    if (file.size > MAX) {
      setPhotoError(t('profile:photoSizeError'));
      e.target.value = '';
      return;
    }

    setPhotoError('');
    uploadPhoto.mutate(file, {
      onSuccess: async () => {
        await refreshUser();
      },
      onError: (err) => {
        setPhotoError(getErrorMessage(err, t));
      },
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setNameError('');
    setApiError('');
    setSuccess(false);

    if (!name.trim()) {
      setNameError(t('common:required'));
      return;
    }

    updateMe.mutate(
      { name: name.trim(), phone: phone.trim(), city: city.trim() || undefined },
      {
        onSuccess: async () => {
          await refreshUser();
          // Se cierra el formulario para que las filas de contacto muestren lo
          // recién guardado: el aviso de éxito sin ver el dato nuevo obliga a
          // creerle a un cartel.
          setEditing(false);
          setSuccess(true);
          setTimeout(() => setSuccess(false), 3000);
        },
        onError: (err) => {
          setApiError(getErrorMessage(err, t));
        },
      }
    );
  };

  const openEdit = () => {
    // Sembrar con lo guardado en el momento de abrir: el efecto de arriba ya no
    // corre en modo edición, así que esta es la única puerta por la que entran
    // los valores frescos.
    setName(user?.name ?? '');
    setPhone(user?.phone ?? '');
    setCity(user?.city ?? '');
    setNameError('');
    setApiError('');
    setEditing(true);
  };

  const cancelEdit = () => {
    // Volver a lo guardado, no a lo tipeado: cancelar tiene que deshacer.
    setName(user?.name ?? '');
    setPhone(user?.phone ?? '');
    setCity(user?.city ?? '');
    setNameError('');
    setApiError('');
    setEditing(false);
  };

  if (!user) return null;

  const memberSince = formatMemberSince(user.created_at, i18n.language);
  const earnedAt = new Map((badges ?? []).map((b: Badge) => [b.badge_type, b.earned_at]));

  return (
    <div className="bg-gray-50 dark:bg-gray-950 min-h-screen">
      {/* Sin banda de encabezado: la banda existe para llevar un título y un
          subtítulo, y el perfil no tiene ninguno de los dos — el nombre de la
          persona ya es el encabezado. */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* ── Columna izquierda: quién sos ── */}
          <aside className="lg:col-span-1 space-y-6">
            {/* Tarjeta de perfil */}
            <section className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800 p-6">
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => (editing ? cancelEdit() : openEdit())}
                  aria-expanded={editing}
                  className="inline-flex items-center gap-1.5 text-sm font-semibold text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 hover:border-primary hover:text-primary transition-colors"
                >
                  {editing ? (
                    <>
                      <Icon name="close" className="h-4 w-4" />
                      {t('common:cancel')}
                    </>
                  ) : (
                    <>
                      <Icon name="description" className="h-4 w-4" />
                      {t('profile:edit')}
                    </>
                  )}
                </button>
              </div>

              <div className="flex flex-col items-center text-center -mt-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadPhoto.isPending}
                  className="relative group rounded-full"
                  aria-label={t('profile:changePhoto')}
                >
                  {user.profile_photo_url ? (
                    <img
                      src={cloudinaryThumb(user.profile_photo_url, 224)}
                      alt=""
                      className="h-28 w-28 rounded-full object-cover ring-4 ring-primary/20"
                    />
                  ) : (
                    <div className="h-28 w-28 rounded-full bg-primary/10 dark:bg-primary/20 ring-4 ring-primary/20 flex items-center justify-center font-display text-4xl font-bold text-primary">
                      {user.name.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <span className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 group-disabled:opacity-100 transition-opacity">
                    {uploadPhoto.isPending ? (
                      <Icon name="spinner" className="h-6 w-6 text-white animate-spin" />
                    ) : (
                      <Icon name="photo-camera" className="h-6 w-6 text-white" />
                    )}
                  </span>
                </button>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={handlePhotoChange}
                  className="hidden"
                />

                <h1 className="font-display text-headline text-gray-900 dark:text-gray-100 mt-4 break-words">
                  {user.name}
                </h1>

                {(memberSince || user.city) && (
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    {[memberSince && t('profile:memberSince', { date: memberSince }), user.city]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                )}

                {user.is_verified && (
                  <span className="inline-flex items-center gap-1 mt-3 text-xs font-semibold text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/30 px-3 py-1 rounded-full">
                    <Icon name="check-circle" className="h-3.5 w-3.5" />
                    {t('profile:verified')}
                  </span>
                )}
              </div>

              {photoError && (
                <p className="text-danger text-sm mt-3 text-center">{photoError}</p>
              )}

              {success && (
                <p className="text-green-600 dark:text-green-400 text-sm font-medium mt-4 text-center">
                  {t('profile:saveSuccess')}
                </p>
              )}

              {!editing ? (
                <div className="mt-5 pt-4 border-t border-gray-100 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
                  <ContactRow icon="mail" label={t('profile:email')} value={user.email} />
                  <ContactRow
                    icon="call"
                    label={t('profile:phone')}
                    value={user.phone || t('profile:noPhone')}
                    muted={!user.phone}
                  />
                </div>
              ) : (
                <form
                  onSubmit={handleSubmit}
                  noValidate
                  className="mt-5 pt-5 border-t border-gray-100 dark:border-gray-800 space-y-4"
                >
                  {/* Email — sólo lectura */}
                  <div>
                    <label
                      htmlFor="profile-email"
                      className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                    >
                      {t('profile:email')}
                    </label>
                    <input
                      id="profile-email"
                      type="email"
                      value={user.email}
                      disabled
                      className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-400 dark:text-gray-500 px-3 py-2.5 text-sm cursor-not-allowed"
                    />
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                      {t('profile:emailReadOnly')}
                    </p>
                  </div>

                  <div>
                    <label
                      htmlFor="name"
                      className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                    >
                      {t('profile:name')} *
                    </label>
                    <input
                      id="name"
                      type="text"
                      value={name}
                      onChange={(e) => {
                        setName(e.target.value);
                        if (nameError) setNameError('');
                      }}
                      className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-2.5 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                    />
                    {nameError && <p className="text-danger text-sm mt-1">{nameError}</p>}
                  </div>

                  <div>
                    <label
                      htmlFor="phone"
                      className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                    >
                      {t('profile:phone')}
                    </label>
                    <input
                      id="phone"
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder={t('profile:phonePlaceholder')}
                      className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-2.5 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                    />
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                      {t('profile:phoneHint')}
                    </p>
                  </div>

                  <div>
                    <label
                      htmlFor="city"
                      className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                    >
                      {t('profile:city')}
                    </label>
                    <input
                      id="city"
                      type="text"
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      placeholder={t('profile:cityPlaceholder')}
                      className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-2.5 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                    />
                  </div>

                  {apiError && <p className="text-danger text-sm">{apiError}</p>}

                  <button
                    type="submit"
                    disabled={updateMe.isPending}
                    className="w-full bg-primary hover:bg-primary-dark disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold rounded-xl px-4 py-2.5 text-sm transition-colors"
                  >
                    {updateMe.isPending ? t('common:loading') : t('profile:save')}
                  </button>
                </form>
              )}
            </section>

            {/* Verificación — oculta si el feature flag está apagado (501) y
                también cuando la cuenta YA está verificada: la tarjeta de arriba
                lleva su propio distintivo "Verificado", así que dejarla dibujaba
                el mismo dato dos veces en la misma columna sin ofrecer ninguna
                acción. La sección existe para verificarse, no para informar que
                ya lo estás. */}
            {!verificationDisabled && !verificationStatus?.is_verified && (
              <section className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800 p-6">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="font-display text-base font-semibold text-gray-900 dark:text-gray-100">
                    {t('profile:accountVerification')}
                  </h2>
                  {verificationStatus !== undefined ? (
                    <button
                      type="button"
                      onClick={() => setAccordionOpen((o) => !o)}
                      className="text-sm font-semibold text-primary flex items-center gap-1"
                      aria-expanded={accordionOpen}
                    >
                      {t('profile:verifyEmail')}
                      <span className={`transition-transform ${accordionOpen ? 'rotate-180' : ''}`}>
                        ▾
                      </span>
                    </button>
                  ) : null}
                </div>

                {/* Sin repetir `!verificationStatus?.is_verified`: la sección
                    entera ya no se renderiza cuando la cuenta está verificada,
                    así que acá esa condición no puede ser falsa. Un guard que no
                    puede disparar se lee como protección y no protege nada. */}
                {accordionOpen && (
                  <div className="mt-4 border-t border-gray-100 dark:border-gray-800 pt-4">
                    {!otpSent ? (
                      <div>
                        <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                          <Trans
                            i18nKey="profile:otpWillSend"
                            values={{ email: user?.email }}
                            components={{ 1: <strong /> }}
                          />
                        </p>
                        {verifyError && <p className="text-sm text-danger mb-2">{verifyError}</p>}
                        <button
                          type="button"
                          onClick={handleSendOTP}
                          disabled={sendEmailOTP.isPending || resendCountdown > 0}
                          className="bg-primary hover:bg-primary-dark disabled:opacity-60 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors"
                        >
                          {sendEmailOTP.isPending
                            ? t('profile:sending')
                            : resendCountdown > 0
                              ? t('profile:resendIn', { seconds: resendCountdown })
                              : t('profile:sendCode')}
                        </button>
                      </div>
                    ) : (
                      <form onSubmit={handleConfirmOTP} noValidate>
                        <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                          {t('profile:checkEmail')}
                        </p>
                        <input
                          type="text"
                          inputMode="numeric"
                          maxLength={6}
                          value={verifyCode}
                          onChange={(e) => {
                            setVerifyCode(e.target.value.replace(/\D/g, '').slice(0, 6));
                            setVerifyError('');
                          }}
                          placeholder="000000"
                          aria-label={t('profile:confirmCode')}
                          className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-2.5 text-center text-xl tracking-widest mb-2 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                        />
                        {verifyError && <p className="text-sm text-danger mb-2">{verifyError}</p>}
                        <button
                          type="submit"
                          disabled={confirmEmailOTP.isPending}
                          className="w-full bg-primary hover:bg-primary-dark disabled:opacity-60 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors mb-2"
                        >
                          {confirmEmailOTP.isPending
                            ? t('profile:verifying')
                            : t('profile:confirmCode')}
                        </button>
                        {resendCountdown > 0 ? (
                          <p className="text-xs text-gray-400 dark:text-gray-500 text-center">
                            {t('profile:resendIn', { seconds: resendCountdown })}
                          </p>
                        ) : (
                          <button
                            type="button"
                            onClick={handleSendOTP}
                            // Sin `resendCountdown > 0`: este botón vive en la rama
                            // FALSA de `resendCountdown > 0 ? … : …`, así que ahí la
                            // condición no puede ser verdadera. Leerla como
                            // protección era leer algo que no protegía nada.
                            disabled={sendEmailOTP.isPending}
                            className="w-full text-xs text-primary font-semibold text-center disabled:opacity-60"
                          >
                            {t('profile:resendCode')}
                          </button>
                        )}
                      </form>
                    )}
                  </div>
                )}
              </section>
            )}

            {/* Estadísticas */}
            <section className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800 p-6">
              <h2 className="font-display text-base font-semibold text-gray-900 dark:text-gray-100 mb-4">
                {t('profile:statsTitle')}
              </h2>
              {statsLoading ? (
                <div className="grid grid-cols-2 gap-3">
                  {[1, 2, 3, 4].map((i) => (
                    <div
                      key={i}
                      className="h-[4.75rem] rounded-xl bg-gray-100 dark:bg-gray-800 animate-pulse"
                    />
                  ))}
                </div>
              ) : publicProfile ? (
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { value: publicProfile.total_points, label: t('profile:statsPoints') },
                    { value: publicProfile.total_reports, label: t('profile:statsReports') },
                    { value: publicProfile.found_count, label: t('profile:statsFound') },
                    { value: publicProfile.share_count, label: t('profile:statsShared') },
                  ].map((stat) => (
                    <div
                      key={stat.label}
                      className="text-center p-3 rounded-xl bg-primary/5 border border-primary/20"
                    >
                      <p className="font-display text-2xl font-bold text-primary">{stat.value}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        {stat.label}
                      </p>
                    </div>
                  ))}
                </div>
              ) : null}
            </section>

            {/* Logros */}
            <section className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800 p-6">
              <h2 className="font-display text-base font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                <Icon name="celebration" className="h-5 w-5 text-primary" />
                {t('profile:achievementsTitle')}
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5 mb-4">
                {t('badges:achievementsSubtitle')}
              </p>
              <div className="grid grid-cols-2 gap-3">
                {Object.keys(BADGE_META).map((type) => (
                  <AchievementTile
                    key={type}
                    type={type}
                    earnedAt={earnedAt.get(type)}
                    language={i18n.language}
                    t={t}
                  />
                ))}
                {/* Y los que el usuario SÍ tiene pero esta versión del front no
                    conoce. La grilla recorre `BADGE_META`, que es una constante
                    compilada acá: si el backend otorga un séptimo logro antes de
                    que `shared/types` lo liste, sin esto se gana un logro que no
                    puede ver. Se dibujan al final para no correr a los seis de
                    siempre. */}
                {(badges ?? [])
                  .filter((b: Badge) => !BADGE_META[b.badge_type])
                  .map((b: Badge) => (
                    <AchievementTile
                      key={b.id}
                      type={b.badge_type}
                      earnedAt={b.earned_at}
                      language={i18n.language}
                      t={t}
                    />
                  ))}
              </div>
            </section>
          </aside>

          {/* ── Columna derecha: qué tenés ── */}
          <div className="lg:col-span-2 space-y-10">
            {/* Mis mascotas */}
            <section>
              <SectionHeader
                title={t('pets:mine.title')}
                subtitle={t('profile:myPetsSubtitle')}
                viewAllLabel={ownedPets.length > SUMMARY_LIMIT ? t('profile:viewAll') : undefined}
                viewAllAria={t('profile:viewAllPets')}
                viewAllTo={myPetsRoute()}
                action={
                  <Link
                    to="/pets/create"
                    className="inline-flex items-center gap-1.5 bg-primary hover:bg-primary-dark text-white font-semibold rounded-xl px-4 py-2.5 text-sm transition-colors"
                  >
                    + {t('pets:mine.add')}
                  </Link>
                }
              />

              {/* El cartel de error va sin `errorTitle` propio: cae justo debajo
                  del encabezado "Mis mascotas", que ya nombra lo que no se pudo
                  leer. Los reportes, más abajo, sí lo necesitan — su encabezado
                  no existe cuando no hay nada. */}
              <ListState
                query={petsQuery}
                select={(pets) => splitOwnedPets(pets).owned}
                loading={
                  // El esqueleto mide lo que mide la tarjeta: foto de 160px más
                  // 105px de cuerpo (nombre, metadatos y padding). Un placeholder
                  // de otro alto convierte la carga en un salto de layout que no
                  // se ve en una captura ni en un test.
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    {[0, 1].map((i) => (
                      <div
                        key={i}
                        className="bg-white dark:bg-gray-900 rounded-2xl overflow-hidden border border-gray-100 dark:border-gray-800 animate-pulse"
                      >
                        <div className="h-40 bg-gray-100 dark:bg-gray-800" />
                        <div className="p-4">
                          <div className="h-7 w-2/3 bg-gray-100 dark:bg-gray-800 rounded" />
                          <div className="h-5 w-1/2 bg-gray-100 dark:bg-gray-800 rounded mt-0.5" />
                        </div>
                      </div>
                    ))}
                  </div>
                }
                empty={
                  <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 text-center py-12 px-6">
                    <PawPlaceholder className="w-16 mx-auto mb-4" />
                    {/* La pregunta que decide el cartel es si tiene ALGUNA mascota,
                        no si tiene alguna fuera de adopción. `ownedPets` excluye
                        adopción, así que a quien tiene todas sus mascotas ofrecidas
                        en adopción le decía "Todavía no publicaste ninguna mascota"
                        con la sección "En adopción" listándolas justo abajo: un
                        estado vacío desmentido por otra sección de la misma
                        pantalla. Exactamente el defecto del wizard de /publish
                        (PR #132).

                        El `?? 0` se queda y ahora es honesto: este slot sólo se
                        dibuja cuando la query RESPONDIÓ, así que `myPets` es un
                        dato, no una incógnita. */}
                    <p className="text-gray-700 dark:text-gray-300 font-semibold mb-4">
                      {(myPets?.length ?? 0) > 0 ? t('profile:allInAdoption') : t('pets:mine.empty')}
                    </p>
                    <Link
                      to="/pets/create"
                      className="inline-block bg-primary hover:bg-primary-dark text-white font-semibold rounded-xl px-6 py-2.5 text-sm transition-colors"
                    >
                      {(myPets?.length ?? 0) > 0
                        ? t('pets:mine.add')
                        : t('pets:mine.emptyAction')}
                    </Link>
                  </div>
                }
              >
                {(pets) => (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    {pets.slice(0, SUMMARY_LIMIT).map((pet: Pet) => (
                      <PetSummaryCard key={pet.id} pet={pet} t={t} />
                    ))}
                  </div>
                )}
              </ListState>
            </section>

            {/* Mis reportes — sólo si hay alguno. Una sección vacía permanente en
                el perfil de quien nunca reportó una callejera es ruido: la
                pestaña de "Mis mascotas" sigue estando para descubrirla.

                `loading` y `empty` van en fragmento vacío, y son dos decisiones
                distintas. `loading`: hoy no se dibuja nada mientras carga, y
                meterle un esqueleto sería un cambio de diseño — esto es un
                porte. `empty`: el silencio de arriba es correcto y se queda.
                Lo único que cambia es que ese MISMO silencio ya no se usa
                cuando la consulta falló. */}
            <ListState
              query={reportedQuery}
              // El default dice "no pudimos cargar esta LISTA". Acá el cartel
              // aterriza en una página donde el perfil, los logros y las
              // mascotas cargaron bien, y esta sección no tiene encabezado
              // propio en ese estado: sin nombrarla, el usuario no sabe qué es
              // lo que no se pudo leer.
              errorTitle={t('profile:reportsLoadError')}
              loading={<></>}
              empty={<></>}
            >
              {(reported) => (
                <section>
                  <SectionHeader
                    title={t('pets:reports.tabReported')}
                    subtitle={t('profile:reportsSubtitle')}
                    viewAllLabel={
                      reported.length > SUMMARY_LIMIT ? t('profile:viewAll') : undefined
                    }
                    viewAllAria={t('profile:viewAllReports')}
                    viewAllTo={myPetsRoute('reported')}
                  />
                  <div className="space-y-3">
                    {reported.slice(0, SUMMARY_LIMIT).map((pet: Pet) => (
                      <PetSummaryRow key={pet.id} pet={pet} t={t} />
                    ))}
                  </div>
                </section>
              )}
            </ListState>

            {/* En adopción — mismo criterio que los reportes.

                Esta sección NO lleva su propio `ListState`, y es a propósito:
                sale de la misma query que "Mis mascotas", que siempre se dibuja
                y por lo tanto siempre carga el cartel cuando esa query falla.
                Un segundo cartel sería el mismo fallo dicho dos veces en la
                misma columna. Con la query caída `adoptionPets` es `[]` y la
                sección no se dibuja — que no afirma nada. */}
            {!petsQuery.isLoading && adoptionPets.length > 0 && (
              <section>
                <SectionHeader
                  title={t('adoption:profile.tab')}
                  subtitle={t('profile:adoptionSubtitle')}
                  viewAllLabel={
                    adoptionPets.length > SUMMARY_LIMIT ? t('profile:viewAll') : undefined
                  }
                  viewAllAria={t('profile:viewAllAdoption')}
                  viewAllTo={myPetsRoute('adoption')}
                />
                <div className="space-y-3">
                  {adoptionPets.slice(0, SUMMARY_LIMIT).map((pet: Pet) => (
                    <PetSummaryRow key={pet.id} pet={pet} t={t} />
                  ))}
                </div>
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
