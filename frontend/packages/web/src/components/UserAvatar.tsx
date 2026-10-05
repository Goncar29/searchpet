import { cloudinaryThumb } from '@shared/utils/cloudinaryThumb';

/**
 * Avatar con caída a la inicial: no todo el mundo subió foto.
 *
 * `px` es el lado en píxeles que se le pide a Cloudinary y va explícito porque
 * el tamaño VISIBLE lo decide `className` (una cadena de Tailwind: desde
 * adentro no hay forma de leerla). Si cambia la clase hay que cambiar el
 * número — un avatar pedido a la medida equivocada no se ve roto, se ve igual
 * y gasta distinto (regla #55).
 */
export function UserAvatar({
  name,
  photoUrl,
  px,
  className,
}: {
  name: string;
  photoUrl?: string | null;
  px: number;
  className: string;
}) {
  if (photoUrl) {
    return (
      <img
        src={cloudinaryThumb(photoUrl, px)}
        alt=""
        loading="lazy"
        className={`${className} rounded-full object-cover bg-gray-100 dark:bg-gray-800`}
      />
    );
  }
  return (
    <div
      aria-hidden="true"
      className={`${className} rounded-full bg-primary/10 dark:bg-primary/20 flex items-center justify-center font-display font-semibold text-primary-dark dark:text-primary-light`}
    >
      {name.charAt(0).toUpperCase()}
    </div>
  );
}
