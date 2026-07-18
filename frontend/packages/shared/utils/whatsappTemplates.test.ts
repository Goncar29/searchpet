// ============================================================
// Tests for whatsappTemplates.ts
// Runner: Vitest or Jest (no DOM APIs used — pure TS)
// ============================================================

import { buildWhatsAppMessage, buildWhatsAppContactURL } from './whatsappTemplates';
import type { PetStatus } from '../types';

const basePet = {
  name: 'Rex',
  type: 'perro',
  breed: 'Labrador',
  color: 'dorado',
  status: 'lost' as PetStatus,
};

// ============================================================
// buildWhatsAppMessage
// ============================================================

describe('buildWhatsAppMessage', () => {
  it('includes pet name, type, breed and color', () => {
    const msg = buildWhatsAppMessage(basePet);
    expect(msg).toContain('Rex');
    expect(msg).toContain('perro');
    expect(msg).toContain('Labrador');
    expect(msg).toContain('dorado');
  });

  it('includes the share URL when provided', () => {
    const url = 'https://lostpets.app/pet/abc123';
    const msg = buildWhatsAppMessage(basePet, url);
    expect(msg).toContain(url);
  });

  it('does NOT include undefined or null when no share URL', () => {
    const msg = buildWhatsAppMessage(basePet);
    expect(msg).not.toContain('undefined');
    expect(msg).not.toContain('null');
  });

  it('stays within 500 characters', () => {
    const msg = buildWhatsAppMessage(basePet, 'https://lostpets.app/pet/abc123');
    expect(msg.length).toBeLessThanOrEqual(500);
  });

  it('truncates a 400-char description to stay within 500 chars total', () => {
    const longDescription = 'a'.repeat(400);
    const msg = buildWhatsAppMessage(
      { ...basePet, description: longDescription },
      'https://lostpets.app/pet/abc123',
    );
    expect(msg.length).toBeLessThanOrEqual(500);
    // Description should be truncated with ellipsis
    if (msg.includes('a'.repeat(5))) {
      expect(msg).toContain('...');
    }
  });

  it('shows ENCONTRADA in the header when status is found', () => {
    const msg = buildWhatsAppMessage({ ...basePet, status: 'found' });
    expect(msg).toContain('ENCONTRADA');
  });

  it('shows PERDIDA in the header when status is active', () => {
    const msg = buildWhatsAppMessage(basePet);
    expect(msg).toContain('PERDIDA');
  });

  it('stays within 500 chars with a very long share URL', () => {
    const longUrl = 'https://lostpets.app/pet/' + 'x'.repeat(100);
    const msg = buildWhatsAppMessage(basePet, longUrl);
    expect(msg.length).toBeLessThanOrEqual(500);
  });

  it('frames an adoption pet as EN ADOPCIÓN and never as PERDIDA', () => {
    const msg = buildWhatsAppMessage(
      { name: 'Michi', type: 'gato', status: 'adoption', city: 'Montevideo' },
      'https://searchpet.app/pet/tok',
    );
    expect(msg).toContain('¡EN ADOPCIÓN!');
    expect(msg).toContain('busca un hogar');
    expect(msg).toContain('📍 Montevideo');
    expect(msg).toContain('https://searchpet.app/pet/tok');
    expect(msg).not.toContain('PERDIDA');
  });

  it('omits the city line when no city is given for adoption', () => {
    const msg = buildWhatsAppMessage({ name: 'Michi', type: 'gato', status: 'adoption' });
    expect(msg).toContain('¡EN ADOPCIÓN!');
    expect(msg).not.toContain('📍');
  });
});

// ============================================================
// buildWhatsAppContactURL
// ============================================================

describe('buildWhatsAppContactURL', () => {
  it('produces a valid wa.me URL', () => {
    const url = buildWhatsAppContactURL('+598 99 123 456', basePet);
    expect(url).toMatch(/^https:\/\/wa\.me\//);
  });

  it('normalizes the phone number (removes +, spaces, dashes)', () => {
    const url = buildWhatsAppContactURL('+598 99-123 456', basePet);
    expect(url).toContain('wa.me/59899123456');
    expect(url).not.toContain('+');
    expect(url).not.toContain(' ');
    expect(url).not.toContain('-');
  });

  it('includes an encoded text query param', () => {
    const url = buildWhatsAppContactURL('59899123456', basePet);
    expect(url).toContain('?text=');
  });

  it('the decoded text param is <= 500 chars', () => {
    const url = buildWhatsAppContactURL('59899123456', basePet, 'https://lostpets.app/pet/abc');
    const textParam = new URLSearchParams(url.split('?')[1]).get('text');
    expect(textParam).not.toBeNull();
    expect(textParam!.length).toBeLessThanOrEqual(500);
  });
});
