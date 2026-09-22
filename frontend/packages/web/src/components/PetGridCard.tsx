import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { cloudinaryCardThumb, type ListingVariant } from '@shared/utils/cloudinaryThumb';
import type { Pet } from '@shared/types';
import { statusBadgeBg } from '../utils/statusBadge';
import { PawPlaceholder } from './PawPlaceholder';
import { Icon } from './Icon';

type PetGridCardProps = {
  pet: Pet;

  /**
   * Variante de miniatura. SIN default a propósito: cada grilla mide distinto
   * y el número salió de medirla — Adoptar da tarjetas de ~280px (`adopt`,
   * 450x300) y el perfil público de ~376px (`feed`, 600x300). Un default
   * serviría una foto borrosa o de más en una de las dos, y **ninguna de las
   * dos fallaría**: sólo cambiaría el bandwidth de Cloudinary, que es el
   * techo del proyecto. Elegirla es siempre una decisión del llamador.
   */
  thumb: ListingVariant;

  /**
   * Texto del badge, ya traducido y en la caja que corresponda. SIN default
   * a propósito, por el mismo motivo que arriba: Adoptar lo FIJA porque
   * `AdoptionVisibleStatuses` tiene un solo estado, y el perfil público lo
   * DERIVA porque su grilla mezcla estados y un texto fijo mentiría en la
   * mayoría de las tarjetas. No hay un valor que sirva para las dos.
   *
   * El COLOR no se recibe: sale siempre de `statusBadgeBg(pet.status)`,
   * porque ahí no hay decisión que tomar.
   */
  badgeLabel: string;

  /**
   * Contenido extra al pie de la info. Adoptar agrega la descripción y el CTA
   * "ver perfil"; el perfil público no agrega nada. Es `children` y no un
   * booleano porque **no agregar nada no es una decisión que alguien tenga
   * que tomar** — a diferencia de las dos props de arriba.
   *
   * **Esto se renderiza DENTRO del `<a>` de la tarjeta, así que no puede
   * contener nada interactivo**: ni `<Link>`, ni `<button>`, ni un `input`.
   * Anidar un interactivo dentro de otro es HTML inválido y le da al mismo
   * destino dos entradas distintas en la lista de enlaces de un lector de
   * pantalla. Si el diseño pide un "ver más", va como `<span>` — la tarjeta
   * entera ya es el link, así que la señal visual alcanza. Lo protege
   * `la tarjeta es UN solo enlace` en el test de este archivo y su gemelo en
   * `AdoptPage.test.tsx`, que lo mide sobre el llamador real.
   */
  children?: ReactNode;
};

/**
 * Tarjeta de mascota de las grillas públicas.
 *
 * Nació unificando `AdoptPage` y `UserProfilePage`, que dibujaban el mismo
 * marco por separado. El motivo no fue la duplicación de líneas sino la
 * DIVERGENCIA: el mismo badge conceptual había quedado en dos formas
 * (`rounded-md px-2` acá, `rounded-full px-2.5` en la home) sin que nadie lo
 * decidiera, y cada rediseño futuro tocaba una pantalla y no la otra.
 *
 * Las dos tarjetas de `HomePage` quedan deliberadamente AFUERA: la del feed
 * usa chips en vez de una línea unida y muestra descripción en vez de ciudad,
 * y la de búsqueda por foto dibuja un `ImageSearchResult` —otro tipo, sin
 * `status` y con `similarity`— así que su badge no puede ser éste. Forzarlas
 * acá adentro exigiría aflojar el tipo, que es justo lo que no queremos.
 */
export function PetGridCard({ pet, thumb, badgeLabel, children }: PetGridCardProps) {
  const { t } = useTranslation(['pets']);

  return (
    <Link to={`/pets/${pet.id}`} className="block group">
      <div className="bg-white dark:bg-gray-900 rounded-2xl overflow-hidden shadow-sm border border-gray-100 dark:border-gray-800 hover:shadow-md transition-shadow">
        {/* Foto */}
        <div className="h-48 bg-gray-100 dark:bg-gray-800 relative overflow-hidden">
          {pet.photos?.[0]?.url ? (
            <img
              src={cloudinaryCardThumb(pet.photos[0].url, thumb)}
              loading="lazy"
              alt={pet.name}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <PawPlaceholder className="w-2/5 max-w-20" />
            </div>
          )}
          <span
            className={`absolute top-3 left-3 text-xs font-bold text-white px-2 py-1 rounded-md ${statusBadgeBg(pet.status)}`}
          >
            {badgeLabel}
          </span>
        </div>

        {/* Info */}
        <div className="p-4">
          {/* El peso va EXPLÍCITO y no es redundante: `font-display` fija la
              FAMILIA, el preflight de Tailwind v4 deja los h1-h6 en
              `font-weight: inherit`, y `text-lg` no trae peso propio (a
              diferencia de `text-headline` y `text-display`). Sin esto el
              nombre cae a 400 — la regresión del #161. */}
          <h3 className="font-display text-lg font-semibold text-gray-900 dark:text-gray-100">
            {pet.name}
          </h3>

          {/* Una línea de metadatos en vez de cuatro chips, como en el diseño.
              Se conservan los mismos datos: tipo, raza y color van juntos, y la
              ciudad baja a su propia línea con el ícono en lugar del emoji. */}
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5 min-h-[1.25rem]">
            {[pet.type && t(`pets:types.${pet.type}`), pet.breed, pet.color]
              .filter(Boolean)
              .join(' · ')}
          </p>

          {/* El `min-h` va aunque no haya ciudad: sin eso una tarjeta sin
              ciudad queda más baja que sus vecinas y la grilla se desparrama. */}
          <p className="flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400 mt-1 min-h-[1.25rem]">
            {pet.city && (
              <>
                <Icon name="location-on" className="h-4 w-4 shrink-0" />
                <span className="truncate">{pet.city}</span>
              </>
            )}
          </p>

          {children}
        </div>
      </div>
    </Link>
  );
}
