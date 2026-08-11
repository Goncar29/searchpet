import { renderHook, act } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { useMapFilters } from './useMapFilters';

describe('useMapFilters', () => {
  it('el borrador NO cambia lo aplicado hasta Aplicar', () => {
    const { result } = renderHook(() => useMapFilters());

    act(() => result.current.setDraft({ type: 'gato' }));
    expect(result.current.draft.type).toBe('gato');
    // Sin esto, cada tecla dispararia un request — el defecto que el patron
    // borrador/aplicado existe para evitar.
    expect(result.current.applied.type).toBeUndefined();

    act(() => result.current.apply());
    expect(result.current.applied.type).toBe('gato');
  });

  it('los dias de calendario se convierten a instantes, con el dia de "hasta" ENTERO', () => {
    const { result } = renderHook(() => useMapFilters());

    act(() => result.current.setDraft({ fromDay: '2026-08-01', toDay: '2026-08-10' }));
    act(() => result.current.apply());

    expect(result.current.applied.from).toBe(new Date(2026, 7, 1, 0, 0, 0, 0).toISOString());
    // Quien elige "hasta el 10" espera que el 10 entre COMPLETO. Con medianoche
    // todo lo reportado ese dia queda afuera y el filtro parece roto.
    expect(result.current.applied.to).toBe(new Date(2026, 7, 10, 23, 59, 59, 999).toISOString());
  });

  it('un estado se agrega y se saca del conjunto', () => {
    const { result } = renderHook(() => useMapFilters());

    act(() => result.current.toggleStatus('lost'));
    act(() => result.current.toggleStatus('sighting'));
    expect(result.current.draft.status).toEqual(['lost', 'sighting']);

    act(() => result.current.toggleStatus('lost'));
    expect(result.current.draft.status).toEqual(['sighting']);
  });

  it('sacar el ultimo estado deja el filtro en undefined, no en lista vacia', () => {
    const { result } = renderHook(() => useMapFilters());

    act(() => result.current.toggleStatus('lost'));
    act(() => result.current.toggleStatus('lost'));
    act(() => result.current.apply());

    // Una lista vacia serializada seria `status=` — un filtro que no filtra
    // nada pero ensucia la URL y la clave de cache.
    expect(result.current.draft.status).toBeUndefined();
    expect(result.current.applied.status).toBeUndefined();
  });

  it('reset vacia las dos mitades', () => {
    const { result } = renderHook(() => useMapFilters());
    act(() => result.current.setDraft({ type: 'perro' }));
    act(() => result.current.apply());
    act(() => result.current.reset());
    expect(result.current.draft).toEqual({});
    expect(result.current.applied).toEqual({});
  });

  it('applied mantiene su identidad si no se aplica nada nuevo', () => {
    const { result, rerender } = renderHook(() => useMapFilters());
    const primero = result.current.applied;

    act(() => result.current.setDraft({ type: 'perro' }));
    rerender();

    // applied entra al queryKey. Si cambiara de identidad en cada render sin
    // que el usuario aplique nada, React Query lo veria igual (hashea el
    // contenido), pero cualquier efecto que dependa de el se dispararia solo.
    expect(result.current.applied).toBe(primero);
  });
});
