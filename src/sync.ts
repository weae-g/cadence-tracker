// Синхронизация данных с сервером. Сервер хранит снимок (формат резервной копии)
// в файле, который обновление кода не трогает — поэтому введённые данные
// сохраняются между версиями и доступны с других устройств после входа.
//
// Модель простая и безопасная: при входе тянем снимок с сервера (pull),
// при изменениях — отправляем (push, только admin). Конфликты — «выигрывает
// последний сохранивший».

import { Backup } from './backup';
import { getDocs } from './docs';
import {
  STORAGE_KEY,
  STAGES_KEY,
  TASKS_KEY,
  INTERACTIONS_KEY,
  INTERACTION_KINDS_KEY,
  PROJECTS_KEY,
  PROJECT_META_KEY,
} from './storage';

// Получить снимок данных с сервера. null — если данных ещё нет или ошибка.
export async function fetchStore(): Promise<Backup | null> {
  try {
    const res = await fetch('/api/store', { credentials: 'same-origin' });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || data.empty) return null;
    return data as Backup;
  } catch {
    return null;
  }
}

// Сохранить снимок на сервер (требует роль admin на сервере).
export async function pushStore(backup: Backup): Promise<boolean> {
  try {
    const res = await fetch('/api/store', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(backup),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// Лёгкая «подпись» текущих данных — чтобы дёшево понять, менялись ли они,
// и не пересобирать тяжёлый снимок без надобности. Файлы документов учитываем
// по метаданным (их состав меняется только при добавлении/удалении файла).
export function dataSignature(): string {
  const ls = (k: string) => localStorage.getItem(k) || '';
  const docsMeta = getDocs()
    .map((d) => `${d.id}:${d.size}:${d.name}:${d.stage}:${d.counterparty}:${d.note}`)
    .join(',');
  return [
    ls(STORAGE_KEY),
    ls(STAGES_KEY),
    ls(TASKS_KEY),
    ls(INTERACTIONS_KEY),
    ls(INTERACTION_KINDS_KEY),
    ls(PROJECTS_KEY),
    ls(PROJECT_META_KEY),
    docsMeta,
  ].join('§');
}
