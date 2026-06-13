import { useMemo } from 'react';
import { Item } from './types';
import { loadInteractions, loadTasks } from './storage';
import { DocMeta } from './docs';

export type Section = 'dashboard' | 'letters' | 'interactions' | 'tasks' | 'documents' | 'calendar' | 'help';

type Hit = { id: string; primary: string; secondary: string };

const MAX_PER_GROUP = 6;

// Сквозной поиск по всем разделам. Показывает сгруппированные совпадения;
// клик по группе переводит в соответствующий раздел.
export function GlobalSearch({
  query,
  items,
  docs,
  project,
  onJump,
}: {
  query: string;
  items: Item[];
  docs: DocMeta[];
  project: string;
  onJump: (section: Section) => void;
}) {
  const q = query.trim().toLowerCase();

  const groups = useMemo(() => {
    if (!q) return null;
    const has = (...parts: string[]) => parts.join(' ').toLowerCase().includes(q);
    const inProj = (p: string) => project === '' || p === project;

    const letters: Hit[] = items
      .filter((i) => inProj(i.project) && has(i.counterparty, i.contact, i.channel, i.topic, i.subject, i.owner, i.note, i.status))
      .map((i) => ({
        id: i.id,
        primary: i.subject || i.topic || 'Без темы',
        secondary: `${i.counterparty || 'Без контрагента'} · ${i.status}`,
      }));

    const interactions: Hit[] = loadInteractions()
      .filter((i) => inProj(i.project) && has(i.kind, i.counterparty, i.title, i.participants, i.note))
      .map((i) => ({
        id: i.id,
        primary: i.title || 'Без темы',
        secondary: [i.kind, i.counterparty].filter(Boolean).join(' · ') || '—',
      }));

    const tasks: Hit[] = loadTasks()
      .filter((t) => inProj(t.project) && has(t.title, t.description, t.result, t.counterparty))
      .map((t) => ({
        id: t.id,
        primary: t.title || 'Без названия',
        secondary: [t.counterparty, t.done ? 'Выполнено' : 'В работе'].filter(Boolean).join(' · '),
      }));

    const documents: Hit[] = docs
      .filter((d) => inProj(d.project) && has(d.name, d.counterparty, d.stage, d.note))
      .map((d) => ({
        id: d.id,
        primary: d.name,
        secondary: [d.counterparty, d.stage].filter(Boolean).join(' · ') || '—',
      }));

    return [
      { section: 'letters' as Section, title: 'Письма', hits: letters },
      { section: 'interactions' as Section, title: 'Взаимодействия', hits: interactions },
      { section: 'tasks' as Section, title: 'Задачи', hits: tasks },
      { section: 'documents' as Section, title: 'Документы', hits: documents },
    ].filter((g) => g.hits.length > 0);
  }, [q, items, docs, project]);

  if (!groups) return null;
  const total = groups.reduce((sum, g) => sum + g.hits.length, 0);

  return (
    <section className="card global-search">
      <div className="gs-head">
        <h2>
          Поиск: «{query}»
        </h2>
        <span>{total} совпадений</span>
      </div>

      {total === 0 ? (
        <p className="empty-state">Ничего не найдено.</p>
      ) : (
        <div className="gs-groups">
          {groups.map((g) => (
            <div key={g.section} className="gs-group">
              <button type="button" className="gs-group-head" onClick={() => onJump(g.section)}>
                <strong>{g.title}</strong>
                <span className="stages-count">{g.hits.length}</span>
                <span className="gs-jump">Перейти →</span>
              </button>
              <ul className="gs-list">
                {g.hits.slice(0, MAX_PER_GROUP).map((h) => (
                  <li key={h.id} className="gs-item">
                    <span className="gs-item-primary">{h.primary}</span>
                    <span className="gs-item-secondary">{h.secondary}</span>
                  </li>
                ))}
                {g.hits.length > MAX_PER_GROUP ? (
                  <li className="gs-more">…ещё {g.hits.length - MAX_PER_GROUP}</li>
                ) : null}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
