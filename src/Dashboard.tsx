import { useMemo } from 'react';
import { Item, stageColor } from './types';
import { loadInteractions, loadTasks, today } from './storage';
import { DocMeta, formatSize } from './docs';
import { BarChart, KpiRow, TrendChart, countBy, trendFromDates } from './charts';

// Стартовая сводка по всем разделам: ключевые показатели и основные диаграммы
// на одной странице. Взаимодействия и задачи берём из хранилища (снимок при входе).
export function Dashboard({ items, stages, docs }: { items: Item[]; stages: string[]; docs: DocMeta[] }) {
  const data = useMemo(() => {
    const tasks = loadTasks();
    const interactions = loadInteractions();
    const todayStr = today();

    const replied = items.filter((i) => i.replyDate).length;
    const replyRate = items.length ? Math.round((replied / items.length) * 100) : 0;

    const doneTasks = tasks.filter((t) => t.done).length;
    const openTasks = tasks.filter((t) => !t.done);
    const overdueTasks = openTasks.filter((t) => !!t.dueDate && t.dueDate < todayStr).length;

    const docsSize = docs.reduce((sum, d) => sum + (d.size || 0), 0);

    const statusBars = stages
      .map((stage, i) => ({ label: stage, value: items.filter((it) => it.status === stage).length, color: stageColor(i) }))
      .filter((b) => b.value > 0);

    return {
      lettersTotal: items.length,
      replied,
      replyRate,
      counterparties: new Set(items.map((i) => i.counterparty.trim() || 'Без контрагента')).size,
      tasksTotal: tasks.length,
      doneTasks,
      openTasks: openTasks.length,
      overdueTasks,
      interactionsTotal: interactions.length,
      docsTotal: docs.length,
      docsSize,
      statusBars,
      sentTrend: trendFromDates(items.map((i) => i.sentDate)),
      taskBars: [
        { label: 'Выполнено', value: doneTasks, color: '#10b981' },
        { label: 'В работе', value: openTasks.length - overdueTasks, color: '#3b82f6' },
        { label: 'Просрочено', value: overdueTasks, color: '#ef4444' },
      ].filter((b) => b.value > 0),
      kindBars: countBy(interactions, (i) => i.kind, 'Без типа').map((d, i) => ({ ...d, color: stageColor(i) })),
    };
  }, [items, stages, docs]);

  const empty =
    data.lettersTotal === 0 && data.tasksTotal === 0 && data.interactionsTotal === 0 && data.docsTotal === 0;

  return (
    <section className="card">
      <h2>Сводка</h2>
      {empty ? (
        <p className="empty-state">Данных пока нет — добавьте письма, задачи или взаимодействия.</p>
      ) : (
        <>
          <KpiRow
            items={[
              { label: 'Писем', value: data.lettersTotal },
              { label: 'Ответов', value: `${data.replyRate}%`, tone: 'ok' },
              { label: 'Контрагентов', value: data.counterparties, tone: 'accent' },
              { label: 'Активных задач', value: data.openTasks },
              { label: 'Просрочено', value: data.overdueTasks, tone: 'warn' },
              { label: 'Взаимодействий', value: data.interactionsTotal },
              { label: 'Документов', value: data.docsTotal },
              { label: 'Объём файлов', value: formatSize(data.docsSize), tone: 'accent' },
            ]}
          />
          <div className="charts-grid">
            <BarChart title="Письма по статусам" data={data.statusBars} empty="Писем нет." />
            <TrendChart title="Письма по месяцам" subtitle="по дате отправки" data={data.sentTrend} color="#3b82f6" />
            <BarChart title="Задачи" data={data.taskBars} empty="Задач нет." />
            <BarChart title="Взаимодействия по типам" data={data.kindBars} empty="Взаимодействий нет." />
          </div>
        </>
      )}
    </section>
  );
}
