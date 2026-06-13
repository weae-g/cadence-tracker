import { useMemo } from 'react';
import { Item, stageColor } from './types';
import { loadInteractions, loadTasks, today, ProjectMeta } from './storage';
import { DocMeta, formatSize } from './docs';
import { BarChart, KpiRow, TrendChart, countBy, trendFromDates } from './charts';
import { Section } from './GlobalSearch';
import { computeAttention } from './attention';

const ONE_DAY = 24 * 60 * 60 * 1000;

function parseDate(value: string): Date | null {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Срок ожидания письма, дн. — тот же расчёт, что в таблице писем.
function waitDays(item: Item): number | null {
  const start = parseDate(item.sentDate);
  if (!start) return null;
  const end = parseDate(item.replyDate) ?? new Date();
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / ONE_DAY));
}

function fmtShort(value: string): string {
  const d = parseDate(value);
  return d ? d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }) : '—';
}

const ATTENTION_MAX = 5;

// Одна кликабельная строка в панели «Требует внимания».
function AttentionRow({
  primary,
  secondary,
  meta,
  warn,
  onClick,
}: {
  primary: string;
  secondary: string;
  meta: string;
  warn?: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className="attention-row" onClick={onClick}>
      <span className="attention-row-main">
        <span className="attention-row-primary">{primary}</span>
        <span className="attention-row-secondary">{secondary}</span>
      </span>
      <span className={warn ? 'attention-row-meta warn' : 'attention-row-meta'}>{meta}</span>
    </button>
  );
}

// Стартовая сводка по всем разделам: ключевые показатели и основные диаграммы
// на одной странице. Взаимодействия и задачи берём из хранилища (снимок при входе).
export function Dashboard({
  items,
  stages,
  docs,
  project,
  projectMeta,
  overdueDays,
  onOpenLetter,
  onJump,
}: {
  items: Item[];
  stages: string[];
  docs: DocMeta[];
  project: string;
  projectMeta: ProjectMeta;
  overdueDays: number;
  onOpenLetter: (id: string) => void;
  onJump: (section: Section) => void;
}) {
  // «Требует внимания»: что нужно сделать прямо сейчас.
  //  • Запланированный «следующий шаг» наступил (дата ≤ сегодня) — высший приоритет.
  //  • Письмо без ответа просрочено И без запланированного шага (план «снимает» письмо
  //    отсюда до нужной даты — чтобы список не превращался в шум).
  //  • Задача не выполнена и срок уже подошёл.
  const attention = useMemo(
    () => computeAttention(items, loadTasks(), overdueDays, project),
    [items, project, overdueDays],
  );

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

  const todayStr = today();

  return (
    <>
      {attention.total > 0 ? (
        <section className="card attention-card">
          <div className="attention-head">
            <h2>Требует внимания</h2>
            <span className="attention-total">{attention.total}</span>
          </div>
          <p className="hint">
            Письма без ответа дольше {overdueDays} дн. и дела, у которых подошёл срок. Задайте письму «следующий
            шаг» — и оно уйдёт отсюда до нужной даты.
          </p>
          <div className="attention-groups">
            {attention.waiting.length ? (
              <div className="attention-group">
                <div className="attention-group-head">
                  Ждут ответа — пора напомнить <span className="stages-count">{attention.waiting.length}</span>
                </div>
                {attention.waiting.slice(0, ATTENTION_MAX).map((i) => (
                  <AttentionRow
                    key={i.id}
                    primary={i.counterparty.trim() || 'Без контрагента'}
                    secondary={i.subject || i.topic || 'Без темы'}
                    meta={`${waitDays(i) ?? '—'} дн.`}
                    warn
                    onClick={() => onOpenLetter(i.id)}
                  />
                ))}
                {attention.waiting.length > ATTENTION_MAX ? (
                  <div className="attention-more">…ещё {attention.waiting.length - ATTENTION_MAX}</div>
                ) : null}
              </div>
            ) : null}

            {attention.nextSteps.length ? (
              <div className="attention-group">
                <div className="attention-group-head">
                  Запланированный шаг наступил <span className="stages-count">{attention.nextSteps.length}</span>
                </div>
                {attention.nextSteps.slice(0, ATTENTION_MAX).map((i) => (
                  <AttentionRow
                    key={i.id}
                    primary={i.counterparty.trim() || 'Без контрагента'}
                    secondary={i.subject || i.topic || 'Без темы'}
                    meta={`шаг ${fmtShort(i.nextActionDate)}`}
                    warn={i.nextActionDate < todayStr}
                    onClick={() => onOpenLetter(i.id)}
                  />
                ))}
                {attention.nextSteps.length > ATTENTION_MAX ? (
                  <div className="attention-more">…ещё {attention.nextSteps.length - ATTENTION_MAX}</div>
                ) : null}
              </div>
            ) : null}

            {attention.tasks.length ? (
              <div className="attention-group">
                <div className="attention-group-head">
                  Задачи: срок подошёл <span className="stages-count">{attention.tasks.length}</span>
                </div>
                {attention.tasks.slice(0, ATTENTION_MAX).map((t) => (
                  <AttentionRow
                    key={t.id}
                    primary={t.title || 'Без названия'}
                    secondary="задача"
                    meta={`срок ${fmtShort(t.dueDate)}`}
                    warn={t.dueDate < todayStr}
                    onClick={() => onJump('tasks')}
                  />
                ))}
                {attention.tasks.length > ATTENTION_MAX ? (
                  <div className="attention-more">…ещё {attention.tasks.length - ATTENTION_MAX}</div>
                ) : null}
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

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
    </>
  );
}
