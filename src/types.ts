// Стадии (значения поля «Статус ответа») — НЕ зашиты жёстко.
// Пользователь редактирует список в приложении: можно добавлять стадии уточнения,
// возвраты назад, любые промежуточные шаги. Это лишь стартовый набор для нового стенда.
export const DEFAULT_STAGES = ['Отослал', 'Ответ получен', 'В работе', 'Договор', 'Отказ'];

export type Stage = string;

// Палитра цветов; цвет стадии = по её позиции в списке (циклически).
export const STAGE_PALETTE = [
  '#3b82f6',
  '#6366f1',
  '#10b981',
  '#8b5cf6',
  '#ef4444',
  '#f97316',
  '#0ea5e9',
  '#ec4899',
  '#14b8a6',
  '#eab308',
];

export const stageColor = (index: number) => STAGE_PALETTE[((index % STAGE_PALETTE.length) + STAGE_PALETTE.length) % STAGE_PALETTE.length];

// Событие смены стадии — лог для воронки переходов.
export type StageEvent = {
  stage: string;
  at: string; // ISO-метка времени, когда запись перешла в эту стадию
};

// Задача (отдельный от писем список). Активные — пока !done; выполненные хранят результат.
export type Task = {
  id: string;
  title: string; // что нужно сделать
  description: string; // детали
  counterparty: string; // контрагент, к которому относится задача ('' — без привязки)
  dueDate: string; // срок (дата)
  done: boolean;
  result: string; // описание результата (заполняется при/после выполнения)
  completedDate: string; // дата выполнения
  createdAt: string;
  project: string; // проект (проставляется автоматически из активного; '' — без проекта)
};

// Взаимодействие = любой контакт, не являющийся письмом: встреча, совещание,
// эксперимент, звонок и т.п. Тип (`kind`) свободный — список ниже лишь подсказки.
// Дата и примечание необязательны.
export const DEFAULT_INTERACTION_KINDS = ['Встреча', 'Совещание', 'Эксперимент', 'Звонок', 'Переговоры'];

export type Interaction = {
  id: string;
  kind: string; // тип взаимодействия (встреча / совещание / эксперимент / …)
  date: string; // дата (необязательно, '' допустимо)
  counterparty: string; // контрагент (необязательно)
  title: string; // кратко: о чём
  participants: string; // участники / кто был
  note: string; // примечание
  createdAt: string;
  project: string; // проект (проставляется автоматически; '' — без проекта)
};

// Одна запись = одно отправленное письмо / обращение.
// Поля соответствуют столбцам рабочей таблицы.
export type Item = {
  id: string;
  sentDate: string; // Дата отправки
  counterparty: string; // Контрагент
  contact: string; // Адресат / контактное лицо
  channel: string; // Email / канал
  topic: string; // Тематика
  subject: string; // Тема письма
  status: string; // Статус ответа (текущая стадия)
  replyDate: string; // Дата ответа (пусто, пока ответа нет)
  nextActionDate: string; // Дата следующего шага / напоминания «написать снова» (пусто — без напоминания)
  owner: string; // Кто отвечает у нас
  note: string; // Примечание
  project: string; // Проект (проставляется автоматически из активного; '' — без проекта)
  history: StageEvent[]; // лог смены стадий
};
