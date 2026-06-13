// Лёгкий стор статуса синхронизации с сервером — чтобы показать в шапке
// «Сохранено / Синхронизация… / Офлайн» и не гадать, ушли ли данные на сервер.

import { useSyncExternalStore } from 'react';

export type SyncState = 'idle' | 'saving' | 'saved' | 'offline';

let status: SyncState = 'idle';
const listeners = new Set<() => void>();

export function setSyncStatus(next: SyncState) {
  if (next === status) return;
  status = next;
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useSyncStatus(): SyncState {
  return useSyncExternalStore(subscribe, () => status);
}
