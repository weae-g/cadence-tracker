import { useMemo } from 'react';
import { Task } from './types';
import { today } from './storage';

const monthKey = (date: string) => (date ? date.slice(0, 7) : '');

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('ru-RU');
}

function monthTitle(key: string) {
  const date = new Date(`${key}-01`);
  if (Number.isNaN(date.getTime())) return key;
  const label = date.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function MonthlyReport({ tasks, month }: { tasks: Task[]; month: string }) {
  const todayStr = today();

  const { completed, planned, overdue, rate } = useMemo(() => {
    const done = tasks
      .filter((t) => t.done && monthKey(t.completedDate) === month)
      .sort((a, b) => a.completedDate.localeCompare(b.completedDate));
    const open = tasks
      .filter((t) => !t.done && monthKey(t.dueDate) === month)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    const late = open.filter((t) => !!t.dueDate && t.dueDate < todayStr).length;
    const total = done.length + open.length;
    return {
      completed: done,
      planned: open,
      overdue: late,
      rate: total === 0 ? 0 : Math.round((done.length / total) * 100),
    };
  }, [tasks, month, todayStr]);

  const total = completed.length + planned.length;

  return (
    <div className="report print-area">
      <div className="report-head">
        <div>
          <h2 className="report-title">Отчёт по задачам</h2>
          <p className="report-period">{monthTitle(month)}</p>
        </div>
        <p className="report-generated">Сформирован: {formatDate(todayStr)}</p>
      </div>

      <div className="report-stats">
        <div className="report-stat">
          <span className="report-stat-value">{total}</span>
          <span className="report-stat-label">Всего задач</span>
        </div>
        <div className="report-stat ok">
          <span className="report-stat-value">{completed.length}</span>
          <span className="report-stat-label">Выполнено</span>
        </div>
        <div className="report-stat">
          <span className="report-stat-value">{planned.length}</span>
          <span className="report-stat-label">В работе</span>
        </div>
        <div className="report-stat warn">
          <span className="report-stat-value">{overdue}</span>
          <span className="report-stat-label">Просрочено</span>
        </div>
        <div className="report-stat accent">
          <span className="report-stat-value">{rate}%</span>
          <span className="report-stat-label">Выполнение</span>
        </div>
      </div>

      <section className="report-section">
        <h3 className="report-section-title">✓ Выполнено ({completed.length})</h3>
        {completed.length === 0 ? (
          <p className="empty-state">За этот месяц нет выполненных задач.</p>
        ) : (
          <ol className="report-items">
            {completed.map((task) => (
              <li key={task.id} className="report-item">
                <div className="report-item-head">
                  <span className="report-item-title">{task.title || 'Без названия'}</span>
                  <span className="report-item-date">{formatDate(task.completedDate)}</span>
                </div>
                {task.description ? <p className="report-item-desc">{task.description}</p> : null}
                {task.result ? <p className="report-item-result">Результат: {task.result}</p> : null}
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="report-section">
        <h3 className="report-section-title">○ В работе ({planned.length})</h3>
        {planned.length === 0 ? (
          <p className="empty-state">Нет задач со сроком в этом месяце.</p>
        ) : (
          <ol className="report-items">
            {planned.map((task) => {
              const late = !!task.dueDate && task.dueDate < todayStr;
              return (
                <li key={task.id} className="report-item">
                  <div className="report-item-head">
                    <span className="report-item-title">{task.title || 'Без названия'}</span>
                    <span className={late ? 'report-item-date late' : 'report-item-date'}>
                      срок {formatDate(task.dueDate)}
                      {late ? ' · просрочено' : ''}
                    </span>
                  </div>
                  {task.description ? <p className="report-item-desc">{task.description}</p> : null}
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </div>
  );
}
