import { describe, it, expect } from 'vitest';
import { ALLOWED_TRANSITIONS, selectableStatuses } from './petStatusTransitions';
import type { PetStatus } from '../types';

describe('petStatusTransitions', () => {
  // Must mirror backend domain/status_machine.go AllowedTransitions exactly.
  it('mirrors the backend state machine edges', () => {
    expect(ALLOWED_TRANSITIONS).toEqual({
      registered: ['lost', 'archived'],
      lost: ['registered', 'found', 'archived'],
      found: ['registered', 'archived'],
      archived: ['registered'],
      stray: ['found'],
      adoption: ['adopted', 'archived'],
      adopted: ['adoption', 'archived'],
    });
  });

  it('selectableStatuses lists the current status first, then valid targets', () => {
    expect(selectableStatuses('stray')).toEqual(['stray', 'found']);
    expect(selectableStatuses('registered')).toEqual(['registered', 'lost', 'archived']);
    expect(selectableStatuses('lost')).toEqual(['lost', 'registered', 'found', 'archived']);
    expect(selectableStatuses('found')).toEqual(['found', 'registered', 'archived']);
    expect(selectableStatuses('archived')).toEqual(['archived', 'registered']);
  });

  it('never offers an invalid transition for a stray (only found)', () => {
    const options = selectableStatuses('stray');
    expect(options).not.toContain('lost');
    expect(options).not.toContain('registered');
    expect(options).not.toContain('archived');
  });

  it('always includes the current status so the dropdown can show a no-op', () => {
    (['registered', 'lost', 'stray', 'found', 'archived'] as PetStatus[]).forEach((s) => {
      expect(selectableStatuses(s)[0]).toBe(s);
    });
  });
});

describe('adoption cluster transitions', () => {
  it('allows adoption <-> adopted and both -> archived', () => {
    expect(ALLOWED_TRANSITIONS.adoption).toEqual(['adopted', 'archived']);
    expect(ALLOWED_TRANSITIONS.adopted).toEqual(['adoption', 'archived']);
  });
  it('never offers a lost-cluster target from adoption', () => {
    const targets = selectableStatuses('adoption');
    expect(targets).not.toContain('lost');
    expect(targets).not.toContain('found');
    expect(targets).not.toContain('stray');
  });
});
