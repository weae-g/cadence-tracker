import { useMemo } from 'react';
import { Item, stageColor } from './types';
import { loadInteractions, loadTasks, today, ProjectMeta } from './storage';
import { DocMeta, formatSize } from './docs';
import { BarChart, KpiRow, TrendChart, countBy, trendFromDates } from './charts';

// Стартовая сводка по всем разделам: ключевые показатели и основные диаграммы
// на одной странице. Взаимодействия и задачи берём из хранилища (снимок при входе).
export function Dashboard({
  items,
  stages,
  docs,
  project,
  projectMeta,
}: {
  items: Item[];
  stages: string[];
  docs: DocMeta[];
  project: string;
  projectMeta: ProjectMeta;
}) {
  const data = useMemo(() => {
    const inProj = (p: string) => project === '' || p === project;
    const scopedItems = items.filter((i) => inProj(i.project));
    const scopedDocs = docs.filter((d) => inProj(d.project));
    const tasks = loadTasks().filter((t) => inProj(t.project));
    const interactions = loadInteractions().filter((i) => inProj(i.project));
    const todayStr = today();

    const replied = scopedItems.filter((i) => i.replyDate).length;
    const replyRate = scopedItems.length ? Math.round((replied / scopedItems.length) * 100) : 0;

    const doneTasks = tasks.filter((t) => t.done).length;
    const openTasks = tasks.filter((t) => !t.done);
    const overdueTasks = openTasks.filter((t) => !!t.dueDate && t.dueDate < todayStr).length;

    const docsSize = scopedDocs.reduce((sum, d) => sum + (d.size || 0), 0);

    const statusBars = stages
      .map((stage, i) => ({ label: stage, value: scopedItems.filter((it) => it.status === stage).length, color: stageColor(i) }))
      .filter((b) => b.value > 0);

    return {
      lettersTotal: scopedItems.length,
      replied,
      replyRate,
      counterparties: new Set(scopedItems.map((i) => i.counterparty.trim() || 'Без контрагента')).size,
      tasksTotal: tasks.length,
      doneTasks,
      openTasks: openTasks.length,
      overdueTasks,
      interactionsTotal: interactions.length,
      docsTotal: scopedDocs.length,
      docsSize,
      statusBars,
      sentTrend: trendFromDates(scopedItems.map((i) => i.sentDate)),
      taskBars: [
        { label: 'Выполнено', value: doneTasks, color: '#10b981' },
        { label: 'В работе', value: openTasks.length - overdueTasks, color: '#3b82f6' },
        { label: 'Просрочено', value: overdueTasks, color: '#ef4444' },
      ].filter((b) => b.value > 0),
      kindBars: countBy(interactions, (i) => i.kind, 'Без типа').map((d, i) => ({ ...d, color: stageColor(i) })),
    };
  }, [items, stages, docs, project]);

  // Сравнение проектов: KPI каждого проекта рядом (без учёта активного фильтра).
  const comparison = useMemo(() => {
    const tasks = loadTasks();
    const interactions = loadInteractions();
    const todayStr = today();
    const names = new Set<string>();
    items.forEach((i) => names.add(i.project || ''));
    tasks.forEach((t) => names.add(t.project || ''));
    interactions.forEach((i) => names.add(i.project || ''));
    docs.forEach((d) => names.add(d.project || ''));
    return [...names]
      .filter((n) => n === '' || !projectMeta[n]?.archived)
      .map((name) => {
        const li = items.filter((i) => (i.project || '') === name);
        const replied = li.filter((i) => i.replyDate).length;
        const tk = tasks.filter((t) => (t.project || '') === name);
        const openTk = tk.filter((t) => !t.done);
        const overdue = openTk.filter((t) => !!t.dueDate && t.dueDate < todayStr).length;
        const inter = interactions.filter((i) => (i.project || '') === name).length;
        const dc = docs.filter((d) => (d.project || '') === name).length;
        return {
          name: name || '(без проекта)',
          color: name ? projectMeta[name]?.color : undefined,
          letters: li.length,
          replyRate: li.length ? Math.round((replied / li.length) * 100) : 0,
          openTasks: openTk.length,
          overdue,
          interactions: inter,
          docs: dc,
          total: li.length + tk.length + inter + dc,
        };
      })
      .filter((r) => r.total > 0)
      .sort((a, b) => b.letters - a.letters || b.total - a.total);
  }, [items, docs, projectMeta]);

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

          {comparison.length > 1 ? (
            <div className="compare-wrap">
              <h3 className="compare-title">Сравнение проектов</h3>
              <div className="compare-scroll">
                <table className="compare-table">
                  <thead>
                    <tr>
                      <th>Проект</th>
                      <th>Писем</th>
                      <th>% ответов</th>
                      <th>Активн. задач</th>
                      <th>Просрочено</th>
                      <th>Взаимод.</th>
                      <th>Док-тов</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparison.map((r) => (
                      <tr key={r.name}>
                        <td>
                          <span className="compare-dot" style={{ background: r.color || '#cbd5e1' }} />
                          {r.name}
                        </td>
                        <td>{r.letters}</td>
                        <td>{r.replyRate}%</td>
                        <td>{r.openTasks}</td>
                        <td className={r.overdue ? 'compare-warn' : undefined}>{r.overdue}</td>
                        <td>{r.interactions}</td>
                        <td>{r.docs}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
