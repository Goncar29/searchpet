import { describe, it, expect } from 'vitest';
import { canManagePet } from './petAuthorization';
import type { Pet } from '../types';

const pet = (extra: Partial<Pet>): Pet => ({ id: 'pet-1', name: 'Luna', type: 'perro', status: 'lost', ...extra } as Pet);

// Espeja canManagePet del backend (internal/service/authorization.go). Si esa
// regla cambia, estos casos son los que avisan que quedaron desincronizadas.
describe('canManagePet', () => {
  it('la mascota con dueño la maneja su dueño', () => {
    expect(canManagePet(pet({ owner_id: 'u1' }), 'u1')).toBe(true);
    expect(canManagePet(pet({ owner_id: 'u1' }), 'u2')).toBe(false);
  });

  // Una callejera no tiene dueño: si sólo valiera el dueño, no la podría cerrar
  // nadie nunca.
  it('la callejera la maneja quien la reportó', () => {
    expect(canManagePet(pet({ reporter_id: 'u1' }), 'u1')).toBe(true);
    expect(canManagePet(pet({ reporter_id: 'u1' }), 'u2')).toBe(false);
  });

  // Con dueño, el reportante NO hereda el permiso: manda el dueño.
  it('teniendo dueño, el reportante no alcanza', () => {
    expect(canManagePet(pet({ owner_id: 'u1', reporter_id: 'u2' }), 'u2')).toBe(false);
    expect(canManagePet(pet({ owner_id: 'u1', reporter_id: 'u2' }), 'u1')).toBe(true);
  });

  it('sin mascota, sin usuario o sin ninguno de los dos ids, no maneja nadie', () => {
    expect(canManagePet(null, 'u1')).toBe(false);
    expect(canManagePet(undefined, 'u1')).toBe(false);
    expect(canManagePet(pet({ owner_id: 'u1' }), null)).toBe(false);
    expect(canManagePet(pet({ owner_id: 'u1' }), undefined)).toBe(false);
    expect(canManagePet(pet({}), 'u1')).toBe(false);
  });
});
