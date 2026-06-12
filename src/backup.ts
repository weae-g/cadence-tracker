// Резервная копия и восстановление ВСЕХ данных одним JSON-файлом.
// Включает письма, стадии, задачи, взаимодействия, типы, метаданные документов
// и сами файлы документов (бинарь из IndexedDB кодируется в base64).
//
// Восстановление полностью заменяет текущие данные, после чего страница
// перезагружается, чтобы интерфейс гарантированно подхватил новое состояние.

import { Item, Task, Interaction } from './types';
import {
  loadItems,
  loadStages,
  loadTasks,
  loadInteractions,
  loadInteractionKinds,
  saveItems,
  saveStages,
  saveTasks,
  saveInteractions,
  saveInteractionKinds,
  normalizeImport,
  today,
} from './storage';
import { DocMeta, getDocs, getDocumentFiles, restoreDocuments } from './docs';

type BlobEntry = { id: string; mime: string; data: string };

export type Backup = {
  app: 'resolve-table';
  version: 1;
  exportedAt: string;
  items: Item[];
  stages: string[];
  tasks: Task[];
  interactions: Interaction[];
  interactionKinds: string[];
  docs: DocMeta[];
  blobs: BlobEntry[];
};

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function base64ToBlob(base64: string, mime: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime || 'application/octet-stream' });
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Собирает и скачивает полную копию.
export async function downloadBackup(): Promise<void> {
  const files = await getDocumentFiles();
  const blobs: BlobEntry[] = [];
  for (const { meta, blob } of files) {
    blobs.push({ id: meta.id, mime: meta.mime, data: await blobToBase64(blob) });
  }

  const backup: Backup = {
    app: 'resolve-table',
    version: 1,
    exportedAt: new Date().toISOString(),
    items: loadItems(),
    stages: loadStages(),
    tasks: loadTasks(),
    interactions: loadInteractions(),
    interactionKinds: loadInteractionKinds(),
    docs: getDocs(),
    blobs,
  };

  download(new Blob([JSON.stringify(backup)], { type: 'application/json' }), `resolve-table-backup-${today()}.json`);
}

const isStrArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === 'string');

// Восстанавливает данные из текста JSON-файла. Бросает ошибку, если файл не наш.
export async function restoreBackup(json: string): Promise<void> {
  let parsed: Partial<Backup>;
  try {
    parsed = JSON.parse(json) as Partial<Backup>;
  } catch {
    throw new Error('Файл повреждён или это не JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || parsed.app !== 'resolve-table') {
    throw new Error('Это не файл резервной копии Resolve Table.');
  }

  // Письма прогоняем через нормализацию (восстановит историю и пропуски полей).
  const items = normalizeImport(parsed.items);
  if (items) saveItems(items);
  if (isStrArray(parsed.stages) && parsed.stages.length) saveStages(parsed.stages);
  if (Array.isArray(parsed.tasks)) saveTasks(parsed.tasks as Task[]);
  if (Array.isArray(parsed.interactions)) saveInteractions(parsed.interactions as Interaction[]);
  if (isStrArray(parsed.interactionKinds) && parsed.interactionKinds.length) saveInteractionKinds(parsed.interactionKinds);

  // Документы: метаданные + восстановление бинаря в IndexedDB.
  const metas = Array.isArray(parsed.docs) ? (parsed.docs.filter((d) => d && typeof d.id === 'string') as DocMeta[]) : [];
  const blobEntries = Array.isArray(parsed.blobs) ? parsed.blobs : [];
  const blobs = blobEntries
    .filter((b): b is BlobEntry => !!b && typeof b.id === 'string' && typeof b.data === 'string')
    .map((b) => ({ id: b.id, blob: base64ToBlob(b.data, b.mime) }));
  await restoreDocuments(metas, blobs);
}
