// Переиспользуемые диаграммы и контрол выбора периода («участка»).
// Намеренно лёгкие, на чистом DOM/SVG: без внешних библиотек, всё умещается
// по ширине карточки и одинаково выглядит во всех разделах.

import { ReactNode, RefObject, useRef, useState } from 'react';
import { today } from './storage';
import { stageColor } from './types';

// --- Период просмотра («участок») ---

export type Range = { from: string; to: string };

export const EMPTY_RANGE: Range = { from: '', to: '' };

// Попадает ли дата (YYYY-MM-DD или ISO) в выбранный период. Пустые границы — открыты.
export function inRange(date: string, range: Range): boolean {
  if (!date) return false;
  const day = date.slice(0, 10);
  if (range.from && day < range.from) return false;
  if (range.to && day > range.to) return false;
  return true;
}

export const isRangeActive = (range: Range) => !!(range.from || range.to);

// Сдвиг от сегодня на N дней назад в формате YYYY-MM-DD.
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

// Контрол выбора периода: ручные границы + быстрые пресеты.
export function RangeFilter({ range, onChange }: { range: Range; onChange: (r: Range) => void }) {
  const presets: { label: string; days: number }[] = [
    { label: '30 дней', days: 30 },
    { label: '90 дней', days: 90 },
    { label: 'Год', days: 365 },
  ];
  return (
    <div className="range-filter">
      <span className="range-filter-title">Период</span>
      <label>
        с
        <input type="date" value={range.from} max={range.to || undefined} onChange={(e) => onChange({ ...range, from: e.target.value })} />
      </label>
      <label>
        по
        <input type="date" value={range.to} min={range.from || undefined} onChange={(e) => onChange({ ...range, to: e.target.value })} />
      </label>
      <div className="range-presets">
        {presets.map((p) => (
          <button key={p.days} type="button" className="range-chip" onClick={() => onChange({ from: daysAgo(p.days), to: today() })}>
            {p.label}
          </button>
        ))}
        <button
          type="button"
          className="range-chip"
          onClick={() => onChange(EMPTY_RANGE)}
          disabled={!isRangeActive(range)}
        >
          Всё время
        </button>
      </div>
    </div>
  );
}

// --- Карточки-показатели (KPI) ---

export function KpiRow({ items }: { items: { label: string; value: ReactNode; tone?: 'ok' | 'warn' | 'accent' }[] }) {
  return (
    <div className="kpi-row">
      {items.map((it) => (
        <div key={it.label} className={it.tone ? `kpi kpi-${it.tone}` : 'kpi'}>
          <span className="kpi-value">{it.value}</span>
          <span className="kpi-label">{it.label}</span>
        </div>
      ))}
    </div>
  );
}

// --- Карточка диаграммы (общая обёртка) + скачивание в PNG ---

const sanitizeName = (s: string) => (s || 'диаграмма').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'диаграмма';

// Сохраняет DOM-узел как PNG. Кнопки/элементы с классом no-export в картинку не попадают.
export async function exportNodePng(node: HTMLElement, name: string): Promise<void> {
  const { toPng } = await import('html-to-image');
  const url = await toPng(node, {
    backgroundColor: '#ffffff',
    pixelRatio: 2,
    filter: (el) => !(el instanceof HTMLElement && el.classList.contains('no-export')),
  });
  const a = document.createElement('a');
  a.href = url;
  a.download = `${sanitizeName(name)}.png`;
  a.click();
}

// Кнопка скачивания PNG для произвольной карточки (по ref).
export function DownloadButton({ targetRef, name }: { targetRef: RefObject<HTMLElement>; name: string }) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (!targetRef.current) return;
    setBusy(true);
    try {
      await exportNodePng(targetRef.current, name);
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  };
  return (
    <button type="button" className="chart-dl no-export" onClick={run} disabled={busy} title="Скачать PNG">
      {busy ? '…' : '⬇'}
    </button>
  );
}

// Единая карточка диаграммы: заголовок + подзаголовок + кнопка PNG + тело.
export function ChartCard({
  title,
  subtitle,
  className,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div ref={ref} className={className ? `chart-card ${className}` : 'chart-card'}>
      <div className="chart-head">
        <div className="chart-head-titles">
          <h3>{title}</h3>
          {subtitle ? <span>{subtitle}</span> : null}
        </div>
        <DownloadButton targetRef={ref} name={title} />
      </div>
      {children}
    </div>
  );
}

// --- Горизонтальная столбчатая диаграмма (разрезы по категориям) ---

export type BarDatum = { label: string; value: number; color?: string };

export function BarChart({
  title,
  subtitle,
  data,
  empty = 'Нет данных за выбранный период.',
}: {
  title: string;
  subtitle?: ReactNode;
  data: BarDatum[];
  empty?: string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <ChartCard title={title} subtitle={subtitle}>
      {data.length === 0 ? (
        <p className="empty-state">{empty}</p>
      ) : (
        <div className="bar-list">
          {data.map((d) => {
            const pct = total ? Math.round((d.value / total) * 100) : 0;
            return (
              <div key={d.label} className="bar-row" title={`${d.label}: ${d.value} (${pct}%)`}>
                <span className="bar-label">{d.label}</span>
                <div className="bar-track">
                  <div
                    className="bar-fill"
                    style={{ width: `${(d.value / max) * 100}%`, background: d.color ?? '#3b82f6' }}
                  />
                </div>
                <span className="bar-value">{d.value}</span>
              </div>
            );
          })}
        </div>
      )}
    </ChartCard>
  );
}

// --- Столбцы по времени (динамика по месяцам) ---

export type TrendDatum = { key: string; label: string; value: number };

export function TrendChart({
  title,
  subtitle,
  data,
  color = '#3b82f6',
  empty = 'Нет данных за выбранный период.',
}: {
  title: string;
  subtitle?: ReactNode;
  data: TrendDatum[];
  color?: string;
  empty?: string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const hasData = data.some((d) => d.value > 0);
  return (
    <ChartCard title={title} subtitle={subtitle}>
      {!hasData ? (
        <p className="empty-state">{empty}</p>
      ) : (
        <div className="trend-scroll">
          <div className="trend-bars">
            {data.map((d) => (
              <div key={d.key} className="trend-col" title={`${d.label}: ${d.value}`}>
                <div className="trend-bar-wrap">
                  {d.value > 0 ? <span className="trend-num">{d.value}</span> : null}
                  <div className="trend-bar" style={{ height: `${(d.value / max) * 100}%`, background: color }} />
                </div>
                <span className="trend-x">{d.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </ChartCard>
  );
}

// --- Диаграмма Ганта (полоски на временной шкале) ---

export type GanttRow = { id: string; label: string; sub?: string; start: Date; end: Date; color?: string };

const ONE_DAY = 24 * 60 * 60 * 1000;

export function GanttChart({
  title,
  subtitle,
  rows,
  empty = 'Нет дат для построения диаграммы.',
}: {
  title: string;
  subtitle?: ReactNode;
  rows: GanttRow[];
  empty?: string;
}) {
  const min = rows.length ? Math.min(...rows.map((r) => r.start.getTime())) : 0;
  const max = rows.length ? Math.max(...rows.map((r) => r.end.getTime())) : 0;
  const totalDays = Math.max(1, Math.round((max - min) / ONE_DAY) + 1);
  const rangeLabel =
    subtitle ??
    (rows.length ? `${new Date(min).toLocaleDateString('ru-RU')} — ${new Date(max).toLocaleDateString('ru-RU')}` : undefined);
  return (
    <ChartCard title={title} subtitle={rangeLabel} className="gantt-card">
      {rows.length === 0 ? (
        <p className="empty-state">{empty}</p>
      ) : (
        <div className="gantt-chart">
          {rows.map((r) => {
            const offset = Math.max(0, Math.round((r.start.getTime() - min) / ONE_DAY));
            const duration = Math.max(1, Math.round((r.end.getTime() - r.start.getTime()) / ONE_DAY) + 1);
            const left = `${(offset / totalDays) * 100}%`;
            const width = `${(duration / totalDays) * 100}%`;
            const dates = `${r.start.toLocaleDateString('ru-RU')} — ${r.end.toLocaleDateString('ru-RU')}`;
            return (
              <div key={r.id} className="gantt-row" title={`${r.label}${r.sub ? ` · ${r.sub}` : ''}\n${dates}`}>
                <div className="gantt-label">
                  <div>{r.label}</div>
                  {r.sub ? <small>{r.sub}</small> : null}
                </div>
                <div className="gantt-bar-track">
                  <div className="gantt-bar" style={{ left, width, background: r.color }}>
                    <span>
                      {r.start.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })} —{' '}
                      {r.end.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </ChartCard>
  );
}

// --- Sankey (поток из одной категории в другую) ---

export type SankeyLink = { source: string; target: string; value: number };

export function Sankey({
  title,
  subtitle,
  links,
  sourceColor,
  empty = 'Нет данных для диаграммы.',
}: {
  title: string;
  subtitle?: ReactNode;
  links: SankeyLink[];
  sourceColor?: (name: string) => string | undefined;
  empty?: string;
}) {
  const data = links.filter((l) => l.value > 0 && l.source && l.target);
  const srcSum = new Map<string, number>();
  const tgtSum = new Map<string, number>();
  data.forEach((l) => {
    srcSum.set(l.source, (srcSum.get(l.source) ?? 0) + l.value);
    tgtSum.set(l.target, (tgtSum.get(l.target) ?? 0) + l.value);
  });
  const sources = [...srcSum.keys()].sort((a, b) => (srcSum.get(b) ?? 0) - (srcSum.get(a) ?? 0));
  const targets = [...tgtSum.keys()].sort((a, b) => (tgtSum.get(b) ?? 0) - (tgtSum.get(a) ?? 0));
  const total = data.reduce((s, l) => s + l.value, 0);

  const W = 920;
  const GAP = 10;
  const PAD_Y = 16;
  const NODE_W = 14;
  const H = Math.max(260, Math.max(sources.length, targets.length) * 28 + 2 * PAD_Y);
  const availH = H - 2 * PAD_Y;
  const leftX = 160;
  const rightX = W - 160 - NODE_W;

  const layout = (names: string[], sums: Map<string, number>) => {
    const totalGap = Math.max(0, (names.length - 1) * GAP);
    const scale = (availH - totalGap) / (total || 1);
    const pos = new Map<string, { y: number; h: number }>();
    let y = PAD_Y;
    names.forEach((n) => {
      const h = Math.max(3, (sums.get(n) ?? 0) * scale);
      pos.set(n, { y, h });
      y += h + GAP;
    });
    return { pos, scale };
  };
  const L = layout(sources, srcSum);
  const R = layout(targets, tgtSum);
  const colorOf = (name: string) => sourceColor?.(name) || stageColor(sources.indexOf(name));

  const srcIdx = new Map(sources.map((s, i) => [s, i] as const));
  const tgtIdx = new Map(targets.map((t, i) => [t, i] as const));
  const srcOff = new Map<string, number>();
  const tgtOff = new Map<string, number>();

  // два прохода: смещения слева (порядок source→target) и справа (target→source)
  const withSrc = [...data]
    .sort((a, b) => (srcIdx.get(a.source)! - srcIdx.get(b.source)!) || (tgtIdx.get(a.target)! - tgtIdx.get(b.target)!))
    .map((l) => {
      const node = L.pos.get(l.source)!;
      const off = srcOff.get(l.source) ?? 0;
      const sy0 = node.y + off;
      srcOff.set(l.source, off + l.value * L.scale);
      return { ...l, sy0, sy1: sy0 + l.value * L.scale };
    });
  const ribbons = [...withSrc]
    .sort((a, b) => (tgtIdx.get(a.target)! - tgtIdx.get(b.target)!) || (srcIdx.get(a.source)! - srcIdx.get(b.source)!))
    .map((l) => {
      const node = R.pos.get(l.target)!;
      const off = tgtOff.get(l.target) ?? 0;
      const ty0 = node.y + off;
      tgtOff.set(l.target, off + l.value * R.scale);
      return { ...l, ty0, ty1: ty0 + l.value * R.scale };
    });

  return (
    <ChartCard title={title} subtitle={subtitle ?? `${total} писем · ${sources.length}→${targets.length}`} className="sankey-card">
      {data.length === 0 ? (
        <p className="empty-state">{empty}</p>
      ) : (
        <div className="sankey-visual">
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMinYMin meet">
            {ribbons.map((l, i) => {
              const sx = leftX + NODE_W;
              const tx = rightX;
              const cm = sx + (tx - sx) * 0.5;
              const d = `M ${sx} ${l.sy0} C ${cm} ${l.sy0} ${cm} ${l.ty0} ${tx} ${l.ty0} L ${tx} ${l.ty1} C ${cm} ${l.ty1} ${cm} ${l.sy1} ${sx} ${l.sy1} Z`;
              return (
                <path key={i} className="sankey-link" d={d} fill={colorOf(l.source)} fillOpacity={0.4}>
                  <title>{`${l.source} → ${l.target}: ${l.value}`}</title>
                </path>
              );
            })}
            {sources.map((s) => {
              const n = L.pos.get(s)!;
              return (
                <g key={`s-${s}`}>
                  <rect x={leftX} y={n.y} width={NODE_W} height={n.h} rx={3} fill={colorOf(s)} />
                  <text x={leftX - 6} y={n.y + n.h / 2} textAnchor="end" dominantBaseline="middle" fontSize="12" fill="#374151">
                    {s} ({srcSum.get(s)})
                  </text>
                </g>
              );
            })}
            {targets.map((t) => {
              const n = R.pos.get(t)!;
              return (
                <g key={`t-${t}`}>
                  <rect x={rightX} y={n.y} width={NODE_W} height={n.h} rx={3} fill="#94a3b8" />
                  <text x={rightX + NODE_W + 6} y={n.y + n.h / 2} textAnchor="start" dominantBaseline="middle" fontSize="12" fill="#374151">
                    {t} ({tgtSum.get(t)})
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      )}
    </ChartCard>
  );
}

// --- Агрегации ---

// Подписи месяца: «июн 25».
export function monthShort(key: string): string {
  const date = new Date(`${key}-01`);
  if (Number.isNaN(date.getTime())) return key;
  return date.toLocaleDateString('ru-RU', { month: 'short', year: '2-digit' });
}

// Непрерывный список месяцев от самого раннего к самому позднему ключу (без пропусков),
// чтобы на графике динамики не было «дыр».
export function monthsBetween(keys: string[]): string[] {
  const valid = keys.filter(Boolean).sort();
  if (valid.length === 0) return [];
  const [sy, sm] = valid[0].split('-').map(Number);
  const [ey, em] = valid[valid.length - 1].split('-').map(Number);
  const out: string[] = [];
  let y = sy;
  let m = sm;
  // предохранитель от случайных кривых дат — не больше 10 лет месяцев
  let guard = 0;
  while ((y < ey || (y === ey && m <= em)) && guard < 121) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    guard += 1;
  }
  return out;
}

// Динамика по месяцам из набора дат (YYYY-MM-DD / ISO).
export function trendFromDates(dates: string[]): TrendDatum[] {
  const counts = new Map<string, number>();
  dates.filter(Boolean).forEach((d) => {
    const key = d.slice(0, 7);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  return monthsBetween([...counts.keys()]).map((key) => ({ key, label: monthShort(key), value: counts.get(key) ?? 0 }));
}

// Разрез по категории: счётчик значений → отсортированный по убыванию список столбцов.
export function countBy<T>(items: T[], pick: (item: T) => string, fallback = '—'): BarDatum[] {
  const counts = new Map<string, number>();
  items.forEach((item) => {
    const key = pick(item).trim() || fallback;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  return [...counts.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
}
