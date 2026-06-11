import { useEffect, useMemo, useState } from 'react';
import { Interaction, DEFAULT_INTERACTION_KINDS } from './types';
import { defaultInteraction, loadInteractions, saveInteractions } from './storage';

export function Interactions({ isAdmin }: { isAdmin: boolean }) {
  const [list, setList] = useState<Interaction[]>(() => loadInteractions());
  const [draft, setDraft] = useState<Interaction>(() => defaultInteraction());
  const [filterKind, setFilterKind] = useState('Все');
  const [search, setSearch] = useState('');

  useEffect(() => {
    saveInteractions(list);
  }, [list]);

  // Типы для подсказок и фильтра: дефолтные + все встречавшиеся в записях.
  const kinds = useMemo(
    () => Array.from(new Set([...DEFAULT_INTERACTION_KINDS, ...list.map((i) => i.kind).filter(Boolean)])),
    [list],
  );

  // С датой — по убыванию даты; без даты — внизу, по времени создания.
  const sorted = useMemo(
    () =>
      [...list].sort((a, b) => {
        if (a.date && b.date) return b.date.localeCompare(a.date);
        if (a.date) return -1;
        if (b.date) return 1;
        return b.createdAt.localeCompare(a.createdAt);
      }),
    [list],
  );

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return sorted.filter((i) => {
      if (filterKind !== 'Все' && i.kind !== filterKind) return false;
      if (query) {
        const hay = [i.kind, i.counterparty, i.title, i.participants, i.note].join(' ').toLowerCase();
        if (!hay.includes(query)) return false;
      }
      return true;
    });
  }, [sorted, filterKind, search]);

  const add = () => {
    if (!draft.title.trim() && !draft.note.trim()) return;
    setList((prev) => [draft, ...prev]);
    setDraft(defaultInteraction());
  };

  const update = (id: string, partial: Partial<Interaction>) => {
    setList((prev) => prev.map((i) => (i.id === id ? { ...i, ...partial } : i)));
  };

  const remove = (id: string) => setList((prev) => prev.filter((i) => i.id !== id));

  return (
    <>
      <datalist id="interaction-kinds">
        {kinds.map((k) => (
          <option key={k} value={k} />
        ))}
      </datalist>

      {isAdmin && (
        <section className="card">
          <h2>Новое взаимодействие</h2>
          <div className="form-grid">
            <label>
              Тип
              <input
                list="interaction-kinds"
                value={draft.kind}
                onChange={(e) => setDraft({ ...draft, kind: e.target.value })}
                placeholder="Встреча, совещание, эксперимент…"
              />
            </label>
            <label>
              Дата (необязательно)
              <input type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} />
            </label>
            <label>
              Контрагент (необязательно)
              <input
                value={draft.counterparty}
                onChange={(e) => setDraft({ ...draft, counterparty: e.target.value })}
                placeholder="Компания / организация"
              />
            </label>
            <label>
              Кратко: о чём
              <input
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                placeholder="Тема взаимодействия"
              />
            </label>
            <label>
              Участники (необязательно)
              <input
                value={draft.participants}
                onChange={(e) => setDraft({ ...draft, participants: e.target.value })}
                placeholder="Кто участвовал"
              />
            </label>
            <label className="full-width">
              Примечание
              <textarea
                rows={2}
                value={draft.note}
                onChange={(e) => setDraft({ ...draft, note: e.target.value })}
                placeholder="Детали, итоги, договорённости"
              />
            </label>
          </div>
          <div className="actions-row">
            <button type="button" onClick={add} className="primary-button">
              Добавить
            </button>
            <span className="hint">Дата и примечание необязательны. Данные хранятся локально в браузере.</span>
          </div>
        </section>
      )}

      <section className="card">
        <div className="table-header">
          <div>
            <h2>Взаимодействия ({list.length})</h2>
            <div className="table-filters">
              <label>
                Тип
                <select value={filterKind} onChange={(e) => setFilterKind(e.target.value)}>
                  <option value="Все">Все</option>
                  {kinds.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Поиск
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="по тексту…" />
              </label>
            </div>
          </div>
        </div>

        {filtered.length === 0 ? (
          <p className="empty-state">Записей пока нет.</p>
        ) : (
          <fieldset className="task-fieldset" disabled={!isAdmin}>
            <div className="interaction-list">
              {filtered.map((i) => (
                <article key={i.id} className="interaction-row">
                  <div className="interaction-head">
                    <input
                      className="interaction-kind"
                      list="interaction-kinds"
                      value={i.kind}
                      onChange={(e) => update(i.id, { kind: e.target.value })}
                      placeholder="Тип"
                    />
                    <input
                      type="date"
                      className="interaction-date"
                      value={i.date}
                      onChange={(e) => update(i.id, { date: e.target.value })}
                    />
                    {!i.date ? <span className="interaction-nodate">без даты</span> : null}
                  </div>
                  <input
                    className="interaction-title"
                    value={i.title}
                    onChange={(e) => update(i.id, { title: e.target.value })}
                    placeholder="Кратко: о чём"
                  />
                  <div className="interaction-fields">
                    <label>
                      Контрагент
                      <input
                        value={i.counterparty}
                        onChange={(e) => update(i.id, { counterparty: e.target.value })}
                        placeholder="—"
                      />
                    </label>
                    <label>
                      Участники
                      <input
                        value={i.participants}
                        onChange={(e) => update(i.id, { participants: e.target.value })}
                        placeholder="—"
                      />
                    </label>
                  </div>
                  <textarea
                    className="interaction-note"
                    rows={2}
                    value={i.note}
                    onChange={(e) => update(i.id, { note: e.target.value })}
                    placeholder="Примечание"
                  />
                  {isAdmin && (
                    <div className="interaction-actions">
                      <button type="button" className="delete-button" onClick={() => remove(i.id)}>
                        Удалить
                      </button>
                    </div>
                  )}
                </article>
              ))}
            </div>
          </fieldset>
        )}
      </section>
    </>
  );
}
