import type { Pet } from '../types';

/**
 * Espejo en el cliente de `canManagePet` (backend/internal/service/authorization.go).
 *
 * Las mascotas con dueño las maneja su dueño; las callejeras —que no tienen
 * dueño— las maneja quien las reportó. Una mascota sin ninguno de los dos no la
 * maneja nadie.
 *
 * Esto NO es un control de seguridad: el borde real es el backend, que devuelve
 * 403. Sirve para no ofrecerle al usuario una acción que le van a rechazar
 * después de llenar el formulario entero.
 *
 * Si cambia la regla del backend, tiene que cambiar acá también — es la misma
 * decisión escrita dos veces porque viven en procesos distintos.
 */
export function canManagePet(pet: Pet | null | undefined, userID: string | null | undefined): boolean {
  if (!pet || !userID) return false;
  if (pet.owner_id) return pet.owner_id === userID;
  if (pet.reporter_id) return pet.reporter_id === userID;
  return false;
}
