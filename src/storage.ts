import { Item, StageEvent, Task, Interaction, DEFAULT_STAGES, DEFAULT_INTERACTION_KINDS } from './types';

const STORAGE_KEY = 'resolve-table-items-v2';
const LEGACY_KEY = 'resolve-table-items-v1';
const STAGES_KEY = 'resolve-table-stages-v1';
const TASKS_KEY = 'resolve-table-tasks-v1';
const INTERACTIONS_KEY = 'resolve-table-interactions-v1';

export const today = () => new Date().toISOString().slice(0, 10);
export const now = () => new Date().toISOString();

// crypto.randomUUID доступен лишь в защищённом контексте (https / localhost).
// При раздаче через nginx по голому http его нет — нужен запасной генератор,
// иначе добавление письма/задачи падало бы с ошибкой.
export function uid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// --- Стадии (редактируемый пользователем список) ---

export function loadStages(): string[] {
  const stored = localStorage.getItem(STAGES_KEY);
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed) && parsed.every((s) => typeof s === 'string') && parsed.length > 0) {
        return parsed;
      }
    } catch {
      /* падать не будем — вернём дефолт */
    }
  }
  return [...DEFAULT_STAGES];
}

export function saveStages(stages: string[]) {
  localStorage.setItem(STAGES_KEY, JSON.stringify(stages));
}

// --- Записи ---

export function defaultItem(initialStage: string = DEFAULT_STAGES[0]): Item {
  const stamp = now();
  return {
    id: uid(),
    sentDate: today(),
    counterparty: '',
    contact: '',
    channel: '',
    topic: '',
    subject: '',
    status: initialStage,
    replyDate: '',
    owner: '',
    note: '',
    history: [{ stage: initialStage, at: stamp }],
  };
}

// Гарантируем валидную запись: заполняем пропуски и заводим историю, если её нет.
function normalize(raw: Partial<Item>): Item {
  const base = defaultItem(raw.status || DEFAULT_STAGES[0]);
  const item: Item = { ...base, ...raw, id: raw.id ?? base.id };
  if (!Array.isArray(item.history) || item.history.length === 0) {
    const seedAt = item.sentDate ? new Date(item.sentDate).toISOString() : now();
    item.history = [{ stage: item.status, at: seedAt }];
  }
  return item;
}

// Перенос старой схемы v1 (company/want/stage/...) в новую, чтобы не терять данные.
function migrateLegacy(raw: Record<string, unknown>): Partial<Item> {
  return {
    id: typeof raw.id === 'string' ? raw.id : undefined,
    sentDate: typeof raw.startDate === 'string' ? raw.startDate : today(),
    counterparty: typeof raw.company === 'string' ? raw.company : '',
    contact: typeof raw.contact === 'string' ? raw.contact : '',
    channel: typeof raw.emailSent === 'string' ? raw.emailSent : '',
    topic: typeof raw.category === 'string' ? raw.category : '',
    subject: typeof raw.want === 'string' ? raw.want : '',
    status: typeof raw.stage === 'string' ? raw.stage : DEFAULT_STAGES[0],
    replyDate: typeof raw.endDate === 'string' ? raw.endDate : '',
    owner: typeof raw.whoseTurn === 'string' ? raw.whoseTurn : '',
    note: typeof raw.delayReason === 'string' ? raw.delayReason : '',
  };
}

export function loadItems(): Item[] {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as Partial<Item>[];
      return parsed.map(normalize);
    } catch {
      return [];
    }
  }

  // Однократная миграция со старой версии.
  const legacy = localStorage.getItem(LEGACY_KEY);
  if (legacy) {
    try {
      const parsed = JSON.parse(legacy) as Record<string, unknown>[];
      return parsed.map((raw) => normalize(migrateLegacy(raw)));
    } catch {
      return [];
    }
  }

  return [];
}

export function saveItems(items: Item[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

export function normalizeImport(parsed: unknown): Item[] | null {
  if (!Array.isArray(parsed)) return null;
  return parsed.map((raw) => normalize(raw as Partial<Item>));
}

// Добавляет событие смены стадии, если стадия действительно изменилась.
export function withStageChange(item: Item, status: string): Item {
  if (item.status === status) return item;
  const event: StageEvent = { stage: status, at: now() };
  return { ...item, status, history: [...item.history, event] };
}

// --- Задачи ---

export function defaultTask(): Task {
  return {
    id: uid(),
    title: '',
    description: '',
    dueDate: today(),
    done: false,
    result: '',
    completedDate: '',
    createdAt: now(),
  };
}

export function loadTasks(): Task[] {
  const stored = localStorage.getItem(TASKS_KEY);
  if (!stored) return [];
  try {
    const parsed = JSON.parse(stored) as Partial<Task>[];
    return parsed.map((raw) => ({ ...defaultTask(), ...raw, id: raw.id ?? uid() }));
  } catch {
    return [];
  }
}

export function saveTasks(tasks: Task[]) {
  localStorage.setItem(TASKS_KEY, JSON.stringify(tasks));
}

// --- Взаимодействия (встречи, совещания, эксперименты и т.п.) ---

export function defaultInteraction(): Interaction {
  return {
    id: uid(),
    kind: DEFAULT_INTERACTION_KINDS[0],
    date: today(),
    counterparty: '',
    title: '',
    participants: '',
    note: '',
    createdAt: now(),
  };
}

export function loadInteractions(): Interaction[] {
  const stored = localStorage.getItem(INTERACTIONS_KEY);
  if (!stored) return [];
  try {
    const parsed = JSON.parse(stored) as Partial<Interaction>[];
    return parsed.map((raw) => ({ ...defaultInteraction(), ...raw, id: raw.id ?? uid() }));
  } catch {
    return [];
  }
}

export function saveInteractions(list: Interaction[]) {
  localStorage.setItem(INTERACTIONS_KEY, JSON.stringify(list));
}

export { STORAGE_KEY, STAGES_KEY, TASKS_KEY, INTERACTIONS_KEY };
