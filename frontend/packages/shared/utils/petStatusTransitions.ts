import type { PetStatus } from '../types';

/**
 * Valid pet status transitions — the single frontend source of truth, mirroring
 * the backend state machine in `backend/internal/domain/status_machine.go`
 * (AllowedTransitions). Keep both in sync: any edge changed there must be
 * changed here too. Used to constrain the status dropdown so the UI never
 * offers a transition the backend will reject with 422.
 */
export const ALLOWED_TRANSITIONS: Record<PetStatus, PetStatus[]> = {
  registered: ['lost', 'archived'],
  lost: ['registered', 'found', 'archived'],
  found: ['registered', 'archived'],
  archived: ['registered'],
  stray: ['found'],
};

/**
 * Statuses selectable from `current` in a status dropdown: the current status
 * itself (so the control can render its current value as a no-op) followed by
 * every valid transition target.
 */
export function selectableStatuses(current: PetStatus): PetStatus[] {
  return [current, ...(ALLOWED_TRANSITIONS[current] ?? [])];
}
