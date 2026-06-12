// Хранилище документов (PDF, DOCX, картинки и т.п.).
//
// Бинарь файла слишком велик для localStorage (лимит ~5 МБ, только строки),
// поэтому сами файлы лежат в IndexedDB как Blob, а лёгкие метаданные —
// в localStorage. Списки/фильтры строятся по метаданным мгновенно, а сам
// файл подгружается из IndexedDB только при открытии/скачивании.

import { useSyncExternalStore } from 'react';
import { safeSetItem } from './safeStorage';

// Метаданные одного документа. Привязан к письму (itemId), компании
// (counterparty) и этапу (stage) — любого из них достаточно для просмотра.
export type DocMeta = {
  id: string;
  itemId: string; // id письма ('' — если прикреплён прямо к компании)
  counterparty: string; // контрагент (снимок имени на момент загрузки)
  stage: string; // этап воронки, на котором загружен ('' — без этапа)
  name: string; // имя файла
  mime: string; // MIME-тип
  size: number; // размер в байтах
  addedAt: string; // ISO-метка времени загрузки
  note: string; // примечание администратора (необязательно)
};

const DOCS_KEY = 'resolve-table-docs-v1';
const DB_NAME = 'resolve-table-docs';
const STORE = 'blobs';

// crypto.randomUUID есть только в защищённом контексте (https или localhost).
// При раздаче через nginx по голому http его не будет — даём запасной генератор.
function uid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// --- IndexedDB (бинарь файлов) ---

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function putBlob(id: string, blob: Blob): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(blob, id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      }),
  );
}

function getBlob(id: string): Promise<Blob | undefined> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).get(id);
        req.onsuccess = () => resolve(req.result as Blob | undefined);
        req.onerror = () => reject(req.error);
      }),
  );
}

function deleteBlob(id: string): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      }),
  );
}

function clearBlobs(): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      }),
  );
}

// --- Метаданные (localStorage) + общий стор для React ---

function load(): DocMeta[] {
  const raw = localStorage.getItem(DOCS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((d): d is DocMeta => d && typeof d.id === 'string')
      // у документов из старых версий поля note нет — подставляем пустое.
      .map((d) => ({ ...d, note: typeof d.note === 'string' ? d.note : '' }));
  } catch {
    return [];
  }
}

let cache: DocMeta[] = load();
const listeners = new Set<() => void>();

function commit(next: DocMeta[]) {
  cache = next;
  safeSetItem(DOCS_KEY, JSON.stringify(next));
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Хук-подписка: компонент перерисовывается при любом изменении набора документов.
export function useDocs(): DocMeta[] {
  return useSyncExternalStore(subscribe, () => cache);
}

export function getDocs(): DocMeta[] {
  return cache;
}

// --- Операции ---

export async function addDocument(
  file: File,
  attach: { itemId: string; counterparty: string; stage: string },
): Promise<void> {
  const id = uid();
  await putBlob(id, file);
  const meta: DocMeta = {
    id,
    itemId: attach.itemId,
    counterparty: attach.counterparty.trim(),
    stage: attach.stage.trim(),
    name: file.name,
    mime: file.type,
    size: file.size,
    addedAt: new Date().toISOString(),
    note: '',
  };
  commit([meta, ...cache]);
}

export async function removeDocument(id: string): Promise<void> {
  await deleteBlob(id).catch(() => {});
  commit(cache.filter((d) => d.id !== id));
}

// Каскадное удаление при удалении письма — чтобы не осталось «осиротевших» файлов.
export async function removeDocumentsByItem(itemId: string): Promise<void> {
  const doomed = cache.filter((d) => d.itemId === itemId);
  if (doomed.length === 0) return;
  await Promise.all(doomed.map((d) => deleteBlob(d.id).catch(() => {})));
  commit(cache.filter((d) => d.itemId !== itemId));
}

export function updateDocument(id: string, partial: Partial<DocMeta>) {
  commit(cache.map((d) => (d.id === id ? { ...d, ...partial } : d)));
}

// Все документы вместе с бинарём — для выгрузки архивом. Пропускает записи,
// чьи файлы не нашлись в IndexedDB (не валим всю выгрузку из-за одного).
export async function getDocumentFiles(): Promise<{ meta: DocMeta; blob: Blob }[]> {
  const result: { meta: DocMeta; blob: Blob }[] = [];
  for (const meta of cache) {
    const blob = await getBlob(meta.id);
    if (blob) result.push({ meta, blob });
  }
  return result;
}

// Полная замена всех документов (для восстановления из резервной копии):
// стираем старые бинарники, кладём новые, перезаписываем метаданные.
export async function restoreDocuments(metas: DocMeta[], blobs: { id: string; blob: Blob }[]): Promise<void> {
  await clearBlobs();
  for (const { id, blob } of blobs) {
    await putBlob(id, blob);
  }
  commit(metas.map((m) => ({ ...m, note: typeof m.note === 'string' ? m.note : '' })));
}

// Blob документа для встроенного предпросмотра (вызывающий сам создаёт/отзывает URL).
export async function getDocumentBlob(id: string): Promise<Blob | null> {
  return (await getBlob(id)) ?? null;
}

export async function openDocument(id: string): Promise<void> {
  const blob = await getBlob(id);
  if (!blob) {
    window.alert('Файл не найден в хранилище браузера.');
    return;
  }
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank', 'noopener');
  // Не отзываем сразу — вкладке нужно время загрузить содержимое.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function downloadDocument(meta: DocMeta): Promise<void> {
  const blob = await getBlob(meta.id);
  if (!blob) {
    window.alert('Файл не найден в хранилище браузера.');
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = meta.name;
  a.click();
  URL.revokeObjectURL(url);
}

// --- Вспомогательное ---

export function formatSize(bytes: number): string {
  if (!bytes) return '0 Б';
  const units = ['Б', 'КБ', 'МБ', 'ГБ'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / Math.pow(1024, i);
  return `${i === 0 ? value : value.toFixed(1)} ${units[i]}`;
}

const EXT_ICON: Record<string, string> = {
  pdf: '📄',
  doc: '📝',
  docx: '📝',
  xls: '📊',
  xlsx: '📊',
  csv: '📊',
  ppt: '📑',
  pptx: '📑',
  txt: '📃',
  zip: '🗜️',
  rar: '🗜️',
  '7z': '🗜️',
};

export function fileIcon(meta: Pick<DocMeta, 'name' | 'mime'>): string {
  if (meta.mime.startsWith('image/')) return '🖼️';
  const ext = meta.name.split('.').pop()?.toLowerCase() ?? '';
  return EXT_ICON[ext] ?? '📎';
}
