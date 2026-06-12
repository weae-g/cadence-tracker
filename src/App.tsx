import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Item, stageColor } from './types';
import {
  defaultItem,
  loadItems,
  loadProjects,
  loadProjectMeta,
  loadStages,
  loadTasks,
  loadInteractions,
  saveItems,
  saveProjects,
  saveProjectMeta,
  saveStages,
  saveTasks,
  saveInteractions,
  withStageChange,
  ProjectMeta,
} from './storage';
import { fetchSession, logout, Session } from './auth';
import { Login } from './Login';
import { Funnel } from './Funnel';
import { Tasks } from './Tasks';
import { Interactions } from './Interactions';
import { Documents, DocCell } from './Documents';
import { removeDocumentsByItem, useDocs, fileIcon, openDocument, getDocs, updateDocument } from './docs';
import { BarChart, EMPTY_RANGE, GanttChart, GanttRow, KpiRow, Range, RangeFilter, Sankey, SankeyLink, TrendChart, countBy, inRange, isRangeActive, trendFromDates } from './charts';
import { Dashboard } from './Dashboard';
import { GlobalSearch, Section } from './GlobalSearch';
import { applyBackupData, createBackup } from './backup';
import { dataSignature, fetchStore, pushStore } from './sync';
import { AccountDialog } from './AccountDialog';
import { Help } from './Help';

const SECTION_KEY = 'resolve-table-section-v1';
const VIEWMODE_KEY = 'resolve-table-viewmode-v1';
const ACTIVE_PROJECT_KEY = 'resolve-table-active-project-v1';
const OVERDUE_DAYS_KEY = 'resolve-table-overdue-days-v1';
const HIDDEN_CHARTS_KEY = 'resolve-table-hidden-charts-v1';
const PRESETS_KEY = 'resolve-table-presets-v1';
const DENSE_KEY = 'resolve-table-dense-v1';

// Кнопка «Наверх»: появляется после прокрутки, плавно возвращает к началу.
function BackToTop() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > 400);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  if (!show) return null;
  return (
    <button
      type="button"
      className="back-to-top"
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      title="Наверх"
    >
      ↑
    </button>
  );
}

type FilterPreset = { id: string; name: string; status: string; counterparty: string; search: string };

// Меню пресетов фильтров: применить сохранённый / сохранить текущие / удалить.
function PresetsMenu({
  presets,
  onApply,
  onSave,
  onDelete,
}: {
  presets: FilterPreset[];
  onApply: (p: FilterPreset) => void;
  onSave: (name: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <details className="columns-menu">
      <summary className="clear-button">Пресеты{presets.length ? ` (${presets.length})` : ''}</summary>
      <div className="columns-popover preset-popover">
        {presets.length === 0 ? <p className="hint">Сохранённых пресетов нет.</p> : null}
        {presets.map((p) => (
          <div key={p.id} className="preset-row">
            <button type="button" className="preset-apply" onClick={() => onApply(p)} title="Применить">
              {p.name}
            </button>
            <button type="button" className="preset-del" onClick={() => onDelete(p.id)} title="Удалить">
              ✕
            </button>
          </div>
        ))}
        <button
          type="button"
          className="clear-button"
          onClick={() => {
            const name = window.prompt('Название пресета:')?.trim();
            if (name) onSave(name);
          }}
        >
          ＋ Сохранить текущие фильтры
        </button>
      </div>
    </details>
  );
}

const PREVIEW_CHARTS: { key: string; label: string }[] = [
  { key: 'status', label: 'По статусам' },
  { key: 'sentTrend', label: 'Отправлено по месяцам' },
  { key: 'cycle', label: 'Время ответа' },
  { key: 'funnel', label: 'Воронка переходов' },
  { key: 'sankey', label: 'Sankey (поток)' },
  { key: 'gantt', label: 'Диаграмма Ганта' },
];

// Меню видимости диаграмм (как «Колонки»): галочка = показать.
function ChartsMenu({
  charts,
  hidden,
  onToggle,
}: {
  charts: { key: string; label: string }[];
  hidden: Set<string>;
  onToggle: (key: string) => void;
}) {
  const off = charts.filter((c) => hidden.has(c.key)).length;
  return (
    <details className="columns-menu">
      <summary className="clear-button">Диаграммы{off ? ` (−${off})` : ''}</summary>
      <div className="columns-popover">
        {charts.map((c) => (
          <label key={c.key} className="columns-item">
            <input type="checkbox" checked={!hidden.has(c.key)} onChange={() => onToggle(c.key)} />
            {c.label}
          </label>
        ))}
      </div>
    </details>
  );
}

const ADD_PROJECT = '__add_project__';

// Компактный выбор проекта: всё / конкретный / завести новый «на лету».
function ProjectSelect({
  active,
  projects,
  meta,
  onSelect,
  onAdd,
}: {
  active: string;
  projects: string[];
  meta: ProjectMeta;
  onSelect: (project: string) => void;
  onAdd: (name: string) => void;
}) {
  const activeColor = active ? meta[active]?.color : undefined;
  return (
    <label className="project-select">
      <span className="project-select-dot" style={{ background: activeColor || '#cbd5e1' }} />
      <span className="project-select-label">Проект</span>
      <select
        value={active}
        onChange={(e) => {
          const v = e.target.value;
          if (v === ADD_PROJECT) {
            const name = window.prompt('Название проекта:')?.trim();
            if (name) onAdd(name);
            return;
          }
          onSelect(v);
        }}
      >
        <option value="">Все проекты</option>
        {projects.map((p) => (
          <option key={p} value={p}>
            {meta[p]?.icon ? `${meta[p]?.icon} ${p}` : p}
          </option>
        ))}
        <option value={ADD_PROJECT}>＋ Новый проект…</option>
      </select>
    </label>
  );
}

const SECTION_VALUES: Section[] = ['dashboard', 'letters', 'interactions', 'tasks', 'documents', 'help'];

// Колонки таблицы писем, по которым доступна сортировка.
type SortKey = 'sentDate' | 'counterparty' | 'status' | 'replyDate' | 'wait';

// Управляемые (скрываемые) колонки таблицы писем. «#» и «Удалить» — всегда видны.
// off: true — колонка по умолчанию скрыта (показывается через меню «Колонки»).
const LETTER_COLUMNS: { key: string; label: string; off?: boolean }[] = [
  { key: 'sentDate', label: 'Дата отправки' },
  { key: 'counterparty', label: 'Контрагент' },
  { key: 'contact', label: 'Адресат / контакт' },
  { key: 'channel', label: 'Email / канал' },
  { key: 'topic', label: 'Тематика' },
  { key: 'subject', label: 'Тема письма' },
  { key: 'status', label: 'Статус ответа' },
  { key: 'replyDate', label: 'Дата ответа' },
  { key: 'wait', label: 'Срок, дн.' },
  { key: 'owner', label: 'Кто отвечает' },
  { key: 'note', label: 'Примечание' },
  { key: 'docs', label: 'Док-ты' },
  { key: 'project', label: 'Проект', off: true },
];
const COLS_KEY = 'resolve-table-cols-v1';

function loadCols(): Record<string, boolean> {
  let saved: Record<string, unknown> | null = null;
  try {
    saved = JSON.parse(localStorage.getItem(COLS_KEY) || 'null');
  } catch {
    saved = null;
  }
  const base: Record<string, boolean> = {};
  LETTER_COLUMNS.forEach((c) => {
    base[c.key] = saved && typeof saved[c.key] === 'boolean' ? (saved[c.key] as boolean) : !c.off;
  });
  return base;
}

// Меню «Колонки»: чекбоксы видимости столбцов таблицы.
function ColumnsMenu({
  cols,
  onToggle,
  onReset,
}: {
  cols: Record<string, boolean>;
  onToggle: (key: string) => void;
  onReset: () => void;
}) {
  const hidden = LETTER_COLUMNS.filter((c) => !cols[c.key]).length;
  return (
    <details className="columns-menu">
      <summary className="clear-button">Колонки{hidden ? ` (−${hidden})` : ''}</summary>
      <div className="columns-popover">
        {LETTER_COLUMNS.map((c) => (
          <label key={c.key} className="columns-item">
            <input type="checkbox" checked={cols[c.key]} onChange={() => onToggle(c.key)} />
            {c.label}
          </label>
        ))}
        <button type="button" className="clear-button columns-reset" onClick={onReset}>
          Показать все
        </button>
      </div>
    </details>
  );
}

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

// Дружелюбное «пусто»: иконка + текст + (необязательно) кнопка действия.
function EmptyState({
  icon,
  text,
  actionLabel,
  onAction,
}: {
  icon: string;
  text: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="empty-box">
      <div className="empty-icon" aria-hidden>
        {icon}
      </div>
      <p>{text}</p>
      {actionLabel && onAction ? (
        <button type="button" className="primary-button" onClick={onAction}>
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}

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

// Боковая панель редактирования письма — удобная альтернатива широкой строке.
function LetterDrawer({
  item,
  stages,
  projects,
  isAdmin,
  onUpdate,
  onChangeStatus,
  onAddStage,
  onRemove,
  onClose,
}: {
  item: Item;
  stages: string[];
  projects: string[];
  isAdmin: boolean;
  onUpdate: (id: string, partial: Partial<Item>) => void;
  onChangeStatus: (id: string, status: string) => void;
  onAddStage: (name: string) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const days = waitingDays(item);
  const set = (partial: Partial<Item>) => onUpdate(item.id, partial);

  return createPortal(
    <div className="drawer-overlay" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <div>
            <h3>{item.subject || item.counterparty || 'Письмо'}</h3>
            <p className="hint">Срок ожидания: {days ?? '—'} дн.</p>
          </div>
          <button type="button" className="doc-close" onClick={onClose} title="Закрыть (Esc)">
            ✕
          </button>
        </div>

        <fieldset className="drawer-body form-grid" disabled={!isAdmin}>
          <label>
            Дата отправки
            <input type="date" value={item.sentDate} onChange={(e) => set({ sentDate: e.target.value })} />
          </label>
          <label>
            Контрагент
            <input value={item.counterparty} onChange={(e) => set({ counterparty: e.target.value })} placeholder="Компания" />
          </label>
          <label>
            Адресат / контакт
            <input value={item.contact} onChange={(e) => set({ contact: e.target.value })} placeholder="Кому" />
          </label>
          <label>
            Email / канал
            <input value={item.channel} onChange={(e) => set({ channel: e.target.value })} placeholder="email / канал" />
          </label>
          <label>
            Тематика
            <input value={item.topic} onChange={(e) => set({ topic: e.target.value })} placeholder="Тематика" />
          </label>
          <label>
            Тема письма
            <input value={item.subject} onChange={(e) => set({ subject: e.target.value })} placeholder="О чём" />
          </label>
          <label>
            Статус ответа
            <StatusSelect
              value={item.status}
              stages={stages}
              onChange={(status) => onChangeStatus(item.id, status)}
              onAddStage={onAddStage}
            />
          </label>
          <label>
            Дата ответа
            <input type="date" value={item.replyDate} onChange={(e) => set({ replyDate: e.target.value })} />
          </label>
          <label>
            Кто отвечает
            <input value={item.owner} onChange={(e) => set({ owner: e.target.value })} placeholder="Ответственный" />
          </label>
          <label>
            Проект
            <select value={item.project} onChange={(e) => set({ project: e.target.value })}>
              <option value="">(без проекта)</option>
              {projects.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <label className="full-width">
            Примечание
            <textarea rows={3} value={item.note} onChange={(e) => set({ note: e.target.value })} placeholder="Комментарий" />
          </label>
        </fieldset>

        <div className="drawer-section">
          <h4>Документы</h4>
          <DocCell item={item} isAdmin={isAdmin} stages={stages} />
        </div>

        {isAdmin ? (
          <div className="drawer-actions">
            <button
              type="button"
              className="delete-button"
              onClick={() => {
                onRemove(item.id);
                onClose();
              }}
            >
              Удалить письмо
            </button>
          </div>
        ) : null}
      </aside>
    </div>,
    document.body,
  );
}

function AppContent({ session, onLogout }: { session: Session; onLogout: () => void }) {
  const isAdmin = session.role === 'admin';
  const [stageList, setStageList] = useState<string[]>(() => loadStages());
  const [items, setItems] = useState<Item[]>(() => loadItems());
  const [projectList, setProjectList] = useState<string[]>(() => loadProjects());
  const [projectMeta, setProjectMeta] = useState<ProjectMeta>(() => loadProjectMeta());
  const [activeProject, setActiveProject] = useState<string>(() => localStorage.getItem(ACTIVE_PROJECT_KEY) || '');
  const [newItem, setNewItem] = useState<Item>(() => defaultItem(loadStages()[0]));
  const [filterStatus, setFilterStatus] = useState('Все');
  const [filterCounterparty, setFilterCounterparty] = useState('Все контрагенты');
  const [search, setSearch] = useState('');
  const [globalQuery, setGlobalQuery] = useState('');
  const [previewRange, setPreviewRange] = useState<Range>(EMPTY_RANGE);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 } | null>(null);
  const [cols, setCols] = useState<Record<string, boolean>>(() => loadCols());
  const [sankeyDim, setSankeyDim] = useState<'topic' | 'counterparty' | 'project'>('topic');
  const [overdueDays, setOverdueDays] = useState<number>(() => {
    const n = Number(localStorage.getItem(OVERDUE_DAYS_KEY));
    return Number.isFinite(n) && n > 0 ? n : 14;
  });
  const [hiddenCharts, setHiddenCharts] = useState<Set<string>>(() => {
    try {
      const a = JSON.parse(localStorage.getItem(HIDDEN_CHARTS_KEY) || '[]');
      return new Set<string>(Array.isArray(a) ? a : []);
    } catch {
      return new Set<string>();
    }
  });
  const [presets, setPresets] = useState<FilterPreset[]>(() => {
    try {
      const a = JSON.parse(localStorage.getItem(PRESETS_KEY) || '[]');
      return Array.isArray(a) ? a : [];
    } catch {
      return [];
    }
  });
  const [dense, setDense] = useState<boolean>(() => localStorage.getItem(DENSE_KEY) === '1');
  const firstRowRef = useRef<HTMLTableRowElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [rowH, setRowH] = useState(44);
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
  const [accountOpen, setAccountOpen] = useState(false);
  const [editItemId, setEditItemId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [toasts, setToasts] = useState<{ id: string; message: string; onUndo: () => void; onClose: () => void }[]>([]);
  const restoreInputRef = useRef<HTMLInputElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const toastTimers = useRef<Map<string, number>>(new Map());
  const docs = useDocs();

  // Тост с «Отменить»: через 6 c (или по ✕) изменение фиксируется (onCommit).
  const showUndoToast = (message: string, onUndo: () => void, onCommit: () => void) => {
    const id = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    const finalize = (undo: boolean) => {
      const timer = toastTimers.current.get(id);
      if (timer) window.clearTimeout(timer);
      toastTimers.current.delete(id);
      if (undo) onUndo();
      else onCommit();
      setToasts((prev) => prev.filter((t) => t.id !== id));
    };
    toastTimers.current.set(id, window.setTimeout(() => finalize(false), 6000));
    setToasts((prev) => [...prev, { id, message, onUndo: () => finalize(true), onClose: () => finalize(false) }]);
  };

  useEffect(() => {
    saveItems(items);
  }, [items]);

  useEffect(() => {
    if (stageList.length) saveStages(stageList);
  }, [stageList]);

  useEffect(() => {
    saveProjects(projectList);
  }, [projectList]);

  useEffect(() => {
    saveProjectMeta(projectMeta);
  }, [projectMeta]);

  useEffect(() => {
    localStorage.setItem(ACTIVE_PROJECT_KEY, activeProject);
  }, [activeProject]);

  // Если активный проект заархивировали — возвращаемся к «Все проекты».
  useEffect(() => {
    if (activeProject && projectMeta[activeProject]?.archived) setActiveProject('');
  }, [activeProject, projectMeta]);

  const setProjectMetaField = (name: string, patch: { color?: string; icon?: string; archived?: boolean }) =>
    setProjectMeta((prev) => ({ ...prev, [name]: { ...prev[name], ...patch } }));
  const toggleArchiveProject = (name: string) =>
    setProjectMetaField(name, { archived: !projectMeta[name]?.archived });

  // Список проектов для селектора: сохранённые + встречающиеся в письмах/документах.
  const allProjects = useMemo(() => {
    const set = new Set<string>(projectList);
    items.forEach((i) => i.project && set.add(i.project));
    docs.forEach((d) => d.project && set.add(d.project));
    return [...set].sort((a, b) => a.localeCompare(b, 'ru'));
  }, [projectList, items, docs]);
  // Для шапки — без архивных.
  const selectorProjects = useMemo(
    () => allProjects.filter((p) => !projectMeta[p]?.archived),
    [allProjects, projectMeta],
  );

  const addProject = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setProjectList((prev) => (prev.includes(trimmed) ? prev : [...prev, trimmed]));
    setActiveProject(trimmed);
  };

  // Переименование/удаление проекта меняют данные во всех разделах. Пишем напрямую
  // в хранилище, отправляем на сервер и перезагружаем — так состояние всех компонентов
  // (письма/задачи/взаимодействия/документы) гарантированно подхватит изменения.
  const cascadeProject = async (mutate: { from: string; to: string }) => {
    const { from, to } = mutate;
    saveItems(loadItems().map((i) => (i.project === from ? { ...i, project: to } : i)));
    saveTasks(loadTasks().map((t) => (t.project === from ? { ...t, project: to } : t)));
    saveInteractions(loadInteractions().map((i) => (i.project === from ? { ...i, project: to } : i)));
    getDocs().forEach((d) => {
      if (d.project === from) updateDocument(d.id, { project: to });
    });
    if (localStorage.getItem(ACTIVE_PROJECT_KEY) === from) localStorage.setItem(ACTIVE_PROJECT_KEY, to);
    try {
      await pushStore(await createBackup());
    } catch {
      /* локально уже сохранено */
    }
    window.location.reload();
  };

  const renameProject = async (from: string, to: string) => {
    const target = to.trim();
    if (!target || target === from) return;
    saveProjects([...new Set(loadProjects().map((p) => (p === from ? target : p)))]);
    await cascadeProject({ from, to: target });
  };

  const deleteProject = async (name: string) => {
    saveProjects(loadProjects().filter((p) => p !== name));
    await cascadeProject({ from: name, to: '' }); // записи проекта становятся «без проекта»
  };

  // Запись принадлежит активному проекту? (при «Все проекты» — да).
  const inProject = (p: string) => activeProject === '' || p === activeProject;

  // Запоминаем выбранный раздел и режим письма между перезаходами.
  useEffect(() => {
    localStorage.setItem(SECTION_KEY, section);
  }, [section]);

  useEffect(() => {
    localStorage.setItem(VIEWMODE_KEY, viewMode);
  }, [viewMode]);

  useEffect(() => {
    localStorage.setItem(COLS_KEY, JSON.stringify(cols));
  }, [cols]);

  useEffect(() => {
    localStorage.setItem(OVERDUE_DAYS_KEY, String(overdueDays));
  }, [overdueDays]);

  useEffect(() => {
    localStorage.setItem(HIDDEN_CHARTS_KEY, JSON.stringify([...hiddenCharts]));
  }, [hiddenCharts]);

  const toggleChart = (key: string) =>
    setHiddenCharts((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const showChart = (key: string) => !hiddenCharts.has(key);

  useEffect(() => {
    localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
  }, [presets]);

  useEffect(() => {
    localStorage.setItem(DENSE_KEY, dense ? '1' : '0');
  }, [dense]);

  const savePreset = (name: string) =>
    setPresets((prev) => [
      ...prev,
      { id: `${Date.now()}-${Math.round(Math.random() * 1e6)}`, name, status: filterStatus, counterparty: filterCounterparty, search },
    ]);
  const applyPreset = (p: FilterPreset) => {
    setFilterStatus(p.status);
    setFilterCounterparty(p.counterparty);
    setSearch(p.search);
  };
  const deletePreset = (id: string) => setPresets((prev) => prev.filter((p) => p.id !== id));

  const toggleCol = (key: string) => setCols((prev) => ({ ...prev, [key]: !prev[key] }));
  const resetCols = () => {
    const all: Record<string, boolean> = {};
    LETTER_COLUMNS.forEach((c) => (all[c.key] = true));
    setCols(all);
  };

  const counterparties = useMemo(
    () => [...new Set(items.map((item) => item.counterparty.trim() || 'Без контрагента'))],
    [items],
  );

  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    return items.filter((item) => {
      if (activeProject !== '' && item.project !== activeProject) return false;
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
  }, [items, filterStatus, filterCounterparty, search, activeProject]);

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

  // Виртуализация таблицы: рендерим только видимое окно строк (для длинных списков).
  const VIRTUAL_THRESHOLD = 80;
  const VIEWPORT_H = 600;
  const OVERSCAN = 8;
  const virtualTable = viewMode === 'table' && sortedItems.length > VIRTUAL_THRESHOLD;
  const visibleRows = Math.max(1, Math.ceil(VIEWPORT_H / rowH));
  const winStart = virtualTable ? Math.max(0, Math.floor(scrollTop / rowH) - OVERSCAN) : 0;
  const winEnd = virtualTable
    ? Math.min(sortedItems.length, winStart + visibleRows + OVERSCAN * 2)
    : sortedItems.length;
  const windowItems = virtualTable ? sortedItems.slice(winStart, winEnd) : sortedItems;
  const padTop = winStart * rowH;
  const padBottom = (sortedItems.length - winEnd) * rowH;
  const colCount = (isAdmin ? 1 : 0) + 1 + LETTER_COLUMNS.filter((c) => cols[c.key]).length + (isAdmin ? 1 : 0);
  const allVisibleSelected = sortedItems.length > 0 && sortedItems.every((it) => selected.has(it.id));
  const toggleSelectAll = () =>
    setSelected((prev) => {
      if (sortedItems.every((it) => prev.has(it.id))) {
        const next = new Set(prev);
        sortedItems.forEach((it) => next.delete(it.id));
        return next;
      }
      return new Set([...prev, ...sortedItems.map((it) => it.id)]);
    });

  // Подстраиваем высоту строки под фактическую (чтобы прокрутка не «уплывала»).
  useEffect(() => {
    if (virtualTable && firstRowRef.current) {
      const h = firstRowRef.current.offsetHeight;
      if (h && Math.abs(h - rowH) > 0.5) setRowH(h);
    }
  });

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
    setItems((prev) => [{ ...newItem, project: activeProject }, ...prev]);
    setNewItem(defaultItem(stageList[0]));
  };

  const addEmptyRow = () => {
    setItems((prev) => [defaultItem(stageList[0], activeProject), ...prev]);
  };

  const updateItem = (id: string, partial: Partial<Item>) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...partial } : item)));
  };

  const changeStatus = (id: string, status: string) => {
    setItems((prev) => prev.map((item) => (item.id === id ? withStageChange(item, status) : item)));
  };

  // Удаление с возможностью отмены: письма убираем из списка сразу, а вложения
  // стираем только когда отмена уже невозможна (по таймауту тоста).
  const removeItems = (ids: string[]) => {
    const removed = items
      .map((it, index) => ({ it, index }))
      .filter(({ it }) => ids.includes(it.id));
    if (removed.length === 0) return;
    setItems((prev) => prev.filter((it) => !ids.includes(it.id)));
    setSelected(new Set());
    const label =
      removed.length === 1 ? `«${removed[0].it.subject || removed[0].it.counterparty || 'письмо'}»` : `писем: ${removed.length}`;
    showUndoToast(
      `Удалено ${label}`,
      () =>
        setItems((prev) => {
          const next = [...prev];
          // возвращаем на исходные позиции (по возрастанию индекса)
          [...removed].sort((a, b) => a.index - b.index).forEach(({ it, index }) => next.splice(Math.min(index, next.length), 0, it));
          return next;
        }),
      () => removed.forEach(({ it }) => removeDocumentsByItem(it.id)),
    );
  };

  const removeItem = (id: string) => removeItems([id]);

  // Импорт писем из CSV/Excel (массовое заполнение), с возможностью отмены.
  const handleImportFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const { importLettersFromFile } = await import('./importLetters');
      const imported = await importLettersFromFile(file);
      if (imported.length === 0) {
        window.alert('В файле не найдено писем. Проверьте, что есть строка заголовков (Контрагент, Тема письма, Дата отправки и т.д.).');
        return;
      }
      const tagged = imported.map((it) => (it.project ? it : { ...it, project: activeProject }));
      const ids = new Set(tagged.map((t) => t.id));
      setItems((prev) => [...tagged, ...prev]);
      showUndoToast(
        `Импортировано писем: ${tagged.length}`,
        () => setItems((prev) => prev.filter((p) => !ids.has(p.id))),
        () => {},
      );
    } catch {
      window.alert('Не удалось прочитать файл.');
    }
  };

  // --- массовые действия над выделенными письмами ---
  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const bulkChangeStatus = (status: string) => {
    setItems((prev) => prev.map((it) => (selected.has(it.id) ? withStageChange(it, status) : it)));
    setSelected(new Set());
  };
  const bulkChangeProject = (proj: string) => {
    setItems((prev) => prev.map((it) => (selected.has(it.id) ? { ...it, project: proj } : it)));
    setSelected(new Set());
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
      // Делаем восстановленные данные авторитетными и на сервере,
      // иначе после перезагрузки серверный снимок их перезапишет.
      try {
        await pushStore(await createBackup());
      } catch {
        /* не критично — локально уже восстановлено */
      }
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

    // Sankey: выбранный разрез → Статус.
    const sankeyDimLabel = { topic: 'Тематика', counterparty: 'Контрагент', project: 'Проект' }[sankeyDim];
    const sankeySource = (item: Item) =>
      sankeyDim === 'topic'
        ? item.topic.trim() || 'Без тематики'
        : sankeyDim === 'counterparty'
          ? item.counterparty.trim() || 'Без контрагента'
          : item.project || 'Без проекта';
    const sankeyMap = new Map<string, number>();
    rangedItems.forEach((item) => {
      const key = `${sankeySource(item)}|${item.status}`;
      sankeyMap.set(key, (sankeyMap.get(key) ?? 0) + 1);
    });
    const sankeyLinks: SankeyLink[] = [...sankeyMap.entries()].map(([k, value]) => {
      const [source, target] = k.split('|');
      return { source, target, value };
    });

    const repliedCount = rangedItems.filter((item) => item.replyDate).length;
    const avgWait = (() => {
      const days = rangedItems.map(waitingDays).filter((d): d is number => d !== null);
      return days.length ? Math.round(days.reduce((s, d) => s + d, 0) / days.length) : 0;
    })();

    // Время цикла письма: replyDate − sentDate (только по отвеченным).
    const cycleDays = rangedItems
      .map((item) => {
        const s = parseDate(item.sentDate);
        const r = parseDate(item.replyDate);
        return s && r ? Math.max(0, Math.round((r.getTime() - s.getTime()) / ONE_DAY)) : null;
      })
      .filter((d): d is number => d !== null);
    const avgCycle = cycleDays.length ? Math.round(cycleDays.reduce((s, d) => s + d, 0) / cycleDays.length) : 0;
    const cycleBuckets = [
      { label: '0–3 дн', test: (d: number) => d <= 3, color: '#10b981' },
      { label: '4–7 дн', test: (d: number) => d > 3 && d <= 7, color: '#3b82f6' },
      { label: '8–14 дн', test: (d: number) => d > 7 && d <= 14, color: '#eab308' },
      { label: '15–30 дн', test: (d: number) => d > 14 && d <= 30, color: '#f97316' },
      { label: '30+ дн', test: (d: number) => d > 30, color: '#ef4444' },
    ].map((b) => ({ label: b.label, value: cycleDays.filter(b.test).length, color: b.color }));

    // Гант писем на общем компоненте: отправка → ответ (или до сегодня).
    const letterGantt: GanttRow[] = rangedItems
      .map((item): GanttRow | null => {
        const start = parseDate(item.sentDate);
        if (!start) return null;
        const end = parseDate(item.replyDate) ?? new Date();
        const days = waitingDays(item);
        const overdue = !item.replyDate && days !== null && days > overdueDays;
        const color = item.replyDate ? '#10b981' : overdue ? '#ef4444' : '#3b82f6';
        return {
          id: item.id,
          label: item.counterparty || 'Без контрагента',
          sub: item.subject || item.topic || undefined,
          start,
          end: end >= start ? end : start,
          color,
        };
      })
      .filter((r): r is GanttRow => r !== null);

    return (
      <>
        <div className="preview-toolbar">
          {rangeFilter}
          <ChartsMenu charts={PREVIEW_CHARTS} hidden={hiddenCharts} onToggle={toggleChart} />
        </div>

        <KpiRow
          items={[
            { label: 'Писем', value: rangedItems.length },
            { label: 'Контрагентов', value: previewCounterparties.length },
            { label: 'С ответом', value: repliedCount, tone: 'ok' },
            { label: 'Без ответа', value: rangedItems.length - repliedCount, tone: 'warn' },
            { label: 'Ср. ожидание', value: `${avgWait} дн.`, tone: 'accent' },
            { label: 'Ср. время ответа', value: `${avgCycle} дн.`, tone: 'accent' },
          ]}
        />

        <div className="charts-grid" style={{ marginBottom: 16 }}>
          {showChart('status') ? <BarChart title="По статусам" data={[...statusBars, ...orphanBars]} /> : null}
          {showChart('sentTrend') ? (
            <TrendChart title="Отправлено по месяцам" data={sentTrend} color="#3b82f6" />
          ) : null}
          {showChart('cycle') ? (
            <BarChart
              title="Время ответа (дн.)"
              subtitle={cycleDays.length ? `${cycleDays.length} отвечено · ср. ${avgCycle}` : undefined}
              data={cycleBuckets}
              empty="Пока нет отвеченных писем."
            />
          ) : null}
        </div>

        <div className="company-summary-grid">
          {previewCounterparties.map((counterparty) => {
            const list = rangedItems.filter(
              (item) => (item.counterparty.trim() || 'Без контрагента') === counterparty,
            );
            const topics = Array.from(new Set(list.map((item) => item.topic.trim()).filter(Boolean)));
            const statusList = Array.from(new Set(list.map((item) => item.status)));
            const companyDocs = docs.filter(
              (d) =>
                (activeProject === '' || d.project === activeProject) &&
                (d.counterparty.trim() || 'Без контрагента') === counterparty,
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
                        <span
                          className="status-chip"
                          style={{
                            background:
                              stageList.indexOf(item.status) === -1
                                ? '#9ca3af'
                                : stageColor(stageList.indexOf(item.status)),
                          }}
                        >
                          {item.status}
                        </span>
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

        {showChart('funnel') ? <Funnel items={rangedItems} stages={stageList} /> : null}

        {showChart('sankey') ? (
          <div style={{ marginTop: 16 }}>
            <div className="sankey-dim">
              <span className="range-filter-title">Поток</span>
              <select value={sankeyDim} onChange={(e) => setSankeyDim(e.target.value as typeof sankeyDim)}>
                <option value="topic">Тематика → Статус</option>
                <option value="counterparty">Контрагент → Статус</option>
                <option value="project">Проект → Статус</option>
              </select>
            </div>
            <Sankey
              title={`${sankeyDimLabel} → Статус`}
              links={sankeyLinks}
              sourceColor={sankeyDim === 'project' ? (name) => projectMeta[name]?.color : undefined}
              empty="Нет данных за период."
            />
          </div>
        ) : null}

        {showChart('gantt') ? (
          <div style={{ marginTop: 16 }}>
            <GanttChart
              title="Диаграмма Ганта"
              subtitle="🟦 ждёт ответа · 🟥 просрочено · 🟩 отвечено"
              rows={letterGantt}
              empty="Нет корректных дат для построения диаграммы."
            />
          </div>
        ) : null}
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
            <details className="columns-menu data-menu">
              <summary className="clear-button">Данные ▾</summary>
              <div className="columns-popover data-popover">
                <button type="button" className="data-item" onClick={handleExportExcel}>
                  Экспорт в Excel
                </button>
                {isAdmin ? (
                  <button type="button" className="data-item" onClick={handleExportFiles} disabled={filesBusy}>
                    {filesBusy ? 'Архив…' : 'Скачать файлы (ZIP)'}
                  </button>
                ) : null}
                {isAdmin ? (
                  <button type="button" className="data-item" onClick={handleBackup} disabled={backupBusy}>
                    {backupBusy ? 'Копия…' : '💾 Резервная копия'}
                  </button>
                ) : null}
                {isAdmin ? (
                  <button
                    type="button"
                    className="data-item"
                    onClick={() => restoreInputRef.current?.click()}
                    disabled={backupBusy}
                  >
                    📂 Восстановить из копии
                  </button>
                ) : null}
              </div>
            </details>
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
            <button type="button" onClick={() => setAccountOpen(true)} className="clear-button">
              {session.username}
            </button>
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
            <ProjectSelect
              active={activeProject}
              projects={selectorProjects}
              meta={projectMeta}
              onSelect={setActiveProject}
              onAdd={addProject}
            />
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
              <button
                type="button"
                className={section === 'help' ? 'toggle-button active' : 'toggle-button'}
                onClick={() => setSection('help')}
                title="Справка и обучение"
              >
                Справка
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

      {editItemId && items.some((i) => i.id === editItemId) ? (
        <LetterDrawer
          item={items.find((i) => i.id === editItemId)!}
          stages={stageList}
          projects={allProjects}
          isAdmin={isAdmin}
          onUpdate={updateItem}
          onChangeStatus={changeStatus}
          onAddStage={addStage}
          onRemove={removeItem}
          onClose={() => setEditItemId(null)}
        />
      ) : null}

      {accountOpen ? (
        <AccountDialog
          session={session}
          projects={allProjects}
          projectMeta={projectMeta}
          onAddProject={addProject}
          onRenameProject={renameProject}
          onDeleteProject={deleteProject}
          onSetProjectColor={(name, color) => setProjectMetaField(name, { color })}
          onSetProjectIcon={(name, icon) => setProjectMetaField(name, { icon })}
          onToggleArchiveProject={toggleArchiveProject}
          onClose={() => setAccountOpen(false)}
        />
      ) : null}

      {globalQuery.trim() ? (
        <GlobalSearch
          query={globalQuery}
          items={items}
          docs={docs}
          project={activeProject}
          onJump={(target) => {
            setSection(target);
            setGlobalQuery('');
          }}
        />
      ) : null}

      {section === 'help' ? <Help /> : null}

      {section === 'dashboard' ? (
        <Dashboard items={items} stages={stageList} docs={docs} project={activeProject} projectMeta={projectMeta} />
      ) : null}

      {section === 'interactions' ? <Interactions isAdmin={isAdmin} project={activeProject} /> : null}

      {section === 'tasks' ? <Tasks isAdmin={isAdmin} project={activeProject} /> : null}

      {section === 'documents' ? (
        <Documents items={items} stages={stageList} isAdmin={isAdmin} project={activeProject} />
      ) : null}

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
              <label>
                Просрочка &gt;, дн.
                <input
                  type="number"
                  min={1}
                  value={overdueDays}
                  onChange={(e) => setOverdueDays(Math.max(1, Number(e.target.value) || 1))}
                  style={{ width: 90 }}
                />
              </label>
              <div className="filter-presets">
                <PresetsMenu presets={presets} onApply={applyPreset} onSave={savePreset} onDelete={deletePreset} />
              </div>
            </div>
          </div>
          {viewMode === 'table' ? (
            <div className="table-header-actions">
              <button
                type="button"
                className="clear-button"
                onClick={() => setDense((d) => !d)}
                title="Плотность строк"
              >
                {dense ? 'Комфортно' : 'Компактно'}
              </button>
              <ColumnsMenu cols={cols} onToggle={toggleCol} onReset={resetCols} />
              {isAdmin ? (
                <>
                  <button type="button" onClick={() => importInputRef.current?.click()} className="clear-button">
                    Импорт CSV/Excel
                  </button>
                  <input
                    ref={importInputRef}
                    type="file"
                    accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      handleImportFile(e.target.files?.[0]);
                      e.target.value = '';
                    }}
                  />
                  <button type="button" onClick={addEmptyRow} className="primary-button">
                    Добавить строку
                  </button>
                </>
              ) : null}
            </div>
          ) : null}
        </div>

        {viewMode === 'table' ? (
          filteredItems.length === 0 ? (
            <EmptyState
              icon="✉️"
              text={
                activeProject || filterStatus !== 'Все' || filterCounterparty !== 'Все контрагенты' || search
                  ? 'Под выбранные фильтры писем нет.'
                  : 'Писем пока нет.'
              }
              actionLabel={isAdmin ? 'Добавить письмо' : undefined}
              onAction={isAdmin ? addEmptyRow : undefined}
            />
          ) : (
            <>
            {isAdmin && selected.size > 0 ? (
              <div className="bulk-bar">
                <span className="bulk-count">Выбрано: {selected.size}</span>
                <label className="bulk-action">
                  Статус
                  <select
                    value=""
                    onChange={(e) => {
                      if (e.target.value) bulkChangeStatus(e.target.value);
                    }}
                  >
                    <option value="">— сменить —</option>
                    {stageList.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="bulk-action">
                  Проект
                  <select
                    value=""
                    onChange={(e) => {
                      if (e.target.value === '__none__') bulkChangeProject('');
                      else if (e.target.value) bulkChangeProject(e.target.value);
                    }}
                  >
                    <option value="">— перенести —</option>
                    <option value="__none__">(без проекта)</option>
                    {allProjects.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="button" className="delete-button" onClick={() => removeItems([...selected])}>
                  Удалить
                </button>
                <button type="button" className="clear-button" onClick={() => setSelected(new Set())}>
                  Снять выделение
                </button>
              </div>
            ) : null}
            <div
              className={`table-scroll spreadsheet-table${virtualTable ? ' virtual' : ''}${dense ? ' dense' : ''}${
                isAdmin ? ' has-select' : ''
              }`}
              onScroll={virtualTable ? (e) => setScrollTop(e.currentTarget.scrollTop) : undefined}
            >
              <fieldset className="table-fieldset" disabled={!isAdmin}>
              <table>
                <thead>
                  <tr>
                    {isAdmin ? (
                      <th className="select-col sticky-col">
                        <input
                          type="checkbox"
                          checked={allVisibleSelected}
                          onChange={toggleSelectAll}
                          title="Выделить всё"
                        />
                      </th>
                    ) : null}
                    <th className="sticky-col rownum">#</th>
                    {cols.sentDate ? (
                      <th className="sortable" onClick={() => toggleSort('sentDate')} title="Сортировать">
                        Дата отправки{sortMark('sentDate')}
                      </th>
                    ) : null}
                    {cols.counterparty ? (
                      <th className="sortable sticky-col col-cp" onClick={() => toggleSort('counterparty')} title="Сортировать">
                        Контрагент{sortMark('counterparty')}
                      </th>
                    ) : null}
                    {cols.contact ? <th>Адресат / контакт</th> : null}
                    {cols.channel ? <th>Email / канал</th> : null}
                    {cols.topic ? <th>Тематика</th> : null}
                    {cols.subject ? <th>Тема письма</th> : null}
                    {cols.status ? (
                      <th className="sortable" onClick={() => toggleSort('status')} title="Сортировать">
                        Статус ответа{sortMark('status')}
                      </th>
                    ) : null}
                    {cols.replyDate ? (
                      <th className="sortable" onClick={() => toggleSort('replyDate')} title="Сортировать">
                        Дата ответа{sortMark('replyDate')}
                      </th>
                    ) : null}
                    {cols.wait ? (
                      <th className="sortable" onClick={() => toggleSort('wait')} title="Сортировать">
                        Срок, дн.{sortMark('wait')}
                      </th>
                    ) : null}
                    {cols.owner ? <th>Кто отвечает</th> : null}
                    {cols.note ? <th>Примечание</th> : null}
                    {cols.docs ? <th>Док-ты</th> : null}
                    {cols.project ? <th>Проект</th> : null}
                    {isAdmin ? <th>Удалить</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {virtualTable && padTop > 0 ? (
                    <tr aria-hidden>
                      <td colSpan={colCount} style={{ height: padTop, padding: 0, border: 'none' }} />
                    </tr>
                  ) : null}
                  {windowItems.map((item, i) => {
                    const index = winStart + i;
                    const days = waitingDays(item);
                    const overdue = days !== null && !item.replyDate && days > overdueDays;
                    return (
                      <tr key={item.id} ref={i === 0 ? firstRowRef : undefined} className={selected.has(item.id) ? 'row-selected' : undefined}>
                        {isAdmin ? (
                          <td className="select-col sticky-col">
                            <input type="checkbox" checked={selected.has(item.id)} onChange={() => toggleSelect(item.id)} />
                          </td>
                        ) : null}
                        <td className="row-number sticky-col rownum">
                          <span
                            role="button"
                            tabIndex={0}
                            className="row-open"
                            title="Открыть карточку письма"
                            onClick={() => setEditItemId(item.id)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                setEditItemId(item.id);
                              }
                            }}
                          >
                            {index + 1}
                          </span>
                        </td>
                        {cols.sentDate ? (
                          <td data-label="Дата отправки">
                            <input
                              className="table-input"
                              type="date"
                              value={item.sentDate}
                              onChange={(e) => updateItem(item.id, { sentDate: e.target.value })}
                            />
                          </td>
                        ) : null}
                        {cols.counterparty ? (
                          <td data-label="Контрагент" className="sticky-col col-cp">
                            <input
                              className="table-input"
                              value={item.counterparty}
                              onChange={(e) => updateItem(item.id, { counterparty: e.target.value })}
                              placeholder="Контрагент"
                            />
                          </td>
                        ) : null}
                        {cols.contact ? (
                          <td data-label="Адресат / контакт">
                            <input
                              className="table-input"
                              value={item.contact}
                              onChange={(e) => updateItem(item.id, { contact: e.target.value })}
                              placeholder="Адресат"
                            />
                          </td>
                        ) : null}
                        {cols.channel ? (
                          <td data-label="Email / канал">
                            <input
                              className="table-input"
                              value={item.channel}
                              onChange={(e) => updateItem(item.id, { channel: e.target.value })}
                              placeholder="email / канал"
                            />
                          </td>
                        ) : null}
                        {cols.topic ? (
                          <td data-label="Тематика">
                            <input
                              className="table-input"
                              value={item.topic}
                              onChange={(e) => updateItem(item.id, { topic: e.target.value })}
                              placeholder="Тематика"
                            />
                          </td>
                        ) : null}
                        {cols.subject ? (
                          <td data-label="Тема письма">
                            <input
                              className="table-input"
                              value={item.subject}
                              onChange={(e) => updateItem(item.id, { subject: e.target.value })}
                              placeholder="Тема письма"
                            />
                          </td>
                        ) : null}
                        {cols.status ? (
                          <td data-label="Статус ответа">
                            <div className="status-cell">
                              <span
                                className="status-dot"
                                style={{
                                  background:
                                    stageList.indexOf(item.status) === -1
                                      ? '#9ca3af'
                                      : stageColor(stageList.indexOf(item.status)),
                                }}
                              />
                              <StatusSelect
                                className="table-input"
                                value={item.status}
                                stages={stageList}
                                onChange={(status) => changeStatus(item.id, status)}
                                onAddStage={addStage}
                              />
                            </div>
                          </td>
                        ) : null}
                        {cols.replyDate ? (
                          <td data-label="Дата ответа">
                            <input
                              className="table-input"
                              type="date"
                              value={item.replyDate}
                              onChange={(e) => updateItem(item.id, { replyDate: e.target.value })}
                            />
                          </td>
                        ) : null}
                        {cols.wait ? (
                          <td data-label="Срок, дн." className={overdue ? 'days-cell overdue' : 'days-cell'}>
                            {days ?? '—'}
                          </td>
                        ) : null}
                        {cols.owner ? (
                          <td data-label="Кто отвечает">
                            <input
                              className="table-input"
                              value={item.owner}
                              onChange={(e) => updateItem(item.id, { owner: e.target.value })}
                              placeholder="Ответственный"
                            />
                          </td>
                        ) : null}
                        {cols.note ? (
                          <td data-label="Примечание">
                            <input
                              className="table-input"
                              value={item.note}
                              onChange={(e) => updateItem(item.id, { note: e.target.value })}
                              placeholder="Примечание"
                            />
                          </td>
                        ) : null}
                        {cols.docs ? (
                          <td className="doc-cell" data-label="Документы">
                            <DocCell item={item} isAdmin={isAdmin} stages={stageList} />
                          </td>
                        ) : null}
                        {cols.project ? (
                          <td data-label="Проект">
                            <select
                              className="table-input"
                              value={item.project}
                              onChange={(e) => updateItem(item.id, { project: e.target.value })}
                            >
                              <option value="">(без проекта)</option>
                              {allProjects.map((p) => (
                                <option key={p} value={p}>
                                  {p}
                                </option>
                              ))}
                            </select>
                          </td>
                        ) : null}
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
                  {virtualTable && padBottom > 0 ? (
                    <tr aria-hidden>
                      <td colSpan={colCount} style={{ height: padBottom, padding: 0, border: 'none' }} />
                    </tr>
                  ) : null}
                </tbody>
              </table>
              </fieldset>
            </div>
            </>
          )
        ) : (
          renderPreview()
        )}
      </section>
      </>
      )}

      <BackToTop />

      {toasts.length ? (
        <div className="toast-stack">
          {toasts.map((t) => (
            <div key={t.id} className="toast">
              <span className="toast-msg">{t.message}</span>
              <button type="button" className="toast-undo" onClick={t.onUndo}>
                Отменить
              </button>
              <button type="button" className="toast-x" onClick={t.onClose} title="Закрыть">
                ✕
              </button>
            </div>
          ))}
        </div>
      ) : null}
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
  const [syncing, setSyncing] = useState(false);

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

  // Подтягиваем данные с сервера при входе — чтобы введённое в прошлых версиях
  // и на других устройствах было на месте. Приложение рендерим только после этого.
  useEffect(() => {
    if (!session) return;
    let alive = true;
    setSyncing(true);
    (async () => {
      const store = await fetchStore();
      if (store) {
        try {
          await applyBackupData(store);
        } catch {
          /* несовместимый снимок — игнорируем, останутся локальные данные */
        }
      } else if (session.role === 'admin') {
        // На сервере данных ещё нет — заливаем текущие локальные (миграция из браузера).
        try {
          const local = await createBackup();
          if (local.items.length || local.tasks.length || local.interactions.length || local.docs.length) {
            await pushStore(local);
          }
        } catch {
          /* не критично */
        }
      }
      if (alive) setSyncing(false);
    })();
    return () => {
      alive = false;
    };
  }, [session]);

  // Автосохранение изменений на сервер (только admin). Сравниваем дешёвую подпись;
  // при изменении отправляем полный снимок. Плюс отправка при уходе со вкладки.
  useEffect(() => {
    if (!session || session.role !== 'admin' || syncing) return;
    let last = dataSignature();
    let busy = false;
    const flush = async () => {
      if (busy) return;
      const sig = dataSignature();
      if (sig === last) return;
      busy = true;
      try {
        const backup = await createBackup();
        if (await pushStore(backup)) last = sig;
      } finally {
        busy = false;
      }
    };
    const timer = window.setInterval(flush, 4000);
    const onHide = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, [session, syncing]);

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

  if (syncing) {
    return (
      <div className="login-page">
        <div className="login-card">
          <p className="brand">Cadence</p>
          <p className="subtitle">Синхронизация данных…</p>
        </div>
      </div>
    );
  }

  return <AppContent session={session} onLogout={handleLogout} />;
}
