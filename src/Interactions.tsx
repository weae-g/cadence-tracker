import { useEffect, useMemo, useState } from 'react';
import { Interaction, stageColor } from './types';
import {
  defaultInteraction,
  loadInteractions,
  saveInteractions,
  loadInteractionKinds,
  saveInteractionKinds,
} from './storage';
import {
  BarChart,
  EMPTY_RANGE,
  KpiRow,
  Range,
  RangeFilter,
  TrendChart,
  countBy,
  inRange,
  isRangeActive,
  trendFromDates,
} from './charts';

const ADD = '__add__';
const ORPHAN = '__orphan__';

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('ru-RU');
}

// Участники одной строкой → список: делим по запятой / точке с запятой / переносу строки.
function splitParticipants(value: string): string[] {
  return value
    .split(/[,;\n]+/)
    .map((p) => p.trim())
    .filter(Boolean);
}

// Выбор типа из управляемого списка с возможностью завести новый «на лету».
function KindSelect({
  value,
  kinds,
  onChange,
  onAddKind,
  className,
}: {
  value: string;
  kinds: string[];
  onChange: (kind: string) => void;
  onAddKind: (name: string) => void;
  className?: string;
}) {
  const known = kinds.includes(value);
  return (
    <select
      className={className}
      value={known ? value : ORPHAN}
      onChange={(e) => {
        const v = e.target.value;
        if (v === ADD) {
          const name = window.prompt('Новый тип взаимодействия:')?.trim();
          if (name) {
            onAddKind(name);
            onChange(name);
          }
          return;
        }
        if (v === ORPHAN) return;
        onChange(v);
      }}
    >
      {!known && value ? <option value={ORPHAN}>{value} (нет в списке)</option> : null}
      {kinds.map((k) => (
        <option key={k} value={k}>
          {k}
        </option>
      ))}
      <option value={ADD}>＋ Новый тип…</option>
    </select>
  );
}

export function Interactions({ isAdmin }: { isAdmin: boolean }) {
  const [list, setList] = useState<Interaction[]>(() => loadInteractions());
  const [kindList, setKindList] = useState<string[]>(() => loadInteractionKinds());
  const [draft, setDraft] = useState<Interaction>(() => ({ ...defaultInteraction(), kind: loadInteractionKinds()[0] }));
  const [filterKind, setFilterKind] = useState('Все');
  const [search, setSearch] = useState('');
  const [view, setView] = useState<'list' | 'charts'>('list');
  const [range, setRange] = useState<Range>(EMPTY_RANGE);

  useEffect(() => {
    saveInteractions(list);
  }, [list]);

  useEffect(() => {
    if (kindList.length) saveInteractionKinds(kindList);
  }, [kindList]);

  // Для фильтра: управляемый список + любые «осиротевшие» типы из записей.
  const allKinds = useMemo(
    () => Array.from(new Set([...kindList, ...list.map((i) => i.kind).filter(Boolean)])),
    [kindList, list],
  );
  const kindIndex = (kind: string) => {
    const i = kindList.indexOf(kind);
    return i === -1 ? kindList.length : i;
  };

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
      if (isRangeActive(range) && !inRange(i.date, range)) return false;
      if (query) {
        const hay = [i.kind, i.counterparty, i.title, i.participants, i.note].join(' ').toLowerCase();
        if (!hay.includes(query)) return false;
      }
      return true;
    });
  }, [sorted, filterKind, search, range]);

  const add = () => {
    if (!draft.title.trim() && !draft.note.trim()) return;
    setList((prev) => [draft, ...prev]);
    setDraft({ ...defaultInteraction(), kind: kindList[0] });
  };

  const update = (id: string, partial: Partial<Interaction>) => {
    setList((prev) => prev.map((i) => (i.id === id ? { ...i, ...partial } : i)));
  };

  const remove = (id: string) => {
    if (!window.confirm('Удалить эту запись взаимодействия?')) return;
    setList((prev) => prev.filter((i) => i.id !== id));
  };

  // --- управление типами (как стадии воронки) ---

  const addKind = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setKindList((prev) => (prev.includes(trimmed) ? prev : [...prev, trimmed]));
  };

  const renameKind = (index: number, name: string) => {
    const prevName = kindList[index];
    setKindList((prev) => {
      const next = [...prev];
      next[index] = name;
      return next;
    });
    if (prevName !== name) {
      // Каскадно переименовываем во всех записях, чтобы тип не «осиротел».
      setList((prev) => prev.map((i) => (i.kind === prevName ? { ...i, kind: name } : i)));
      setDraft((d) => (d.kind === prevName ? { ...d, kind: name } : d));
    }
  };

  const moveKind = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= kindList.length) return;
    setKindList((prev) => {
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const removeKind = (index: number) => {
    setKindList((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));
  };

  // Аналитика: считаем по записям, попавшим в выбранный период (без даты — не учитываем).
  const analytics = useMemo(() => {
    const inWindow = list.filter((i) => (isRangeActive(range) ? inRange(i.date, range) : true));
    const dated = inWindow.filter((i) => i.date);
    return {
      total: inWindow.length,
      dated: dated.length,
      kinds: countBy(inWindow, (i) => i.kind, 'Без типа'),
      byCompany: countBy(inWindow, (i) => i.counterparty, 'Без контрагента').slice(0, 10),
      trend: trendFromDates(dated.map((i) => i.date)),
    };
  }, [list, range]);

  return (
    <>
      <div className="card tasks-toolbar">
        <div className="mode-switch">
          <button
            type="button"
            className={view === 'list' ? 'toggle-button active' : 'toggle-button'}
            onClick={() => setView('list')}
          >
            Список
          </button>
          <button
            type="button"
            className={view === 'charts' ? 'toggle-button active' : 'toggle-button'}
            onClick={() => setView('charts')}
          >
            Диаграммы
          </button>
        </div>
      </div>

      {view === 'charts' ? (
        <section className="card">
          <h2>Диаграммы взаимодействий</h2>
          <RangeFilter range={range} onChange={setRange} />
          <KpiRow
            items={[
              { label: 'Всего записей', value: analytics.total },
              { label: 'С датой', value: analytics.dated },
              { label: 'Типов', value: analytics.kinds.length, tone: 'accent' },
              { label: 'Контрагентов', value: analytics.byCompany.length },
            ]}
          />
          <div className="charts-grid">
            <BarChart
              title="По типам"
              subtitle={`${analytics.kinds.length} типов`}
              data={analytics.kinds.map((d, i) => ({ ...d, color: stageColor(i) }))}
            />
            <BarChart
              title="По контрагентам"
              subtitle="топ-10"
              data={analytics.byCompany}
              empty="Контрагенты не указаны."
            />
          </div>
          <div className="charts-grid" style={{ marginTop: 16 }}>
            <TrendChart title="Динамика по месяцам" subtitle="записи с датой" data={analytics.trend} color="#6366f1" />
          </div>
        </section>
      ) : (
        <>
          {isAdmin && (
            <details className="card stages-card">
              <summary>
                Типы взаимодействий <span className="stages-count">{kindList.length}</span>
              </summary>
              <p className="hint">
                Список типов редактируется на лету. Переименование меняет тип во всех записях. Цвет метки задаётся
                позицией в списке.
              </p>
              <div className="stage-editor">
                {kindList.map((kind, index) => (
                  <div key={index} className="stage-row">
                    <span className="stage-swatch" style={{ background: stageColor(index) }} />
                    <input value={kind} onChange={(e) => renameKind(index, e.target.value)} placeholder="Название типа" />
                    <button type="button" onClick={() => moveKind(index, -1)} disabled={index === 0} title="Вверх">
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => moveKind(index, 1)}
                      disabled={index === kindList.length - 1}
                      title="Вниз"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="stage-remove"
                      onClick={() => removeKind(index)}
                      disabled={kindList.length <= 1}
                      title="Удалить"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
              <AddKindInline onAdd={addKind} />
            </details>
          )}

          {isAdmin && (
            <section className="card">
              <h2>Новое взаимодействие</h2>
              <div className="form-grid">
                <label>
                  Тип
                  <KindSelect value={draft.kind} kinds={kindList} onChange={(kind) => setDraft({ ...draft, kind })} onAddKind={addKind} />
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
                <label className="full-width">
                  Участники (необязательно)
                  <textarea
                    rows={2}
                    value={draft.participants}
                    onChange={(e) => setDraft({ ...draft, participants: e.target.value })}
                    placeholder="Фамилии через запятую: Иванов И.И., Петров П.П., …"
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
                      {allKinds.map((k) => (
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

            <RangeFilter range={range} onChange={setRange} />

            {filtered.length === 0 ? (
              <p className="empty-state">
                {list.length === 0 ? 'Записей пока нет.' : 'Нет записей под выбранные фильтры.'}
              </p>
            ) : (
              <div className="interaction-list">
                {filtered.map((i) => (
                  <InteractionCard
                    key={i.id}
                    item={i}
                    isAdmin={isAdmin}
                    kinds={kindList}
                    color={stageColor(kindIndex(i.kind))}
                    onUpdate={update}
                    onRemove={remove}
                    onAddKind={addKind}
                  />
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}

// Карточка взаимодействия. По умолчанию — читаемый вид; правка по кнопке «✎ Изменить».
function InteractionCard({
  item,
  isAdmin,
  kinds,
  color,
  onUpdate,
  onRemove,
  onAddKind,
}: {
  item: Interaction;
  isAdmin: boolean;
  kinds: string[];
  color: string;
  onUpdate: (id: string, partial: Partial<Interaction>) => void;
  onRemove: (id: string) => void;
  onAddKind: (name: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const people = splitParticipants(item.participants);

  return (
    <article className="interaction-row" style={{ borderLeftColor: color }}>
      {editing ? (
        <>
          <div className="interaction-edit-head">
            <KindSelect
              className="interaction-kind-select"
              value={item.kind}
              kinds={kinds}
              onChange={(kind) => onUpdate(item.id, { kind })}
              onAddKind={onAddKind}
            />
            <input
              type="date"
              className="interaction-date"
              value={item.date}
              onChange={(e) => onUpdate(item.id, { date: e.target.value })}
            />
          </div>
          <input
            className="interaction-title"
            value={item.title}
            onChange={(e) => onUpdate(item.id, { title: e.target.value })}
            placeholder="Кратко: о чём"
          />
          <div className="interaction-fields">
            <label>
              Контрагент
              <input
                value={item.counterparty}
                onChange={(e) => onUpdate(item.id, { counterparty: e.target.value })}
                placeholder="—"
              />
            </label>
            <label>
              Участники
              <textarea
                rows={2}
                value={item.participants}
                onChange={(e) => onUpdate(item.id, { participants: e.target.value })}
                placeholder="Фамилии через запятую"
              />
            </label>
          </div>
          <textarea
            className="interaction-note"
            rows={2}
            value={item.note}
            onChange={(e) => onUpdate(item.id, { note: e.target.value })}
            placeholder="Примечание"
          />
        </>
      ) : (
        <>
          <div className="interaction-head">
            <span className="interaction-kind-badge" style={{ background: color }}>
              {item.kind || 'Тип не задан'}
            </span>
            <span className={item.date ? 'interaction-date-text' : 'interaction-date-text muted'}>
              {item.date ? formatDate(item.date) : 'без даты'}
            </span>
          </div>
          <h3 className="interaction-title-text">{item.title || 'Без темы'}</h3>
          <div className="interaction-meta">
            <div className="interaction-meta-block">
              <span className="imeta-label">Контрагент</span>
              <span className="imeta-value">{item.counterparty || '—'}</span>
            </div>
            <div className="interaction-meta-block">
              <span className="imeta-label">Участники{people.length > 1 ? ` (${people.length})` : ''}</span>
              {people.length ? (
                <div className="chips">
                  {people.map((p, idx) => (
                    <span key={`${p}-${idx}`} className="chip">
                      {p}
                    </span>
                  ))}
                </div>
              ) : (
                <span className="imeta-value">—</span>
              )}
            </div>
          </div>
          {item.note ? <p className="interaction-note-text">{item.note}</p> : null}
        </>
      )}

      {isAdmin && (
        <div className="interaction-actions">
          {editing ? (
            <button type="button" className="primary-button" onClick={() => setEditing(false)}>
              Готово
            </button>
          ) : (
            <button type="button" className="clear-button" onClick={() => setEditing(true)}>
              ✎ Изменить
            </button>
          )}
          <button type="button" className="delete-button" onClick={() => onRemove(item.id)}>
            Удалить
          </button>
        </div>
      )}
    </article>
  );
}

// Поле быстрого добавления типа внизу редактора.
function AddKindInline({ onAdd }: { onAdd: (name: string) => void }) {
  const [value, setValue] = useState('');
  const submit = () => {
    onAdd(value);
    setValue('');
  };
  return (
    <div className="stage-add">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
        }}
        placeholder="Новый тип (например, «Презентация»)"
      />
      <button type="button" className="primary-button" onClick={submit} disabled={!value.trim()}>
        Добавить тип
      </button>
    </div>
  );
}
