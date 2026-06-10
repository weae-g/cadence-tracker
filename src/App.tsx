import { useEffect, useMemo, useState } from 'react';
import { Item, stageColor } from './types';
import { defaultItem, loadItems, loadStages, saveItems, saveStages, today, withStageChange } from './storage';
import { clearSession, loadSession, saveSession, Session } from './auth';
import { Login } from './Login';
import { Funnel } from './Funnel';
import { Tasks } from './Tasks';

const ONE_DAY = 24 * 60 * 60 * 1000;

function parseDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatShortDate(value: string) {
  const date = parseDate(value);
  return date ? date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }) : '—';
}

// Срок ожидания, дн. = Дата ответа − Дата отправки (или до сегодня, если ответа нет).
function waitingDays(item: Item): number | null {
  const start = parseDate(item.sentDate);
  if (!start) return null;
  const end = parseDate(item.replyDate) ?? new Date();
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / ONE_DAY));
}

const isEmail = (value: string) => /.+@.+\..+/.test(value.trim());

const ADD = '__add__';
const ORPHAN = '__orphan__';

// Выбор стадии с возможностью завести новую «на лету».
function StatusSelect({
  value,
  stages,
  onChange,
  onAddStage,
  className,
}: {
  value: string;
  stages: string[];
  onChange: (status: string) => void;
  onAddStage: (name: string) => void;
  className?: string;
}) {
  const known = stages.includes(value);
  return (
    <select
      className={className}
      value={known ? value : ORPHAN}
      onChange={(e) => {
        const v = e.target.value;
        if (v === ADD) {
          const name = window.prompt('Название новой стадии:')?.trim();
          if (name) {
            onAddStage(name);
            onChange(name);
          }
          return;
        }
        if (v === ORPHAN) return;
        onChange(v);
      }}
    >
      {!known && value ? <option value={ORPHAN}>{value} (нет в списке)</option> : null}
      {stages.map((stage) => (
        <option key={stage} value={stage}>
          {stage}
        </option>
      ))}
      <option value={ADD}>＋ Новая стадия…</option>
    </select>
  );
}

function AppContent({ session, onLogout }: { session: Session; onLogout: () => void }) {
  const isAdmin = session.role === 'admin';
  const [stageList, setStageList] = useState<string[]>(() => loadStages());
  const [items, setItems] = useState<Item[]>(() => loadItems());
  const [newItem, setNewItem] = useState<Item>(() => defaultItem(loadStages()[0]));
  const [filterStatus, setFilterStatus] = useState('Все');
  const [filterCounterparty, setFilterCounterparty] = useState('Все контрагенты');
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<'table' | 'view'>(isAdmin ? 'table' : 'view');
  const [section, setSection] = useState<'letters' | 'tasks'>('letters');

  useEffect(() => {
    saveItems(items);
  }, [items]);

  useEffect(() => {
    if (stageList.length) saveStages(stageList);
  }, [stageList]);

  const counterparties = useMemo(
    () => [...new Set(items.map((item) => item.counterparty.trim() || 'Без контрагента'))],
    [items],
  );

  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    return items.filter((item) => {
      if (filterStatus !== 'Все' && item.status !== filterStatus) return false;
      if (
        filterCounterparty !== 'Все контрагенты' &&
        (item.counterparty.trim() || 'Без контрагента') !== filterCounterparty
      ) {
        return false;
      }
      if (query) {
        const haystack = [item.counterparty, item.contact, item.channel, item.topic, item.subject, item.owner, item.note]
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
  }, [items, filterStatus, filterCounterparty, search]);

  const statusCounts = useMemo(() => {
    const counts = new Map<string, number>();
    items.forEach((item) => counts.set(item.status, (counts.get(item.status) ?? 0) + 1));
    return counts;
  }, [items]);

  const timelineRange = useMemo(() => {
    const dates = filteredItems
      .flatMap((item) => [parseDate(item.sentDate), parseDate(item.replyDate)])
      .filter((date): date is Date => date !== null);
    if (dates.length === 0) return null;
    const min = new Date(Math.min(...dates.map((date) => date.getTime())));
    const max = new Date(Math.max(...dates.map((date) => date.getTime())));
    return { start: min, end: max };
  }, [filteredItems]);

  // --- управление стадиями ---

  const addStage = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setStageList((prev) => (prev.includes(trimmed) ? prev : [...prev, trimmed]));
  };

  const renameStage = (index: number, name: string) => {
    const prevName = stageList[index];
    setStageList((prev) => {
      const next = [...prev];
      next[index] = name;
      return next;
    });
    if (prevName !== name) {
      // Каскадно переименовываем во всех записях и истории, чтобы данные не «осиротели».
      setItems((prev) =>
        prev.map((item) => ({
          ...item,
          status: item.status === prevName ? name : item.status,
          history: item.history.map((event) => (event.stage === prevName ? { ...event, stage: name } : event)),
        })),
      );
    }
  };

  const moveStage = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= stageList.length) return;
    setStageList((prev) => {
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const removeStage = (index: number) => {
    setStageList((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));
  };

  // --- записи ---

  const addItem = () => {
    if (!newItem.counterparty.trim() && !newItem.subject.trim()) return;
    setItems((prev) => [newItem, ...prev]);
    setNewItem(defaultItem(stageList[0]));
  };

  const addEmptyRow = () => {
    setItems((prev) => [defaultItem(stageList[0]), ...prev]);
  };

  const updateItem = (id: string, partial: Partial<Item>) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...partial } : item)));
  };

  const changeStatus = (id: string, status: string) => {
    setItems((prev) => prev.map((item) => (item.id === id ? withStageChange(item, status) : item)));
  };

  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  };

  const exportJson = () => {
    const payload = { stages: stageList, items };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `resolve-table-${today()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const renderPreview = () => {
    if (filteredItems.length === 0) {
      return <p className="empty-state">Здесь пока нет данных.</p>;
    }

    const previewCounterparties = Array.from(
      new Set(filteredItems.map((item) => item.counterparty.trim() || 'Без контрагента')),
    );

    return (
      <>
        <div className="company-summary-grid">
          {previewCounterparties.map((counterparty) => {
            const list = filteredItems.filter(
              (item) => (item.counterparty.trim() || 'Без контрагента') === counterparty,
            );
            const topics = Array.from(new Set(list.map((item) => item.topic.trim()).filter(Boolean)));
            const statusList = Array.from(new Set(list.map((item) => item.status)));
            return (
              <article key={counterparty} className="company-card">
                <div className="company-header">
                  <strong>{counterparty}</strong>
                  <span>{list.length} писем</span>
                </div>
                <div className="company-mini-meta">
                  <span>Тематики: {topics.length ? topics.join(', ') : '—'}</span>
                  <span>Статусы: {statusList.join(', ')}</span>
                </div>
                <div className="company-items">
                  {list.map((item) => (
                    <div key={item.id} className="company-item-row">
                      <div className="company-item-title">{item.subject || 'Тема не задана'}</div>
                      <div className="company-item-text">{item.topic || 'Тематика не задана'}</div>
                      <div className="company-item-meta">
                        <span>{formatShortDate(item.sentDate)} → {formatShortDate(item.replyDate)}</span>
                        <span>{item.status}</span>
                        <span>{waitingDays(item) ?? '—'} дн.</span>
                        <span>
                          {isEmail(item.channel) ? (
                            <a href={`mailto:${item.channel.trim()}`}>{item.contact || item.channel}</a>
                          ) : (
                            item.contact || item.channel || 'Контакт не задан'
                          )}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </article>
            );
          })}
        </div>

        <Funnel items={filteredItems} stages={stageList} />

        <div className="gantt-card">
          <div className="gantt-header">
            <h3>Диаграмма Ганта</h3>
            {timelineRange ? (
              <span>
                {timelineRange.start.toLocaleDateString('ru-RU')} — {timelineRange.end.toLocaleDateString('ru-RU')}
              </span>
            ) : null}
          </div>
          <div className="gantt-chart">
            {timelineRange ? (
              filteredItems.map((item) => {
                const itemStart = parseDate(item.sentDate) ?? timelineRange.start;
                const itemEnd = parseDate(item.replyDate) ?? new Date();
                const totalDays = Math.max(
                  1,
                  Math.round((timelineRange.end.getTime() - timelineRange.start.getTime()) / ONE_DAY) + 1,
                );
                const offset = Math.max(0, Math.round((itemStart.getTime() - timelineRange.start.getTime()) / ONE_DAY));
                const duration = Math.max(1, Math.round((itemEnd.getTime() - itemStart.getTime()) / ONE_DAY) + 1);
                const left = `${(offset / totalDays) * 100}%`;
                const width = `${(duration / totalDays) * 100}%`;
                return (
                  <div key={item.id} className="gantt-row">
                    <div className="gantt-label">
                      <div>{item.counterparty || 'Без контрагента'}</div>
                      <small>{item.subject}</small>
                    </div>
                    <div className="gantt-bar-track">
                      <div className="gantt-bar" style={{ left, width }}>
                        <span>{formatShortDate(item.sentDate)} — {formatShortDate(item.replyDate)}</span>
                      </div>
                    </div>
                  </div>
                );
              })
            ) : (
              <p className="empty-state">Нет корректных дат для построения диаграммы.</p>
            )}
          </div>
        </div>
      </>
    );
  };

  return (
    <div className="page">
      <header>
        <div>
          <p className="brand">Cadence</p>
          <p className="subtitle">Трекинг писем контрагентам: тематики, статусы ответов, сроки ожидания и воронка.</p>
        </div>
        <div className="header-actions">
          <div className="mode-switch">
            <button
              type="button"
              className={section === 'letters' ? 'toggle-button active' : 'toggle-button'}
              onClick={() => setSection('letters')}
            >
              Письма
            </button>
            <button
              type="button"
              className={section === 'tasks' ? 'toggle-button active' : 'toggle-button'}
              onClick={() => setSection('tasks')}
            >
              Задачи
            </button>
          </div>
          {section === 'letters' ? (
            <div className="mode-switch">
              <button
                type="button"
                className={viewMode === 'table' ? 'toggle-button active' : 'toggle-button'}
                onClick={() => setViewMode('table')}
              >
                Таблица
              </button>
              <button
                type="button"
                className={viewMode === 'view' ? 'toggle-button active' : 'toggle-button'}
                onClick={() => setViewMode('view')}
              >
                Просмотр
              </button>
            </div>
          ) : null}
          {section === 'letters' ? (
            <button type="button" onClick={exportJson} className="clear-button">
              Экспорт
            </button>
          ) : null}
          <span className={isAdmin ? 'role-badge admin' : 'role-badge viewer'}>
            {session.username} · {isAdmin ? 'admin' : 'просмотр'}
          </span>
          <button type="button" onClick={onLogout} className="clear-button">
            Выйти
          </button>
        </div>
      </header>

      {section === 'tasks' ? <Tasks isAdmin={isAdmin} /> : null}

      {section === 'letters' && (
      <>
      {isAdmin && (
      <details className="card stages-card">
        <summary>
          Стадии воронки <span className="stages-count">{stageList.length}</span>
        </summary>
        <p className="hint">
          Порядок задаёт колонки воронки. Переименование меняет стадию во всех записях. Переходы (в т.ч. возвраты назад)
          считаются автоматически по истории.
        </p>
        <div className="stage-editor">
          {stageList.map((stage, index) => (
            <div key={index} className="stage-row">
              <span className="stage-swatch" style={{ background: stageColor(index) }} />
              <input value={stage} onChange={(e) => renameStage(index, e.target.value)} placeholder="Название стадии" />
              <button type="button" onClick={() => moveStage(index, -1)} disabled={index === 0} title="Вверх">
                ↑
              </button>
              <button
                type="button"
                onClick={() => moveStage(index, 1)}
                disabled={index === stageList.length - 1}
                title="Вниз"
              >
                ↓
              </button>
              <button
                type="button"
                className="stage-remove"
                onClick={() => removeStage(index)}
                disabled={stageList.length <= 1}
                title="Удалить"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        <AddStageInline onAdd={addStage} />
      </details>
      )}

      {isAdmin && (
      <section className="card">
        <h2>Добавить письмо</h2>
        <div className="form-grid">
          <label>
            Дата отправки
            <input
              type="date"
              value={newItem.sentDate}
              onChange={(e) => setNewItem({ ...newItem, sentDate: e.target.value })}
            />
          </label>
          <label>
            Контрагент
            <input
              value={newItem.counterparty}
              onChange={(e) => setNewItem({ ...newItem, counterparty: e.target.value })}
              placeholder="Компания / организация"
            />
          </label>
          <label>
            Адресат / контактное лицо
            <input
              value={newItem.contact}
              onChange={(e) => setNewItem({ ...newItem, contact: e.target.value })}
              placeholder="Кому"
            />
          </label>
          <label>
            Email / канал
            <input
              value={newItem.channel}
              onChange={(e) => setNewItem({ ...newItem, channel: e.target.value })}
              placeholder="email или канал связи"
            />
          </label>
          <label>
            Тематика
            <input
              value={newItem.topic}
              onChange={(e) => setNewItem({ ...newItem, topic: e.target.value })}
              placeholder="Запрос информации, КП…"
            />
          </label>
          <label>
            Тема письма
            <input
              value={newItem.subject}
              onChange={(e) => setNewItem({ ...newItem, subject: e.target.value })}
              placeholder="О чём письмо"
            />
          </label>
          <label>
            Статус ответа
            <StatusSelect
              value={newItem.status}
              stages={stageList}
              onChange={(status) => setNewItem({ ...newItem, status })}
              onAddStage={addStage}
            />
          </label>
          <label>
            Дата ответа
            <input
              type="date"
              value={newItem.replyDate}
              onChange={(e) => setNewItem({ ...newItem, replyDate: e.target.value })}
            />
          </label>
          <label>
            Кто отвечает у нас
            <input
              value={newItem.owner}
              onChange={(e) => setNewItem({ ...newItem, owner: e.target.value })}
              placeholder="Ответственный"
            />
          </label>
          <label className="full-width">
            Примечание
            <textarea
              rows={2}
              value={newItem.note}
              onChange={(e) => setNewItem({ ...newItem, note: e.target.value })}
              placeholder="Комментарий"
            />
          </label>
        </div>
        <div className="actions-row">
          <button type="button" onClick={addItem} className="primary-button">
            Добавить письмо
          </button>
          <span className="hint">Срок ожидания считается автоматически. Данные хранятся локально в браузере.</span>
        </div>
      </section>
      )}

      <section className="card">
        <div className="table-header">
          <div>
            <h2>{viewMode === 'view' ? 'Просмотр' : 'Таблица'}</h2>
            <div className="table-filters">
              <label>
                Статус ответа
                <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
                  <option value="Все">Все ({items.length})</option>
                  {stageList.map((stage) => (
                    <option key={stage} value={stage}>
                      {stage} ({statusCounts.get(stage) ?? 0})
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Контрагент
                <select value={filterCounterparty} onChange={(e) => setFilterCounterparty(e.target.value)}>
                  <option value="Все контрагенты">Все контрагенты</option>
                  {counterparties.map((counterparty) => (
                    <option key={counterparty} value={counterparty}>
                      {counterparty}
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
          {viewMode === 'table' && isAdmin ? (
            <button type="button" onClick={addEmptyRow} className="primary-button">
              Добавить строку
            </button>
          ) : null}
        </div>

        {viewMode === 'table' ? (
          filteredItems.length === 0 ? (
            <p className="empty-state">Здесь пока нет данных.</p>
          ) : (
            <div className="table-scroll spreadsheet-table">
              <fieldset className="table-fieldset" disabled={!isAdmin}>
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Дата отправки</th>
                    <th>Контрагент</th>
                    <th>Адресат / контакт</th>
                    <th>Email / канал</th>
                    <th>Тематика</th>
                    <th>Тема письма</th>
                    <th>Статус ответа</th>
                    <th>Дата ответа</th>
                    <th>Срок, дн.</th>
                    <th>Кто отвечает</th>
                    <th>Примечание</th>
                    {isAdmin ? <th>Удалить</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {filteredItems.map((item, index) => {
                    const days = waitingDays(item);
                    const overdue = days !== null && !item.replyDate && days > 14;
                    return (
                      <tr key={item.id}>
                        <td className="row-number">{index + 1}</td>
                        <td>
                          <input
                            className="table-input"
                            type="date"
                            value={item.sentDate}
                            onChange={(e) => updateItem(item.id, { sentDate: e.target.value })}
                          />
                        </td>
                        <td>
                          <input
                            className="table-input"
                            value={item.counterparty}
                            onChange={(e) => updateItem(item.id, { counterparty: e.target.value })}
                            placeholder="Контрагент"
                          />
                        </td>
                        <td>
                          <input
                            className="table-input"
                            value={item.contact}
                            onChange={(e) => updateItem(item.id, { contact: e.target.value })}
                            placeholder="Адресат"
                          />
                        </td>
                        <td>
                          <input
                            className="table-input"
                            value={item.channel}
                            onChange={(e) => updateItem(item.id, { channel: e.target.value })}
                            placeholder="email / канал"
                          />
                        </td>
                        <td>
                          <input
                            className="table-input"
                            value={item.topic}
                            onChange={(e) => updateItem(item.id, { topic: e.target.value })}
                            placeholder="Тематика"
                          />
                        </td>
                        <td>
                          <input
                            className="table-input"
                            value={item.subject}
                            onChange={(e) => updateItem(item.id, { subject: e.target.value })}
                            placeholder="Тема письма"
                          />
                        </td>
                        <td>
                          <StatusSelect
                            className="table-input"
                            value={item.status}
                            stages={stageList}
                            onChange={(status) => changeStatus(item.id, status)}
                            onAddStage={addStage}
                          />
                        </td>
                        <td>
                          <input
                            className="table-input"
                            type="date"
                            value={item.replyDate}
                            onChange={(e) => updateItem(item.id, { replyDate: e.target.value })}
                          />
                        </td>
                        <td className={overdue ? 'days-cell overdue' : 'days-cell'}>{days ?? '—'}</td>
                        <td>
                          <input
                            className="table-input"
                            value={item.owner}
                            onChange={(e) => updateItem(item.id, { owner: e.target.value })}
                            placeholder="Ответственный"
                          />
                        </td>
                        <td>
                          <input
                            className="table-input"
                            value={item.note}
                            onChange={(e) => updateItem(item.id, { note: e.target.value })}
                            placeholder="Примечание"
                          />
                        </td>
                        {isAdmin ? (
                          <td>
                            <button type="button" className="delete-button" onClick={() => removeItem(item.id)}>
                              Удалить
                            </button>
                          </td>
                        ) : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </fieldset>
            </div>
          )
        ) : (
          renderPreview()
        )}
      </section>
      </>
      )}
    </div>
  );
}

// Поле быстрого добавления стадии внизу редактора.
function AddStageInline({ onAdd }: { onAdd: (name: string) => void }) {
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
        placeholder="Новая стадия (например, «Уточнение»)"
      />
      <button type="button" className="primary-button" onClick={submit} disabled={!value.trim()}>
        Добавить стадию
      </button>
    </div>
  );
}

// Гейт авторизации: без сессии показываем экран входа, иначе — приложение с ролью.
export default function App() {
  const [session, setSession] = useState<Session | null>(() => loadSession());

  if (!session) {
    return (
      <Login
        onLogin={(s) => {
          saveSession(s);
          setSession(s);
        }}
      />
    );
  }

  return (
    <AppContent
      session={session}
      onLogout={() => {
        clearSession();
        setSession(null);
      }}
    />
  );
}
