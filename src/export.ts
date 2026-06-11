// Экспорт всех данных. Книга Excel (.xlsx) с листом на каждый раздел —
// чтобы ничего из введённого не терялось и удобно читалось.
// Сами файлы документов выгружаются отдельной кнопкой (ZIP), т.к. это бинарь.

import * as XLSX from 'xlsx';
import { Item } from './types';
import { loadInteractions, loadTasks, today } from './storage';
import { getDocs, getDocumentFiles, formatSize } from './docs';
import { buildZip, ZipEntry } from './zip';

const ONE_DAY = 24 * 60 * 60 * 1000;

function parseDate(value: string): Date | null {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Срок ожидания, дн. — тот же расчёт, что в таблице писем.
function waitingDays(item: Item): number | '' {
  const start = parseDate(item.sentDate);
  if (!start) return '';
  const end = parseDate(item.replyDate) ?? new Date();
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / ONE_DAY));
}

function dateTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('ru-RU');
}

// История смены статусов письма одной строкой: «Отослал (01.06) → Ответ (07.06)».
function historyText(item: Item): string {
  return item.history
    .map((h) => {
      const d = new Date(h.at);
      const when = Number.isNaN(d.getTime()) ? h.at : d.toLocaleDateString('ru-RU');
      return `${h.stage} (${when})`;
    })
    .join(' → ');
}

// Ширина колонок по самому длинному значению (с разумным потолком).
function autoCols(rows: (string | number)[][]): { wch: number }[] {
  const widths: number[] = [];
  rows.forEach((row) =>
    row.forEach((cell, i) => {
      const len = cell == null ? 0 : String(cell).length;
      widths[i] = Math.max(widths[i] ?? 8, Math.min(60, len + 2));
    }),
  );
  return widths.map((wch) => ({ wch }));
}

function addSheet(wb: XLSX.WorkBook, name: string, rows: (string | number)[][]) {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = autoCols(rows);
  if (rows.length > 1) ws['!freeze'] = { xSplit: 0, ySplit: 1 } as never; // закрепить шапку
  XLSX.utils.book_append_sheet(wb, ws, name);
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Главный экспорт: одна книга со всеми разделами.
export function exportToExcel(items: Item[], stages: string[]) {
  const docs = getDocs();
  const tasks = loadTasks();
  const interactions = loadInteractions();
  const wb = XLSX.utils.book_new();

  // Письма
  addSheet(wb, 'Письма', [
    [
      '№',
      'Дата отправки',
      'Контрагент',
      'Адресат / контакт',
      'Email / канал',
      'Тематика',
      'Тема письма',
      'Статус ответа',
      'Дата ответа',
      'Срок ожидания, дн.',
      'Кто отвечает',
      'Примечание',
      'История статусов',
      'Документов',
    ],
    ...items.map((it, idx) => [
      idx + 1,
      it.sentDate,
      it.counterparty,
      it.contact,
      it.channel,
      it.topic,
      it.subject,
      it.status,
      it.replyDate,
      waitingDays(it),
      it.owner,
      it.note,
      historyText(it),
      docs.filter((d) => d.itemId === it.id).length,
    ]),
  ]);

  // Взаимодействия
  addSheet(wb, 'Взаимодействия', [
    ['Тип', 'Дата', 'Контрагент', 'Кратко: о чём', 'Участники', 'Примечание'],
    ...interactions.map((i) => [i.kind, i.date, i.counterparty, i.title, i.participants, i.note]),
  ]);

  // Задачи
  addSheet(wb, 'Задачи', [
    ['Задача', 'Описание', 'Срок', 'Статус', 'Результат', 'Дата выполнения'],
    ...tasks.map((t) => [
      t.title,
      t.description,
      t.dueDate,
      t.done ? 'Выполнено' : 'В работе',
      t.result,
      t.completedDate,
    ]),
  ]);

  // Документы (перечень; сами файлы — кнопкой «Скачать файлы»)
  addSheet(wb, 'Документы', [
    ['Имя файла', 'Тип', 'Размер', 'Контрагент', 'Этап', 'Письмо', 'Загружен'],
    ...docs.map((d) => {
      const item = items.find((i) => i.id === d.itemId);
      return [
        d.name,
        d.mime || '—',
        formatSize(d.size),
        d.counterparty,
        d.stage,
        item ? item.subject || item.counterparty : '',
        dateTime(d.addedAt),
      ];
    }),
  ]);

  // Стадии воронки (порядок) — чтобы конфигурация воронки тоже не терялась
  addSheet(wb, 'Стадии', [['Порядок', 'Стадия'], ...stages.map((s, i) => [i + 1, s])]);

  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([out], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  download(blob, `resolve-table-${today()}.xlsx`);
}

function sanitize(name: string): string {
  return (name || 'без_имени').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'без_имени';
}

// Выгрузка всех файлов документов одним ZIP. Раскладывает по папкам-компаниям,
// разводит совпадающие имена суффиксом. Возвращает число упакованных файлов.
export async function exportDocumentFiles(): Promise<number> {
  const files = await getDocumentFiles();
  if (files.length === 0) return 0;

  const used = new Map<string, number>();
  const entries: ZipEntry[] = [];
  for (const { meta, blob } of files) {
    const folder = sanitize(meta.counterparty || 'Без контрагента');
    let name = `${folder}/${sanitize(meta.name)}`;
    const seen = used.get(name) ?? 0;
    used.set(name, seen + 1);
    if (seen > 0) {
      const dot = name.lastIndexOf('.');
      name =
        dot > folder.length ? `${name.slice(0, dot)} (${seen})${name.slice(dot)}` : `${name} (${seen})`;
    }
    entries.push({ name, data: new Uint8Array(await blob.arrayBuffer()) });
  }

  download(buildZip(entries), `resolve-table-files-${today()}.zip`);
  return files.length;
}
