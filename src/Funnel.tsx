import { useMemo } from 'react';
import { Item, stageColor } from './types';

type Props = { items: Item[]; stages: string[] };

type Transition = { from: string; to: string; count: number };

const W = 920;
const H = 320;
const PAD_X = 90;
const MID_Y = 150;
const NODE_W = 18;

export function Funnel({ items, stages }: Props) {
  const { nodes, colorOf, throughput, transitions, maxThroughput, maxLink, totalTransitions } = useMemo(() => {
    const through = new Map<string, number>(); // сколько записей побывало на стадии
    const links = new Map<string, number>(); // переходы from->to

    items.forEach((item) => {
      const events = [...item.history].sort((a, b) => a.at.localeCompare(b.at));
      const seen = new Set<string>();
      events.forEach((event, i) => {
        if (!seen.has(event.stage)) {
          through.set(event.stage, (through.get(event.stage) ?? 0) + 1);
          seen.add(event.stage);
        }
        if (i > 0) {
          const key = `${events[i - 1].stage}|${event.stage}`;
          links.set(key, (links.get(key) ?? 0) + 1);
        }
      });
    });

    // Узлы = заданные стадии + любые «осиротевшие» стадии из истории (переименованные/удалённые),
    // чтобы данные никогда не терялись на диаграмме.
    const orphan = Array.from(through.keys()).filter((s) => !stages.includes(s));
    const orderedNodes = [...stages, ...orphan];
    const indexOf = new Map(orderedNodes.map((s, i) => [s, i] as const));

    const transitionList: Transition[] = Array.from(links.entries())
      .map(([key, count]) => {
        const [from, to] = key.split('|');
        return { from, to, count };
      })
      .sort((a, b) => b.count - a.count);

    return {
      nodes: orderedNodes,
      colorOf: (stage: string) => stageColor(indexOf.get(stage) ?? orderedNodes.length),
      throughput: through,
      transitions: transitionList,
      maxThroughput: Math.max(1, ...through.values()),
      maxLink: Math.max(1, ...transitionList.map((t) => t.count)),
      totalTransitions: transitionList.reduce((sum, t) => sum + t.count, 0),
    };
  }, [items, stages]);

  if (items.length === 0) {
    return <p className="empty-state">Здесь пока нет данных для воронки.</p>;
  }

  const colX = (index: number) => (nodes.length <= 1 ? PAD_X : PAD_X + ((W - 2 * PAD_X) * index) / (nodes.length - 1));
  const indexOfNode = (stage: string) => {
    const i = nodes.indexOf(stage);
    return i === -1 ? nodes.length : i;
  };

  const nodeHeight = (stage: string) => {
    const t = throughput.get(stage) ?? 0;
    if (t === 0) return 18;
    return Math.max(28, (t / maxThroughput) * 200);
  };

  return (
    <div className="funnel-card">
      <div className="gantt-header">
        <h3>Воронка переходов</h3>
        <span>
          {totalTransitions === 0
            ? 'Переходов между стадиями пока не было'
            : `${totalTransitions} переходов между стадиями`}
        </span>
      </div>

      <div className="funnel-visual">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMinYMin meet">
          {/* связи-переходы (в т.ч. возвраты назад) */}
          {transitions.map((link) => {
            const si = indexOfNode(link.from);
            const ti = indexOfNode(link.to);
            const x1 = colX(si) + NODE_W / 2;
            const x2 = colX(ti) - NODE_W / 2;
            const span = Math.abs(ti - si);
            // изгиб: вперёд — вверх, назад — вниз; чем дальше прыжок, тем сильнее
            const bow = (ti >= si ? -1 : 1) * (8 + span * 14);
            const cx1 = x1 + (x2 - x1) * 0.4;
            const cx2 = x1 + (x2 - x1) * 0.6;
            const midX = (x1 + x2) / 2;
            const midY = MID_Y + bow / 2;
            return (
              <g key={`${link.from}-${link.to}`}>
                <path
                  d={`M ${x1} ${MID_Y} C ${cx1} ${MID_Y + bow} ${cx2} ${MID_Y + bow} ${x2} ${MID_Y}`}
                  fill="none"
                  stroke={colorOf(link.from)}
                  strokeWidth={Math.max(2, (link.count / maxLink) * 24)}
                  strokeOpacity={0.55}
                  strokeLinecap="round"
                />
                <text x={midX} y={midY - 4} textAnchor="middle" fontSize="11" fill="#475569">
                  {link.count}
                </text>
              </g>
            );
          })}

          {/* узлы-стадии */}
          {nodes.map((stage, index) => {
            const h = nodeHeight(stage);
            const x = colX(index);
            const count = throughput.get(stage) ?? 0;
            return (
              <g key={stage}>
                <rect x={x - NODE_W / 2} y={MID_Y - h / 2} width={NODE_W} height={h} rx={6} fill={colorOf(stage)} />
                <text x={x} y={MID_Y - h / 2 - 10} textAnchor="middle" fontSize="13" fontWeight="600" fill="#111827">
                  {stage}
                </text>
                <text x={x} y={MID_Y + h / 2 + 18} textAnchor="middle" fontSize="12" fill="#475569">
                  {count}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
