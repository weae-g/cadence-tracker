// Календарь: письма (отправка / ответ / следующий шаг), сроки задач и взаимодействия
// на месячной сетке. Клик по событию открывает запись (письмо — карточкой, остальное —
// переходом в раздел). Учитывает активный проект.

import { useMemo, useState } from 'react';
import { Item } from './types';
import { loadInteractions, loadTasks } from './storage';
import { Section } from './GlobalSearch';

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const pad = (n: number) => String(n).padStart(2, '0');
const keyOf = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;

type Ev = { icon: string; label: string; color: string; onClick: () => void };

export function Calendar({
  items,
  project,
  onOpenLetter,
  onJump,
}: {
  items: Item[];
  project: string;
  onOpenLetter: (id: string, ids?: string[]) => void;
  onJump: (section: Section) => void;
}) {
  const now = new Date();
  const [cursor, setCursor] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const todayKey = keyOf(now.getFullYear(), now.getMonth(), now.getDate());

  const eventsByDay = useMemo(() => {
    const inProj = (p: string) => project === '' || p === project;
    const map = new Map<string, Ev[]>();
    const add = (date: string, ev: Ev) => {
      const day = (date || '').slice(0, 10);
      if (!day) return;
      const list = map.get(day);
      if (list) list.push(ev);
      else map.set(day, [ev]);
    };

    const letters = items.filter((i) => inProj(i.project));
    const letterIds = letters.map((l) => l.id);
    const cp = (i: Item) => i.counterparty.trim() || 'Без контрагента';
    letters.forEach((l) => {
      const open = () => onOpenLetter(l.id, letterIds);
      if (l.sentDate) add(l.sentDate, { icon: '✉', label: cp(l), color: '#3b82f6', onClick: open });
      if (l.replyDate) add(l.replyDate, { icon: '✓', label: cp(l), color: '#10b981', onClick: open });
      if (l.nextActionDate)
        add(l.nextActionDate, {
          icon: '⏰',
          label: cp(l),
          color: l.nextActionDate < todayKey ? '#ef4444' : '#f97316',
          onClick: open,
        });
    });

    loadTasks()
      .filter((t) => inProj(t.project))
      .forEach((t) => {
        const open = () => onJump('tasks');
        if (!t.done && t.dueDate)
          add(t.dueDate, {
            icon: '◷',
            label: t.title || 'Задача',
            color: t.dueDate < todayKey ? '#ef4444' : '#6366f1',
            onClick: open,
          });
        if (t.done && t.completedDate)
          add(t.completedDate, { icon: '✓', label: t.title || 'Задача', color: '#10b981', onClick: open });
      });

    loadInteractions()
      .filter((i) => inProj(i.project) && i.date)
      .forEach((i) =>
        add(i.date, {
          icon: '•',
          label: i.title || i.kind || 'Взаимодействие',
          color: '#8b5cf6',
          onClick: () => onJump('interactions'),
        }),
      );

    return map;
  }, [items, project, onOpenLetter, onJump, todayKey]);

  // Сетка месяца: ведущие пустые ячейки до понедельника + дни месяца.
  const cells = useMemo(() => {
    const first = new Date(cursor.y, cursor.m, 1);
    const offset = (first.getDay() + 6) % 7; // Пн = 0
    const days = new Date(cursor.y, cursor.m + 1, 0).getDate();
    const out: { day: number; key: string }[] = [];
    for (let i = 0; i < offset; i += 1) out.push({ day: 0, key: `blank-${i}` });
    for (let d = 1; d <= days; d += 1) out.push({ day: d, key: keyOf(cursor.y, cursor.m, d) });
    while (out.length % 7 !== 0) out.push({ day: 0, key: `tail-${out.length}` });
    return out;
  }, [cursor]);

  const monthLabel = (() => {
    const s = new Date(cursor.y, cursor.m, 1).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
    return s.charAt(0).toUpperCase() + s.slice(1);
  })();

  const step = (dir: -1 | 1) =>
    setCursor((c) => {
      const m = c.m + dir;
      if (m < 0) return { y: c.y - 1, m: 11 };
      if (m > 11) return { y: c.y + 1, m: 0 };
      return { y: c.y, m };
    });
  const goToday = () => setCursor({ y: now.getFullYear(), m: now.getMonth() });

  return (
    <section className="card">
      <div className="cal-toolbar">
        <div className="cal-nav">
          <button type="button" className="clear-button" onClick={() => step(-1)} title="Предыдущий месяц">
            ←
          </button>
          <h2 className="cal-month">{monthLabel}</h2>
          <button type="button" className="clear-button" onClick={() => step(1)} title="Следующий месяц">
            →
          </button>
          <button type="button" className="clear-button" onClick={goToday}>
            Сегодня
          </button>
        </div>
        <div className="cal-legend">
          <span><i style={{ background: '#3b82f6' }} />Отправлено</span>
          <span><i style={{ background: '#10b981' }} />Ответ</span>
          <span><i style={{ background: '#f97316' }} />След. шаг</span>
          <span><i style={{ background: '#6366f1' }} />Задача</span>
          <span><i style={{ background: '#8b5cf6' }} />Взаимод.</span>
        </div>
      </div>

      <div className="cal-grid cal-head-row">
        {WEEKDAYS.map((w) => (
          <div key={w} className="cal-weekday">
            {w}
          </div>
        ))}
      </div>
      <div className="cal-grid">
        {cells.map((cell) => {
          if (cell.day === 0) return <div key={cell.key} className="cal-cell cal-cell-empty" />;
          const evs = eventsByDay.get(cell.key) ?? [];
          const isToday = cell.key === todayKey;
          return (
            <div key={cell.key} className={isToday ? 'cal-cell cal-today' : 'cal-cell'}>
              <div className="cal-daynum">{cell.day}</div>
              <div className="cal-events">
                {evs.slice(0, 3).map((ev, i) => (
                  <button
                    key={i}
                    type="button"
                    className="cal-event"
                    style={{ borderLeftColor: ev.color }}
                    onClick={ev.onClick}
                    title={`${ev.icon} ${ev.label}`}
                  >
                    <span className="cal-event-icon" style={{ color: ev.color }}>
                      {ev.icon}
                    </span>
                    <span className="cal-event-label">{ev.label}</span>
                  </button>
                ))}
                {evs.length > 3 ? <div className="cal-more">+{evs.length - 3} ещё</div> : null}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
