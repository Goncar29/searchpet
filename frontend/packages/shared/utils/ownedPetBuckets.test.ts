import { describe, it, expect } from 'vitest';
import { splitOwnedPets, ADOPTION_BUCKET_STATUSES } from './ownedPetBuckets';
import { ALLOWED_TRANSITIONS } from './petStatusTransitions';
import type { PetStatus } from '../types';

const pet = (status: PetStatus, name = status) => ({ status, name });

describe('splitOwnedPets', () => {
  it('manda a adopción sólo los estados de adopción', () => {
    const { owned, adoption } = splitOwnedPets([
      pet('registered'),
      pet('lost'),
      pet('adoption'),
      pet('found'),
      pet('adopted'),
      pet('archived'),
    ]);

    expect(owned.map((p) => p.status)).toEqual(['registered', 'lost', 'found', 'archived']);
    expect(adoption.map((p) => p.status)).toEqual(['adoption', 'adopted']);
  });

  it('no pierde ni duplica ninguna mascota', () => {
    // El invariante que importa: los dos baldes particionan la entrada. Si un
    // estado nuevo no cayera en ninguno, desaparecería de las dos pantallas sin
    // que nada fallara.
    const todas = (Object.keys(ALLOWED_TRANSITIONS) as PetStatus[]).map((s) => pet(s));
    const { owned, adoption } = splitOwnedPets(todas);

    expect(owned.length + adoption.length).toBe(todas.length);
    expect([...owned, ...adoption].map((p) => p.status).sort()).toEqual(
      todas.map((p) => p.status).sort(),
    );
  });

  it('cubre TODOS los estados que existen, no sólo los que conozco hoy', () => {
    // Recorre la máquina de estados en vez de una lista escrita a mano: si
    // mañana aparece un estado nuevo, este test lo ve sin que nadie lo agregue
    // acá. Sin esto, "los cubre a todos" es una afirmación que envejece sola.
    const estados = Object.keys(ALLOWED_TRANSITIONS) as PetStatus[];
    expect(estados.length).toBeGreaterThanOrEqual(7);

    for (const s of estados) {
      const { owned, adoption } = splitOwnedPets([pet(s)]);
      expect(owned.length + adoption.length).toBe(1);
    }
  });

  it('trata undefined y null como lista vacía', () => {
    for (const entrada of [undefined, null]) {
      const { owned, adoption } = splitOwnedPets(entrada);
      expect(owned).toEqual([]);
      expect(adoption).toEqual([]);
    }
  });

  it('la lista de adopción es explícita, no derivada', () => {
    // Espeja `AdoptionVisibleStatuses` del backend. Si alguien la vacía o le
    // suma un estado de búsqueda activa, esto se pone rojo.
    expect([...ADOPTION_BUCKET_STATUSES].sort()).toEqual(['adopted', 'adoption']);
  });
});
