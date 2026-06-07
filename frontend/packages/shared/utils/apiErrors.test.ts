import { describe, it, expect, vi } from 'vitest';
import { ApiError } from '../api/client';
import { getErrorMessage } from './apiErrors';

// Mock TFunction that returns the key unchanged (simulates missing translation)
const tIdentity = (key: string) => key;

// Mock TFunction that always translates (simulates a real i18n lookup)
const tTranslate = (key: string) => {
  const map: Record<string, string> = {
    'errors.pet_not_found': 'Pet not found',
    'errors.invalid_credentials': 'Invalid email or password',
    'errors.unknown_error': 'An unexpected error occurred',
  };
  return map[key] ?? key;
};

describe('getErrorMessage', () => {
  it('returns translated string for a known ApiError code', () => {
    const err = new ApiError('pet_not_found', 404, 'mascota no encontrada');
    expect(getErrorMessage(err, tTranslate)).toBe('Pet not found');
  });

  it('returns unknown_error translation when ApiError code has no translation', () => {
    const err = new ApiError('some_unmapped_code', 500, 'raw message');
    // tIdentity returns the key unchanged → falls back to unknown_error
    expect(getErrorMessage(err, tTranslate)).toBe('An unexpected error occurred');
  });

  it('falls back to unknown_error for a plain Error (not ApiError)', () => {
    const err = new Error('network error');
    expect(getErrorMessage(err, tTranslate)).toBe('An unexpected error occurred');
  });

  it('falls back to unknown_error for a string thrown', () => {
    expect(getErrorMessage('oops', tTranslate)).toBe('An unexpected error occurred');
  });

  it('falls back to unknown_error for null', () => {
    expect(getErrorMessage(null, tTranslate)).toBe('An unexpected error occurred');
  });

  it('calls t with the correct errors.{code} key for a known ApiError', () => {
    const t = vi.fn().mockImplementation((key: string) => {
      if (key === 'errors.invalid_credentials') return 'Invalid email or password';
      return key;
    });
    const err = new ApiError('invalid_credentials', 401, 'credenciales inválidas');
    const result = getErrorMessage(err, t);
    expect(t).toHaveBeenCalledWith('errors.invalid_credentials');
    expect(result).toBe('Invalid email or password');
  });

  it('calls t with errors.unknown_error when tIdentity returns key unchanged', () => {
    const t = vi.fn().mockImplementation(tIdentity);
    const err = new ApiError('pet_not_found', 404, 'mascota no encontrada');
    // tIdentity returns 'errors.pet_not_found' unchanged → falls back
    const result = getErrorMessage(err, t);
    expect(t).toHaveBeenCalledWith('errors.pet_not_found');
    expect(t).toHaveBeenCalledWith('errors.unknown_error');
    expect(result).toBe('errors.unknown_error');
  });
});

describe('ApiError', () => {
  it('sets code and status correctly', () => {
    const err = new ApiError('user_banned', 403, 'usuario bloqueado');
    expect(err.code).toBe('user_banned');
    expect(err.status).toBe(403);
    expect(err.message).toBe('usuario bloqueado');
    expect(err.name).toBe('ApiError');
  });

  it('is an instance of Error', () => {
    const err = new ApiError('any_code', 500, 'msg');
    expect(err instanceof Error).toBe(true);
    expect(err instanceof ApiError).toBe(true);
  });
});
