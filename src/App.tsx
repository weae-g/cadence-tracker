import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Item, stageColor } from './types';
import { defaultItem, loadItems, loadStages, saveItems, saveStages, withStageChange } from './storage';
import { fetchSession, logout, Session } from './auth';
import { Login } from './Login';
import { Funnel } from './Funnel';
import { Tasks } from './Tasks';
import { Interactions } from './Interactions';
import { Documents, DocCell } from './Documents';
import { removeDocumentsByItem, useDocs, fileIcon, openDocument } from './docs';
import { BarChart, EMPTY_RANGE, KpiRow, Range, RangeFilter, TrendChart, countBy, inRange, isRangeActive, trendFromDates } from './charts';
import { Dashboard } from './Dashboard';
import { GlobalSearch, Section } from './GlobalSearch';

const SECTION_KEY = 'resolve-table-section-v1';
const VIEWMODE_KEY = 'resolve-table-viewmode-v1';

const SECTION_VALUES: Section[] = ['dashboard', 'letters', 'interactions', 'tasks', 'documents'];

// Колонки таблицы писем, по которым доступна сортировка.
type SortKey = 'sentDate' | 'counterparty' | 'status' | 'replyDate' | 'wait';

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
  const [globalQuery, setGlobalQuery] = useState('');
  const [previewRange, setPreviewRange] = useState<Range>(EMPTY_RANGE);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 } | null>(null);
  const [viewMode, setViewMode] = useState<'table' | 'view'>(() => {
    const saved = localStorage.getItem(VIEWMODE_KEY);
    if (saved === 'table' || saved === 'view') return saved;
    return isAdmin ? 'table' : 'view';
  });
  const [section, setSection] = useState<Section>(() => {
    const saved = localStorage.getItem(SECTION_KEY) as Section | null;
    return saved && SECTION_VALUES.includes(saved) ? saved : 'dashboard';
  });
  const [filesBusy, setFilesBusy] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const restoreInputRef = useRef<HTMLInputElement>(null);
  const docs = useDocs();

  useEffect(() => {
    saveItems(items);
  }, [items]);

  useEffect(() => {
    if (stageList.length) saveStages(stageList);
  }, [stageList]);

  // Запоминаем выбранный раздел и режим письма между перезаходами.
  useEffect(() => {
    localStorage.setItem(SECTION_KEY, section);
  }, [section]);

  useEffect(() => {
    localStorage.setItem(VIEWMODE_KEY, viewMode);
  }, [viewMode]);

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

  // Сортировка таблицы (если выбрана колонка). По умолчанию — исходный порядок.
  const sortedItems = useMemo(() => {
    if (!sort) return filteredItems;
    const value = (it: Item): string | number => {
      switch (sort.key) {
        case 'sentDate':
          return it.sentDate || '';
        case 'replyDate':
          return it.replyDate || '';
        case 'counterparty':
          return (it.counterparty || '').toLowerCase();
        case 'status':
          return it.status || '';
        case 'wait':
          return waitingDays(it) ?? -1;
      }
    };
    return [...filteredItems].sort((a, b) => {
      const va = value(a);
      const vb = value(b);
      if (va < vb) return -sort.dir;
      if (va > vb) return sort.dir;
      return 0;
    });
  }, [filteredItems, sort]);

  // Клик по заголовку: по возр. → по убыв. → без сортировки.
  const toggleSort = (key: SortKey) =>
    setSort((prev) => (prev && prev.key === key ? (prev.dir === 1 ? { key, dir: -1 } : null) : { key, dir: 1 }));
  const sortMark = (key: SortKey) => (sort?.key === key ? (sort.dir === 1 ? ' ▲' : ' ▼') : '');

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
    const item = items.find((i) => i.id === id);
    const label = item?.subject || item?.counterparty || 'это письмо';
    if (!window.confirm(`Удалить «${label}»? Вложения письма тоже будут стёрты.`)) return;
    setItems((prev) => prev.filter((it) => it.id !== id));
    removeDocumentsByItem(id); // каскадно стираем вложения письма
  };

  // Модуль экспорта тянет тяжёлый xlsx — грузим его лениво, только по клику.
  const handleExportExcel = async () => {
    const { exportToExcel } = await import('./export');
    exportToExcel(items, stageList);
  };

  const handleExportFiles = async () => {
    setFilesBusy(true);
    try {
      const { exportDocumentFiles } = await import('./export');
      const count = await exportDocumentFiles();
      if (count === 0) window.alert('Документов для выгрузки нет.');
    } finally {
      setFilesBusy(false);
    }
  };

  // Резервная копия: всё в один JSON (включая файлы документов).
  const handleBackup = async () => {
    setBackupBusy(true);
    try {
      const { downloadBackup } = await import('./backup');
      await downloadBackup();
    } catch {
      window.alert('Не удалось создать резервную копию.');
    } finally {
      setBackupBusy(false);
    }
  };

  const handleRestoreFile = async (file: File | undefined) => {
    if (!file) return;
    if (!window.confirm('Восстановление ЗАМЕНИТ все текущие данные на содержимое копии. Продолжить?')) return;
    setBackupBusy(true);
    try {
      const text = await file.text();
      const { restoreBackup } = await import('./backup');
      await restoreBackup(text);
      window.alert('Данные восстановлены. Страница будет перезагружена.');
      window.location.reload();
    } catch (e) {
      window.alert(`Не удалось восстановить: ${e instanceof Error ? e.message : 'неизвестная ошибка'}`);
      setBackupBusy(false);
    }
  };

  const renderPreview = () => {
    if (filteredItems.length === 0) {
      return <p className="empty-state">Здесь пока нет данных.</p>;
    }

    // «Участок»: ограничиваем письма выбранным периодом по дате отправки.
    const rangedItems = isRangeActive(previewRange)
      ? filteredItems.filter((item) => inRange(item.sentDate, previewRange))
      : filteredItems;

    const rangeFilter = <RangeFilter range={previewRange} onChange={setPreviewRange} />;

    if (rangedItems.length === 0) {
      return (
        <>
          {rangeFilter}
          <p className="empty-state">За выбранный период писем нет.</p>
        </>
      );
    }

    const previewCounterparties = Array.from(
      new Set(rangedItems.map((item) => item.counterparty.trim() || 'Без контрагента')),
    );

    // Локальная шкала Ганта — по письмам периода, чтобы диаграмма не «растягивалась» на всё время.
    const previewTimeline = (() => {
      const dates = rangedItems
        .flatMap((item) => [parseDate(item.sentDate), parseDate(item.replyDate)])
        .filter((date): date is Date => date !== null);
      if (dates.length === 0) return null;
      return {
        start: new Date(Math.min(...dates.map((d) => d.getTime()))),
        end: new Date(Math.max(...dates.map((d) => d.getTime()))),
      };
    })();

    const statusBars = stageList
      .map((stage, i) => ({
        label: stage,
        value: rangedItems.filter((item) => item.status === stage).length,
        color: stageColor(i),
      }))
      .filter((b) => b.value > 0);
    const orphanBars = countBy(
      rangedItems.filter((item) => !stageList.includes(item.status)),
      (item) => item.status,
      'Без статуса',
    );
    const sentTrend = trendFromDates(rangedItems.map((item) => item.sentDate));
    const repliedCount = rangedItems.filter((item) => item.replyDate).length;
    const avgWait = (() => {
      const days = rangedItems.map(waitingDays).filter((d): d is number => d !== null);
      return days.length ? Math.round(days.reduce((s, d) => s + d, 0) / days.length) : 0;
    })();

    return (
      <>
        {rangeFilter}

        <KpiRow
          items={[
            { label: 'Писем', value: rangedItems.length },
            { label: 'Контрагентов', value: previewCounterparties.length },
            { label: 'С ответом', value: repliedCount, tone: 'ok' },
            { label: 'Без ответа', value: rangedItems.length - repliedCount, tone: 'warn' },
            { label: 'Ср. ожидание', value: `${avgWait} дн.`, tone: 'accent' },
          ]}
        />

        <div className="charts-grid" style={{ marginBottom: 16 }}>
          <BarChart title="По статусам" data={[...statusBars, ...orphanBars]} />
          <TrendChart title="Отправлено по месяцам" data={sentTrend} color="#3b82f6" />
        </div>

        <div className="company-summary-grid">
          {previewCounterparties.map((counterparty) => {
            const list = rangedItems.filter(
              (item) => (item.counterparty.trim() || 'Без контрагента') === counterparty,
            );
            const topics = Array.from(new Set(list.map((item) => item.topic.trim()).filter(Boolean)));
            const statusList = Array.from(new Set(list.map((item) => item.status)));
            const companyDocs = docs.filter(
              (d) => (d.counterparty.trim() || 'Без контрагента') === counterparty,
            );
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
                {companyDocs.length ? (
                  <div className="company-docs">
                    <span className="company-docs-label">📎 Документы ({companyDocs.length}):</span>
                    {companyDocs.map((doc) => (
                      <button
                        key={doc.id}
                        type="button"
                        className="company-doc-chip"
                        onClick={() => openDocument(doc.id)}
                        title={`${doc.name}${doc.stage ? ` · ${doc.stage}` : ''}`}
                      >
                        {fileIcon(doc)} {doc.name}
                      </button>
                    ))}
                  </div>
                ) : null}
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

        <Funnel items={rangedItems} stages={stageList} />

        <div className="gantt-card">
          <div className="gantt-header">
            <h3>Диаграмма Ганта</h3>
            {previewTimeline ? (
              <span>
                {previewTimeline.start.toLocaleDateString('ru-RU')} — {previewTimeline.end.toLocaleDateString('ru-RU')}
              </span>
            ) : null}
          </div>
          <div className="gantt-chart">
            {previewTimeline ? (
              rangedItems.map((item) => {
                const itemStart = parseDate(item.sentDate) ?? previewTimeline.start;
                const itemEnd = parseDate(item.replyDate) ?? new Date();
                const totalDays = Math.max(
                  1,
                  Math.round((previewTimeline.end.getTime() - previewTimeline.start.getTime()) / ONE_DAY) + 1,
                );
                const offset = Math.max(0, Math.round((itemStart.getTime() - previewTimeline.start.getTime()) / ONE_DAY));
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
      <header className="app-header">
        <div className="topbar">
          <label className="global-search-box">
            <span aria-hidden>🔎</span>
            <input
              value={globalQuery}
              onChange={(e) => setGlobalQuery(e.target.value)}
              placeholder="Искать везде…"
            />
            {globalQuery ? (
              <button type="button" className="gs-clear" onClick={() => setGlobalQuery('')} title="Очистить">
                ✕
              </button>
            ) : null}
          </label>
          <div className="topbar-actions">
            <button type="button" onClick={handleExportExcel} className="clear-button">
              Экспорт в Excel
            </button>
            {isAdmin ? (
              <button type="button" onClick={handleExportFiles} className="clear-button" disabled={filesBusy}>
                {filesBusy ? 'Архив…' : 'Скачать файлы'}
              </button>
            ) : null}
            {isAdmin ? (
              <button type="button" onClick={handleBackup} className="clear-button" disabled={backupBusy}>
                {backupBusy ? 'Копия…' : '💾 Копия'}
              </button>
            ) : null}
            {isAdmin ? (
              <button
                type="button"
                onClick={() => restoreInputRef.current?.click()}
                className="clear-button"
                disabled={backupBusy}
              >
                📂 Восстановить
              </button>
            ) : null}
            <input
              ref={restoreInputRef}
              type="file"
              accept="application/json,.json"
              style={{ display: 'none' }}
              onChange={(e) => {
                handleRestoreFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            <button type="button" onClick={onLogout} className="clear-button">
              Выйти
            </button>
          </div>
        </div>

        <div className="masthead">
          <div>
            <p className="brand">Cadence</p>
            <p className="subtitle">Трекинг писем контрагентам: тематики, статусы ответов, сроки ожидания и воронка.</p>
          </div>
          <div className="nav-actions">
            <div className="mode-switch">
              <button
                type="button"
                className={section === 'dashboard' ? 'toggle-button active' : 'toggle-button'}
                onClick={() => setSection('dashboard')}
              >
                Сводка
              </button>
              <button
                type="button"
                className={section === 'letters' ? 'toggle-button active' : 'toggle-button'}
                onClick={() => setSection('letters')}
              >
                Письма
              </button>
              <button
                type="button"
                className={section === 'interactions' ? 'toggle-button active' : 'toggle-button'}
                onClick={() => setSection('interactions')}
              >
                Взаимодействия
              </button>
              <button
                type="button"
                className={section === 'tasks' ? 'toggle-button active' : 'toggle-button'}
                onClick={() => setSection('tasks')}
              >
                Задачи
              </button>
              <button
                type="button"
                className={section === 'documents' ? 'toggle-button active' : 'toggle-button'}
                onClick={() => setSection('documents')}
              >
                Документы
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
          </div>
        </div>
      </header>

      {globalQuery.trim() ? (
        <GlobalSearch
          query={globalQuery}
          items={items}
          docs={docs}
          onJump={(target) => {
            setSection(target);
            setGlobalQuery('');
          }}
        />
      ) : null}

      {section === 'dashboard' ? <Dashboard items={items} stages={stageList} docs={docs} /> : null}

      {section === 'interactions' ? <Interactions isAdmin={isAdmin} /> : null}

      {section === 'tasks' ? <Tasks isAdmin={isAdmin} /> : null}

      {section === 'documents' ? <Documents items={items} stages={stageList} isAdmin={isAdmin} /> : null}

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
                    <th className="sortable" onClick={() => toggleSort('sentDate')} title="Сортировать">
                      Дата отправки{sortMark('sentDate')}
                    </th>
                    <th className="sortable" onClick={() => toggleSort('counterparty')} title="Сортировать">
                      Контрагент{sortMark('counterparty')}
                    </th>
                    <th>Адресат / контакт</th>
                    <th>Email / канал</th>
                    <th>Тематика</th>
                    <th>Тема письма</th>
                    <th className="sortable" onClick={() => toggleSort('status')} title="Сортировать">
                      Статус ответа{sortMark('status')}
                    </th>
                    <th className="sortable" onClick={() => toggleSort('replyDate')} title="Сортировать">
                      Дата ответа{sortMark('replyDate')}
                    </th>
                    <th className="sortable" onClick={() => toggleSort('wait')} title="Сортировать">
                      Срок, дн.{sortMark('wait')}
                    </th>
                    <th>Кто отвечает</th>
                    <th>Примечание</th>
                    <th>Док-ты</th>
                    {isAdmin ? <th>Удалить</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {sortedItems.map((item, index) => {
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
                        <td className="doc-cell">
                          <DocCell item={item} isAdmin={isAdmin} stages={stageList} />
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

// Авто-выход по бездействию (мин). По истечении пользователя разлогинивает.
const IDLE_LIMIT_MS = 30 * 60 * 1000;
// Период фоновой проверки сессии — ловит истечение токена на сервере.
const SESSION_POLL_MS = 5 * 60 * 1000;

// Гейт авторизации: спрашиваем сервер о текущей сессии (cookie),
// показываем вход или приложение. Авто-выход по простою и по истечении токена.
export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  // Восстановление сессии при загрузке.
  useEffect(() => {
    let alive = true;
    fetchSession().then((s) => {
      if (!alive) return;
      setSession(s);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  const handleLogout = useCallback(async () => {
    await logout();
    setSession(null);
  }, []);

  // Авто-выход: таймер простоя + периодическая проверка живости сессии.
  useEffect(() => {
    if (!session) return;
    let idleTimer = window.setTimeout(handleLogout, IDLE_LIMIT_MS);
    const resetIdle = () => {
      window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(handleLogout, IDLE_LIMIT_MS);
    };
    const activity: string[] = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'];
    activity.forEach((e) => window.addEventListener(e, resetIdle, { passive: true }));

    const poll = window.setInterval(() => {
      fetchSession().then((s) => {
        if (!s) setSession(null); // токен истёк/сессия снята на сервере
      });
    }, SESSION_POLL_MS);

    return () => {
      window.clearTimeout(idleTimer);
      window.clearInterval(poll);
      activity.forEach((e) => window.removeEventListener(e, resetIdle));
    };
  }, [session, handleLogout]);

  if (loading) {
    return (
      <div className="login-page">
        <div className="login-card">
          <p className="brand">Cadence</p>
          <p className="subtitle">Загрузка…</p>
        </div>
      </div>
    );
  }

  if (!session) {
    return <Login onLogin={setSession} />;
  }

  return <AppContent session={session} onLogout={handleLogout} />;
}
