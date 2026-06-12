import { useEffect, useMemo, useState } from 'react';
import { Task } from './types';
import { defaultTask, loadTasks, saveTasks, today } from './storage';
import { MonthlyReport } from './MonthlyReport';
import {
  BarChart,
  EMPTY_RANGE,
  GanttChart,
  GanttRow,
  KpiRow,
  Range,
  RangeFilter,
  TrendChart,
  inRange,
  isRangeActive,
  trendFromDates,
} from './charts';

const parseDate = (v: string) => {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

const monthKey = (date: string) => (date ? date.slice(0, 7) : '');

function monthLabel(key: string) {
  const date = new Date(`${key}-01`);
  if (Number.isNaN(date.getTime())) return key;
  const label = date.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('ru-RU');
}

export function Tasks({ isAdmin, project }: { isAdmin: boolean; project: string }) {
  const [tasks, setTasks] = useState<Task[]>(() => loadTasks());
  const [newTask, setNewTask] = useState<Task>(() => defaultTask());
  const [monthFilter, setMonthFilter] = useState('Все');
  const [mode, setMode] = useState<'list' | 'charts' | 'report'>('list');
  const [reportMonth, setReportMonth] = useState(() => today().slice(0, 7));
  const [range, setRange] = useState<Range>(EMPTY_RANGE);

  useEffect(() => {
    saveTasks(tasks);
  }, [tasks]);

  // Задачи активного проекта (при «Все проекты» — все).
  const scoped = useMemo(() => tasks.filter((t) => project === '' || t.project === project), [tasks, project]);

  // Месяцы для отчёта: из сроков и дат выполнения, плюс текущий месяц.
  const reportMonths = useMemo(() => {
    const set = new Set<string>([today().slice(0, 7)]);
    scoped.forEach((t) => {
      if (t.dueDate) set.add(t.dueDate.slice(0, 7));
      if (t.completedDate) set.add(t.completedDate.slice(0, 7));
    });
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [scoped]);

  const monthName = (key: string) => {
    const date = new Date(`${key}-01`);
    if (Number.isNaN(date.getTime())) return key;
    const label = date.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
    return label.charAt(0).toUpperCase() + label.slice(1);
  };

  const active = useMemo(
    () => scoped.filter((t) => !t.done).sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    [scoped],
  );
  const completed = useMemo(
    () => scoped.filter((t) => t.done).sort((a, b) => b.completedDate.localeCompare(a.completedDate)),
    [scoped],
  );

  const monthOptions = useMemo(
    () => Array.from(new Set(active.map((t) => monthKey(t.dueDate)).filter(Boolean))).sort(),
    [active],
  );

  const filteredActive = useMemo(
    () => (monthFilter === 'Все' ? active : active.filter((t) => monthKey(t.dueDate) === monthFilter)),
    [active, monthFilter],
  );

  // Аналитика: задача попадает в период, если её срок или дата выполнения внутри него.
  const analytics = useMemo(() => {
    const todayStr = today();
    const inWindow = scoped.filter((t) =>
      isRangeActive(range) ? inRange(t.dueDate, range) || inRange(t.completedDate, range) : true,
    );
    const done = inWindow.filter((t) => t.done);
    const open = inWindow.filter((t) => !t.done);
    const overdue = open.filter((t) => !!t.dueDate && t.dueDate < todayStr).length;
    const total = inWindow.length;
    return {
      total,
      done: done.length,
      open: open.length,
      overdue,
      rate: total === 0 ? 0 : Math.round((done.length / total) * 100),
      dueTrend: trendFromDates(inWindow.map((t) => t.dueDate)),
      doneTrend: trendFromDates(done.map((t) => t.completedDate)),
      gantt: inWindow
        .map((t): GanttRow | null => {
          // полоса: от постановки (createdAt, иначе срок) до выполнения / срока
          const start = parseDate(t.createdAt) ?? parseDate(t.dueDate);
          const endRaw = t.done ? t.completedDate || t.dueDate : t.dueDate;
          const end = parseDate(endRaw) ?? start;
          if (!start || !end) return null;
          const overdue = !t.done && !!t.dueDate && t.dueDate < todayStr;
          const color = t.done ? '#10b981' : overdue ? '#ef4444' : '#3b82f6';
          return {
            id: t.id,
            label: t.title || 'Без названия',
            sub: t.done ? 'выполнено' : overdue ? 'просрочено' : 'в работе',
            start: start < end ? start : end,
            end: start < end ? end : start,
            color,
          };
        })
        .filter((r): r is GanttRow => r !== null)
        .sort((a, b) => a.start.getTime() - b.start.getTime()),
    };
  }, [scoped, range]);

  const addTask = () => {
    if (!newTask.title.trim()) return;
    setTasks((prev) => [{ ...newTask, project }, ...prev]);
    setNewTask(defaultTask());
  };

  const updateTask = (id: string, partial: Partial<Task>) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...partial } : t)));
  };

  const completeTask = (id: string) => updateTask(id, { done: true, completedDate: today() });
  const reopenTask = (id: string) => updateTask(id, { done: false, completedDate: '' });
  const removeTask = (id: string) => {
    if (!window.confirm('Удалить задачу?')) return;
    setTasks((prev) => prev.filter((t) => t.id !== id));
  };

  const todayStr = today();

  return (
    <>
      <div className="card tasks-toolbar no-print">
        <div className="mode-switch">
          <button
            type="button"
            className={mode === 'list' ? 'toggle-button active' : 'toggle-button'}
            onClick={() => setMode('list')}
          >
            Список
          </button>
          <button
            type="button"
            className={mode === 'charts' ? 'toggle-button active' : 'toggle-button'}
            onClick={() => setMode('charts')}
          >
            Диаграммы
          </button>
          <button
            type="button"
            className={mode === 'report' ? 'toggle-button active' : 'toggle-button'}
            onClick={() => setMode('report')}
          >
            Отчёт за месяц
          </button>
        </div>
        {mode === 'report' ? (
          <div className="toolbar-right">
            <label className="inline-label">
              Месяц
              <select value={reportMonth} onChange={(e) => setReportMonth(e.target.value)}>
                {reportMonths.map((key) => (
                  <option key={key} value={key}>
                    {monthName(key)}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="primary-button" onClick={() => window.print()}>
              Печать / PDF
            </button>
          </div>
        ) : null}
      </div>

      {mode === 'report' ? (
        <section className="card report-card">
          <MonthlyReport tasks={scoped} month={reportMonth} />
        </section>
      ) : mode === 'charts' ? (
        <section className="card">
          <h2>Диаграммы задач</h2>
          <RangeFilter range={range} onChange={setRange} />
          <KpiRow
            items={[
              { label: 'Всего задач', value: analytics.total },
              { label: 'Выполнено', value: analytics.done, tone: 'ok' },
              { label: 'В работе', value: analytics.open },
              { label: 'Просрочено', value: analytics.overdue, tone: 'warn' },
              { label: 'Выполнение', value: `${analytics.rate}%`, tone: 'accent' },
            ]}
          />
          <div className="charts-grid">
            <BarChart
              title="Статус задач"
              data={[
                { label: 'Выполнено', value: analytics.done, color: '#10b981' },
                { label: 'В работе', value: analytics.open, color: '#3b82f6' },
                { label: 'Просрочено', value: analytics.overdue, color: '#ef4444' },
              ]}
            />
            <TrendChart title="Поставлено (по сроку)" subtitle="по месяцам" data={analytics.dueTrend} color="#3b82f6" />
            <TrendChart title="Выполнено" subtitle="по месяцам" data={analytics.doneTrend} color="#10b981" />
          </div>
          <div style={{ marginTop: 16 }}>
            <GanttChart
              title="Гант задач"
              subtitle={`${analytics.gantt.length} задач · 🟦 в работе · 🟥 просрочено · 🟩 выполнено`}
              rows={analytics.gantt}
              empty="Нет задач с датами за выбранный период."
            />
          </div>
        </section>
      ) : (
      <>
      {isAdmin && (
        <section className="card">
          <h2>Новая задача</h2>
          <div className="form-grid">
            <label>
              Что нужно сделать
              <input
                value={newTask.title}
                onChange={(e) => setNewTask({ ...newTask, title: e.target.value })}
                placeholder="Название задачи"
              />
            </label>
            <label>
              Срок
              <input
                type="date"
                value={newTask.dueDate}
                onChange={(e) => setNewTask({ ...newTask, dueDate: e.target.value })}
              />
            </label>
            <label className="full-width">
              Описание
              <textarea
                rows={2}
                value={newTask.description}
                onChange={(e) => setNewTask({ ...newTask, description: e.target.value })}
                placeholder="Детали задачи"
              />
            </label>
          </div>
          <div className="actions-row">
            <button type="button" onClick={addTask} className="primary-button">
              Добавить задачу
            </button>
            <span className="hint">Данные хранятся локально в браузере.</span>
          </div>
        </section>
      )}

      <section className="card">
        <div className="table-header">
          <div>
            <h2>Активные задачи</h2>
            <div className="table-filters">
              <label>
                Месяц (по сроку)
                <select value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)}>
                  <option value="Все">Все ({active.length})</option>
                  {monthOptions.map((key) => (
                    <option key={key} value={key}>
                      {monthLabel(key)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        </div>

        {filteredActive.length === 0 ? (
          <p className="empty-state">Активных задач нет.</p>
        ) : (
          <div className="task-list">
            {filteredActive.map((task) => (
              <ActiveTaskRow
                key={task.id}
                task={task}
                isAdmin={isAdmin}
                todayStr={todayStr}
                onUpdate={updateTask}
                onComplete={completeTask}
                onRemove={removeTask}
              />
            ))}
          </div>
        )}
      </section>

      <section className="card">
        <h2>Выполнено ({completed.length})</h2>
        {completed.length === 0 ? (
          <p className="empty-state">Выполненных задач пока нет.</p>
        ) : (
          <fieldset className="task-fieldset" disabled={!isAdmin}>
            <div className="task-list">
              {completed.map((task) => (
                <article key={task.id} className="task-row done">
                  <div className="task-main">
                    <div className="task-title-static">✓ {task.title || 'Без названия'}</div>
                    {task.description ? <div className="task-desc-static">{task.description}</div> : null}
                    <label className="task-result">
                      Результат / что сделано
                      <textarea
                        rows={2}
                        value={task.result}
                        onChange={(e) => updateTask(task.id, { result: e.target.value })}
                        placeholder="Опишите результат"
                      />
                    </label>
                  </div>
                  <div className="task-side">
                    <span className="task-completed-date">Выполнено: {formatDate(task.completedDate)}</span>
                    {isAdmin && (
                      <div className="task-actions">
                        <button type="button" className="clear-button" onClick={() => reopenTask(task.id)}>
                          Вернуть в работу
                        </button>
                        <button type="button" className="delete-button" onClick={() => removeTask(task.id)}>
                          Удалить
                        </button>
                      </div>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </fieldset>
        )}
      </section>
      </>
      )}
    </>
  );
}

// Строка активной задачи. По умолчанию заблокирована (показывается как текст),
// чтобы случайно не изменить уже заведённую задачу. Правка — по кнопке «✎ Изменить».
function ActiveTaskRow({
  task,
  isAdmin,
  todayStr,
  onUpdate,
  onComplete,
  onRemove,
}: {
  task: Task;
  isAdmin: boolean;
  todayStr: string;
  onUpdate: (id: string, partial: Partial<Task>) => void;
  onComplete: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const overdue = !!task.dueDate && task.dueDate < todayStr;

  return (
    <article className={overdue ? 'task-row overdue' : 'task-row'}>
      <div className="task-main">
        {editing ? (
          <>
            <input
              className="task-title"
              value={task.title}
              onChange={(e) => onUpdate(task.id, { title: e.target.value })}
              placeholder="Название задачи"
            />
            <textarea
              className="task-desc"
              rows={2}
              value={task.description}
              onChange={(e) => onUpdate(task.id, { description: e.target.value })}
              placeholder="Описание"
            />
          </>
        ) : (
          <>
            <div className="task-title-static">{task.title || 'Без названия'}</div>
            {task.description ? <div className="task-desc-static">{task.description}</div> : null}
          </>
        )}
      </div>
      <div className="task-side">
        <label className="task-due">
          Срок
          {editing ? (
            <input
              type="date"
              value={task.dueDate}
              onChange={(e) => onUpdate(task.id, { dueDate: e.target.value })}
            />
          ) : (
            <span className="task-due-static">{formatDate(task.dueDate)}</span>
          )}
        </label>
        {overdue ? <span className="task-flag">просрочено</span> : null}
        {isAdmin && (
          <div className="task-actions">
            {editing ? (
              <button type="button" className="primary-button" onClick={() => setEditing(false)}>
                Готово
              </button>
            ) : (
              <button type="button" className="clear-button" onClick={() => setEditing(true)}>
                ✎ Изменить
              </button>
            )}
            <button type="button" className="primary-button" onClick={() => onComplete(task.id)}>
              Выполнить
            </button>
            <button type="button" className="delete-button" onClick={() => onRemove(task.id)}>
              Удалить
            </button>
          </div>
        )}
      </div>
    </article>
  );
}
