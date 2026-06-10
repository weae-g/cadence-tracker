import { useEffect, useMemo, useState } from 'react';
import { Task } from './types';
import { defaultTask, loadTasks, saveTasks, today } from './storage';
import { MonthlyReport } from './MonthlyReport';

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

export function Tasks({ isAdmin }: { isAdmin: boolean }) {
  const [tasks, setTasks] = useState<Task[]>(() => loadTasks());
  const [newTask, setNewTask] = useState<Task>(() => defaultTask());
  const [monthFilter, setMonthFilter] = useState('Все');
  const [mode, setMode] = useState<'list' | 'report'>('list');
  const [reportMonth, setReportMonth] = useState(() => today().slice(0, 7));

  useEffect(() => {
    saveTasks(tasks);
  }, [tasks]);

  // Месяцы для отчёта: из сроков и дат выполнения, плюс текущий месяц.
  const reportMonths = useMemo(() => {
    const set = new Set<string>([today().slice(0, 7)]);
    tasks.forEach((t) => {
      if (t.dueDate) set.add(t.dueDate.slice(0, 7));
      if (t.completedDate) set.add(t.completedDate.slice(0, 7));
    });
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [tasks]);

  const monthName = (key: string) => {
    const date = new Date(`${key}-01`);
    if (Number.isNaN(date.getTime())) return key;
    const label = date.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
    return label.charAt(0).toUpperCase() + label.slice(1);
  };

  const active = useMemo(
    () => tasks.filter((t) => !t.done).sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    [tasks],
  );
  const completed = useMemo(
    () => tasks.filter((t) => t.done).sort((a, b) => b.completedDate.localeCompare(a.completedDate)),
    [tasks],
  );

  const monthOptions = useMemo(
    () => Array.from(new Set(active.map((t) => monthKey(t.dueDate)).filter(Boolean))).sort(),
    [active],
  );

  const filteredActive = useMemo(
    () => (monthFilter === 'Все' ? active : active.filter((t) => monthKey(t.dueDate) === monthFilter)),
    [active, monthFilter],
  );

  const addTask = () => {
    if (!newTask.title.trim()) return;
    setTasks((prev) => [newTask, ...prev]);
    setNewTask(defaultTask());
  };

  const updateTask = (id: string, partial: Partial<Task>) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...partial } : t)));
  };

  const completeTask = (id: string) => updateTask(id, { done: true, completedDate: today() });
  const reopenTask = (id: string) => updateTask(id, { done: false, completedDate: '' });
  const removeTask = (id: string) => setTasks((prev) => prev.filter((t) => t.id !== id));

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
          <MonthlyReport tasks={tasks} month={reportMonth} />
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
          <fieldset className="task-fieldset" disabled={!isAdmin}>
            <div className="task-list">
              {filteredActive.map((task) => {
                const overdue = !!task.dueDate && task.dueDate < todayStr;
                return (
                  <article key={task.id} className={overdue ? 'task-row overdue' : 'task-row'}>
                    <div className="task-main">
                      <input
                        className="task-title"
                        value={task.title}
                        onChange={(e) => updateTask(task.id, { title: e.target.value })}
                        placeholder="Название задачи"
                      />
                      <textarea
                        className="task-desc"
                        rows={2}
                        value={task.description}
                        onChange={(e) => updateTask(task.id, { description: e.target.value })}
                        placeholder="Описание"
                      />
                    </div>
                    <div className="task-side">
                      <label className="task-due">
                        Срок
                        <input
                          type="date"
                          value={task.dueDate}
                          onChange={(e) => updateTask(task.id, { dueDate: e.target.value })}
                        />
                      </label>
                      {overdue ? <span className="task-flag">просрочено</span> : null}
                      {isAdmin && (
                        <div className="task-actions">
                          <button type="button" className="primary-button" onClick={() => completeTask(task.id)}>
                            Выполнить
                          </button>
                          <button type="button" className="delete-button" onClick={() => removeTask(task.id)}>
                            Удалить
                          </button>
                        </div>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </fieldset>
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
