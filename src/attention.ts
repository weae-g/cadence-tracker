// Единая логика «Требует внимания» — чтобы Сводка и счётчик во вкладке браузера
// считали одно и то же.
//
//  • Запланированный «следующий шаг» наступил (дата ≤ сегодня) — высший приоритет.
//  • Письмо без ответа просрочено И без запланированного шага (план «снимает» письмо
//    отсюда до нужной даты — чтобы список не превращался в шум).
//  • Задача не выполнена и срок уже подошёл.

import { Item, Task } from './types';
import { today } from './storage';

const ONE_DAY = 24 * 60 * 60 * 1000;

function parseDate(value: string): Date | null {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Срок ожидания письма, дн. (тот же расчёт, что в таблице писем).
export function letterWaitDays(item: Item): number | null {
  const start = parseDate(item.sentDate);
  if (!start) return null;
  const end = parseDate(item.replyDate) ?? new Date();
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / ONE_DAY));
}

export type Attention = { waiting: Item[]; nextSteps: Item[]; tasks: Task[]; total: number };

export function computeAttention(items: Item[], tasks: Task[], overdueDays: number, project: string): Attention {
  const inProj = (p: string) => project === '' || p === project;
  const todayStr = today();
  const scoped = items.filter((i) => inProj(i.project));

  const nextSteps = scoped
    .filter((i) => i.nextActionDate && i.nextActionDate <= todayStr)
    .sort((a, b) => a.nextActionDate.localeCompare(b.nextActionDate));

  const waiting = scoped
    .filter((i) => !i.replyDate && !i.nextActionDate && (letterWaitDays(i) ?? 0) > overdueDays)
    .sort((a, b) => (letterWaitDays(b) ?? 0) - (letterWaitDays(a) ?? 0));

  const dueTasks = tasks
    .filter((t) => inProj(t.project) && !t.done && !!t.dueDate && t.dueDate <= todayStr)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  return { waiting, nextSteps, tasks: dueTasks, total: waiting.length + nextSteps.length + dueTasks.length };
}
