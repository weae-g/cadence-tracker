// Импорт писем из CSV/Excel. Тянет тяжёлый xlsx лениво (он уже есть в проекте).
// Заголовки сопоставляются по именам (как в нашем экспорте), регистр и пробелы не важны.

import { Item } from './types';
import { normalizeImport } from './storage';

// Сопоставление «нормализованный заголовок → поле письма».
const HEADER_MAP: Record<string, keyof Item> = {
  'дата отправки': 'sentDate',
  'контрагент': 'counterparty',
  'адресат / контакт': 'contact',
  'адресат': 'contact',
  'контакт': 'contact',
  'email / канал': 'channel',
  'email': 'channel',
  'канал': 'channel',
  'тематика': 'topic',
  'тема письма': 'subject',
  'тема': 'subject',
  'статус ответа': 'status',
  'статус': 'status',
  'дата ответа': 'replyDate',
  'кто отвечает': 'owner',
  'ответственный': 'owner',
  'примечание': 'note',
  'проект': 'project',
};

const norm = (s: string) => s.toString().trim().toLowerCase().replace(/\s+/g, ' ');

function toDateString(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const s = String(value ?? '').trim();
  // дд.мм.гггг → гггг-мм-дд
  const m = s.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return s;
}

// Читает файл и возвращает готовые письма (нормализованные). Пустые строки отброшены.
export async function importLettersFromFile(file: File): Promise<Item[]> {
  const XLSX = await import('xlsx');
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return [];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });

  const partials = rows
    .map((row) => {
      const item: Partial<Item> = {};
      for (const [rawKey, rawVal] of Object.entries(row)) {
        const field = HEADER_MAP[norm(rawKey)];
        if (!field) continue;
        if (field === 'sentDate' || field === 'replyDate') {
          (item as Record<string, unknown>)[field] = toDateString(rawVal);
        } else {
          (item as Record<string, unknown>)[field] = String(rawVal ?? '').trim();
        }
      }
      return item;
    })
    // строка считается письмом, если есть хоть что-то содержательное
    .filter((p) => (p.counterparty || p.subject || p.topic || p.contact || p.channel || '').toString().trim());

  return normalizeImport(partials) ?? [];
}
