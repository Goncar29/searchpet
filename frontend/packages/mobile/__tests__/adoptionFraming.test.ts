import { posterFraming, shareStatusLabel } from '../utils/adoptionFraming';

describe('posterFraming', () => {
  it('frames adoption as purple ¡EN ADOPCIÓN!', () => {
    expect(posterFraming('adoption')).toEqual({ color: '#7c3aed', header: '¡EN ADOPCIÓN!' });
  });

  it('keeps the found header', () => {
    expect(posterFraming('found')).toEqual({ color: '#22c55e', header: '¡MASCOTA ENCONTRADA!' });
  });

  it('frames adopted as teal ¡ADOPTADO! (never the lost/PERDIDA fallback)', () => {
    expect(posterFraming('adopted')).toEqual({ color: '#0f766e', header: '¡ADOPTADO!' });
  });

  it('defaults to the lost header', () => {
    expect(posterFraming('lost')).toEqual({ color: '#ef4444', header: '¡MASCOTA PERDIDA!' });
  });
});

describe('shareStatusLabel', () => {
  it('labels adoption as EN ADOPCIÓN, never PERDIDA', () => {
    expect(shareStatusLabel('adoption')).toBe('EN ADOPCIÓN');
    expect(shareStatusLabel('adoption')).not.toBe('PERDIDA');
  });

  it('labels adopted as ADOPTADO, never PERDIDA', () => {
    expect(shareStatusLabel('adopted')).toBe('ADOPTADO');
    expect(shareStatusLabel('adopted')).not.toBe('PERDIDA');
  });

  it('labels found as ENCONTRADA and everything else as PERDIDA', () => {
    expect(shareStatusLabel('found')).toBe('ENCONTRADA');
    expect(shareStatusLabel('lost')).toBe('PERDIDA');
    expect(shareStatusLabel('sighting')).toBe('PERDIDA');
  });
});
