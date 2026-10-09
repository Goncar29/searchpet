// ============================================================
// SearchPet — showAlert, the app's replacement for Alert.alert.
//
// Same signature as Alert.alert, so a call site only changes its name. The
// native dialog ignored the theme (a white box in dark mode) and, on Android,
// showed at most three buttons, which already hid Report in the chat menu.
// AlertHost (mounted once in app/_layout.tsx) draws each alert with the same
// card as the menus.
//
// Alerts queue: one raised while another is open (a "report sent" notice from
// a button of a confirmation) shows after the current one closes.
// ============================================================

import { useSyncExternalStore } from 'react';

export interface AlertButton {
  text?: string;
  onPress?: () => void;
  /** 'cancel' is not drawn as a row: closing the card (X, outside, back) runs it. */
  style?: 'default' | 'cancel' | 'destructive';
}

export interface PendingAlert {
  id: number;
  title: string;
  message?: string;
  buttons: AlertButton[];
}

let queue: PendingAlert[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function showAlert(title: string, message?: string, buttons?: AlertButton[]): void {
  queue = [...queue, { id: nextId++, title, message: message || undefined, buttons: buttons ?? [] }];
  emit();
}

/** Removes the alert on screen. Called by AlertHost before running a button. */
export function dismissCurrentAlert(): void {
  if (queue.length === 0) return;
  queue = queue.slice(1);
  emit();
}

/** Tests only: drop every pending alert. */
export function resetAlerts(): void {
  queue = [];
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const current = () => queue[0] ?? null;

export function useCurrentAlert(): PendingAlert | null {
  return useSyncExternalStore(subscribe, current, current);
}
