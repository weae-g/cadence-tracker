// Переиспользуемые диаграммы и контрол выбора периода («участка»).
// Намеренно лёгкие, на чистом DOM/SVG: без внешних библиотек, всё умещается
// по ширине карточки и одинаково выглядит во всех разделах.

import { ReactNode } from 'react';
import { today } from './storage';

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
  return (
    <div className="chart-card">
      <div className="chart-head">
        <h3>{title}</h3>
        {subtitle ? <span>{subtitle}</span> : null}
      </div>
      {data.length === 0 ? (
        <p className="empty-state">{empty}</p>
      ) : (
        <div className="bar-list">
          {data.map((d) => (
            <div key={d.label} className="bar-row">
              <span className="bar-label" title={d.label}>
                {d.label}
              </span>
              <div className="bar-track">
                <div
                  className="bar-fill"
                  style={{ width: `${(d.value / max) * 100}%`, background: d.color ?? '#3b82f6' }}
                />
              </div>
              <span className="bar-value">{d.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
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
    <div className="chart-card">
      <div className="chart-head">
        <h3>{title}</h3>
        {subtitle ? <span>{subtitle}</span> : null}
      </div>
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
    </div>
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
