// Канбан-доска писем: столбцы — стадии воронки, карточки — письма.
// Перетаскивание карточки в другой столбец меняет статус письма (только admin).
// Клик по карточке открывает её досье. Получает уже отфильтрованный список писем.

import { useMemo, useState } from 'react';
import { Item, stageColor } from './types';
import { today } from './storage';
import { letterWaitDays } from './attention';

export function Board({
  items,
  stages,
  isAdmin,
  overdueDays,
  onChangeStatus,
  onOpenLetter,
}: {
  items: Item[];
  stages: string[];
  isAdmin: boolean;
  overdueDays: number;
  onChangeStatus: (id: string, status: string) => void;
  onOpenLetter: (id: string, ids?: string[]) => void;
}) {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);
  const todayStr = today();

  // Столбцы: стадии воронки + любые «осиротевшие» статусы из писем (чтобы все были видны).
  const columns = useMemo(() => {
    const orphans = Array.from(
      new Set(items.map((i) => i.status).filter((s) => s && !stages.includes(s))),
    );
    return [...stages, ...orphans];
  }, [items, stages]);

  const allIds = useMemo(() => items.map((i) => i.id), [items]);

  const drop = (status: string) => {
    if (!isAdmin) return;
    if (draggedId) onChangeStatus(draggedId, status);
    setDraggedId(null);
    setOverCol(null);
  };

  if (items.length === 0) {
    return <p className="empty-state">Под выбранные фильтры писем нет.</p>;
  }

  return (
    <div className="kanban-scroll">
      <div className="kanban-board">
        {columns.map((col) => {
          const idx = stages.indexOf(col);
          const color = idx === -1 ? '#9ca3af' : stageColor(idx);
          const cards = items.filter((i) => i.status === col);
          return (
            <section
              key={col}
              className={overCol === col ? 'kanban-col kanban-col-over' : 'kanban-col'}
              onDragOver={(e) => {
                if (!isAdmin) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (overCol !== col) setOverCol(col);
              }}
              onDragLeave={(e) => {
                // только если ушли за пределы столбца, а не на дочерний элемент
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setOverCol((c) => (c === col ? null : c));
              }}
              onDrop={() => drop(col)}
            >
              <header className="kanban-col-head">
                <span className="kanban-col-dot" style={{ background: color }} />
                <span className="kanban-col-title">{col}</span>
                <span className="kanban-col-count">{cards.length}</span>
              </header>
              <div className="kanban-col-body">
                {cards.map((item) => {
                  const wait = letterWaitDays(item);
                  const overdue = wait !== null && !item.replyDate && wait > overdueDays;
                  const nextDue = !!item.nextActionDate && item.nextActionDate <= todayStr;
                  return (
                    <article
                      key={item.id}
                      className={draggedId === item.id ? 'kanban-card dragging' : 'kanban-card'}
                      draggable={isAdmin}
                      onDragStart={(e) => {
                        setDraggedId(item.id);
                        e.dataTransfer.effectAllowed = 'move';
                        e.dataTransfer.setData('text/plain', item.id);
                      }}
                      onDragEnd={() => {
                        setDraggedId(null);
                        setOverCol(null);
                      }}
                      onClick={() => onOpenLetter(item.id, allIds)}
                      title="Открыть карточку письма"
                    >
                      <div className="kanban-card-cp">{item.counterparty.trim() || 'Без контрагента'}</div>
                      <div className="kanban-card-subject">{item.subject || item.topic || 'Без темы'}</div>
                      <div className="kanban-card-meta">
                        <span className={overdue ? 'warn' : undefined}>{wait ?? '—'} дн.</span>
                        {nextDue ? <span className="warn">⏰ шаг</span> : null}
                        {item.replyDate ? <span className="ok">✓</span> : null}
                      </div>
                    </article>
                  );
                })}
                {cards.length === 0 ? <div className="kanban-empty">—</div> : null}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
