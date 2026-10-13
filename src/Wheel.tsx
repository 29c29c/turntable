import { useId } from 'react';
import { ArrowUpRight, LockKeyhole } from 'lucide-react';
import type { Item } from './api';
import { colors } from './api';

export default function Wheel({
  items,
  rotation,
  spinning,
  locked,
  disabled,
  onDraw,
}: {
  items: Item[];
  rotation: number;
  spinning: boolean;
  locked: boolean;
  disabled: boolean;
  onDraw: () => void;
}) {
  const id = useId();
  const pool = items.length
    ? items
    : [
        { title: '读几页书', color: colors[0] },
        { title: '动一动', color: colors[1] },
        { title: '练习一点', color: colors[2] },
        { title: '写下想法', color: colors[3] },
        { title: '学点新东西', color: colors[4] },
        { title: '留给自己', color: colors[5] },
      ];
  const angle = 360 / pool.length;
  const point = (degrees: number, radius: number) => [
    240 + radius * Math.cos((degrees * Math.PI) / 180),
    240 + radius * Math.sin((degrees * Math.PI) / 180),
  ];
  return (
    <div className={`wheel-stage ${!items.length ? 'wheel-empty' : ''}`}>
      <div className="wheel-spark spark-a">✦</div>
      <div className="wheel-spark spark-b">✧</div>
      <div className="wheel-pointer" aria-hidden="true" />
      <svg
        className="wheel-svg"
        viewBox="0 0 480 480"
        role="img"
        aria-label={`今日任务转盘，${items.length}项待办`}
      >
        <defs>
          <filter id={id} x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="6" stdDeviation="8" floodColor="#384335" floodOpacity=".06" />
          </filter>
        </defs>
        <circle cx="240" cy="240" r="235" fill="white" filter={`url(#${id})`} />
        <g
          className={`wheel-sectors ${spinning ? 'is-spinning' : ''}`}
          style={{ transform: `rotate(${rotation}deg)`, transformOrigin: '240px 240px' }}
        >
          {pool.map((item, index) => {
            const start = -90 + index * angle,
              end = start + angle,
              middle = start + angle / 2;
            const a = point(start, 221),
              b = point(end, 221),
              label = point(middle, 150);
            const title =
              pool.length > 12
                ? String(index + 1)
                : item.title.length > 8
                  ? `${item.title.slice(0, 7)}…`
                  : item.title;
            return (
              <g key={index}>
                <title>{item.title}</title>
                {pool.length === 1 ? (
                  <circle cx="240" cy="240" r="221" fill={item.color} />
                ) : (
                  <path
                    d={`M 240 240 L ${a.join(' ')} A 221 221 0 ${angle > 180 ? 1 : 0} 1 ${b.join(' ')} Z`}
                    fill={item.color}
                    stroke="white"
                    strokeWidth="3"
                  />
                )}
                <text
                  x={label[0]}
                  y={label[1]}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  transform={`rotate(${middle + 90},${label.join(',')})`}
                >
                  {title}
                </text>
              </g>
            );
          })}
        </g>
        <circle cx="240" cy="240" r="77" fill="white" stroke="#f2f3ee" strokeWidth="5" />
      </svg>
      <button
        className="wheel-center"
        onClick={onDraw}
        disabled={disabled || spinning || locked}
        aria-label="随机抽取今日任务"
      >
        {locked ? <LockKeyhole size={24} /> : <ArrowUpRight size={27} />}
        <strong>{spinning ? '转动中…' : locked ? '专注这一件' : '转个开始'}</strong>
        <span>{spinning ? '好事即将发生' : locked ? '完成后再抽取' : '让随机替你决定'}</span>
      </button>
    </div>
  );
}
