import type { Pet, PetStatus } from '../types';

/**
 * Los estados que sacan a una mascota propia de "Mis mascotas" y la ponen en
 * "En adopción".
 *
 * Espeja `AdoptionVisibleStatuses` del backend (`internal/domain/pet_status.go`).
 * Como allá, la lista es EXPLÍCITA y no se deriva del estado: si mañana se
 * agrega un estado nuevo, hay que decidir a qué balde va, y el default —quedarse
 * en "mis mascotas"— es el que no esconde nada.
 */
export const ADOPTION_BUCKET_STATUSES: readonly PetStatus[] = ['adoption', 'adopted'];

export interface OwnedPetBuckets<T> {
  /** Las mascotas propias que NO están ofrecidas en adopción. */
  owned: T[];
  /** Las ofrecidas en adopción o ya adoptadas. */
  adoption: T[];
}

/**
 * Parte las mascotas propias en los dos baldes que la UI muestra por separado.
 *
 * Vive acá y no dentro de una página porque lo consumen DOS pantallas —
 * `MyPetsPage` (sus pestañas) y `ProfilePage` (sus secciones)—. Estaba escrito a
 * mano adentro de la primera; copiarlo a la segunda habría dejado dos
 * definiciones del mismo criterio, y el día que se agregue un estado se rompe
 * una sola de las dos, en silencio. Una definición, dos consumidores.
 *
 * Genérico en `T` para que sirva con `Pet` y con cualquier cosa que tenga
 * `status` — los tests lo usan con objetos mínimos.
 */
export function splitOwnedPets<T extends Pick<Pet, 'status'>>(
  pets: T[] | undefined | null,
): OwnedPetBuckets<T> {
  const all = pets ?? [];
  return {
    owned: all.filter((p) => !ADOPTION_BUCKET_STATUSES.includes(p.status)),
    adoption: all.filter((p) => ADOPTION_BUCKET_STATUSES.includes(p.status)),
  };
}
