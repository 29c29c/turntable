import { useEffect, useState } from 'react';
import { ArrowUpRight, CalendarDays, CheckCheck, Clock3, Flame } from 'lucide-react';
import { api, minutes, type Stats as StatsData } from './api';

const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
export default function Stats() {
  const [period, setPeriod] = useState<'month' | 'year'>('month'),
    [year, setYear] = useState(now.getFullYear()),
    [month, setMonth] = useState(now.getMonth() + 1);
  const [stats, setStats] = useState<StatsData | null>(null),
    [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    setError('');
    setStats(null);
    api<StatsData>(`/stats?year=${year}${period === 'month' ? `&month=${month}` : ''}`)
      .then((result) => {
        if (alive) setStats(result);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [year, month, period]);
  const count = period === 'month' ? new Date(year, month, 0).getDate() : 12;
  const buckets = Array.from({ length: count }, (_, i) => {
    const prefix =
      period === 'month'
        ? `${year}-${String(month).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`
        : `${year}-${String(i + 1).padStart(2, '0')}`;
    const days = stats?.days.filter((d) => d.date.startsWith(prefix)) ?? [];
    return {
      label: String(i + 1),
      completed: days.reduce((s, d) => s + d.completed, 0),
      seconds: days.reduce((s, d) => s + d.seconds, 0),
    };
  });
  const max = Math.max(3, ...buckets.map((b) => b.completed));
  const totalDistribution = stats?.distribution.reduce((s, d) => s + d.seconds, 0) ?? 0;
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>
            小小进步，也算数<span className="heading-dot">.</span>
          </h1>
          <p>每一件完成的事，每一分钟投入，都在慢慢积累。</p>
        </div>
        <div className="period-controls">
          <div className="tabs compact">
            <button
              className={period === 'month' ? 'selected' : ''}
              onClick={() => setPeriod('month')}
            >
              月度
            </button>
            <button
              className={period === 'year' ? 'selected' : ''}
              onClick={() => setPeriod('year')}
            >
              年度
            </button>
          </div>
          <select aria-label="统计年份" value={year} onChange={(e) => setYear(+e.target.value)}>
            {Array.from(
              { length: Math.max(5, now.getFullYear() - 2020 + 1) },
              (_, i) => now.getFullYear() - i,
            ).map((y) => (
              <option key={y}>{y}</option>
            ))}
          </select>
          {period === 'month' && (
            <select aria-label="统计月份" value={month} onChange={(e) => setMonth(+e.target.value)}>
              {Array.from({ length: 12 }, (_, i) => (
                <option key={i} value={i + 1}>
                  {i + 1} 月
                </option>
              ))}
            </select>
          )}
        </div>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!stats && !error ? (
        <div className="loading-inline">正在整理你的小小进步…</div>
      ) : (
        stats && (
          <>
            <div className="stats-band">
              <div>
                <CheckCheck size={20} />
                <span>完成任务</span>
                <strong>
                  {stats.totals.completed}
                  <small> 件</small>
                </strong>
              </div>
              <div>
                <Clock3 size={20} />
                <span>投入时间</span>
                <strong>
                  {Math.floor(stats.totals.seconds / 60)}
                  <small> 分钟</small>
                </strong>
              </div>
              <div>
                <CalendarDays size={20} />
                <span>活跃天数</span>
                <strong>
                  {stats.totals.activeDays}
                  <small> 天</small>
                </strong>
              </div>
              <div>
                <Flame size={20} />
                <span>当前连续活跃</span>
                <strong>
                  {stats.totals.activeStreak}
                  <small> 天</small>
                </strong>
              </div>
            </div>
            <section className="trend-section">
              <div className="section-heading">
                <div>
                  <h2>行动留下的痕迹</h2>
                  <p className="muted">
                    {year} 年{period === 'month' ? ` ${month} 月` : ''} · 每
                    {period === 'month' ? '天' : '月'}完成任务数
                  </p>
                </div>
                <span className="chart-legend">
                  <i />
                  完成任务
                </span>
              </div>
              <div className="chart-scroll">
                <svg
                  viewBox="0 0 900 235"
                  className="trend-chart"
                  role="img"
                  aria-label={`${period === 'month' ? '每日' : '每月'}完成任务趋势`}
                >
                  {[0, 1, 2, 3].map((i) => (
                    <g key={i}>
                      <line
                        x1="30"
                        x2="880"
                        y1={190 - i * 55}
                        y2={190 - i * 55}
                        stroke="#e8ece7"
                        strokeDasharray={i ? '4 5' : undefined}
                      />
                      <text x="18" y={194 - i * 55} textAnchor="end">
                        {Math.round((max * i) / 3)}
                      </text>
                    </g>
                  ))}
                  {buckets.map((b, i) => {
                    const width = 830 / count,
                      h = (b.completed / max) * 165;
                    return (
                      <g key={i}>
                        <rect
                          x={40 + i * width}
                          y={190 - Math.max(h, 3)}
                          width={width * 0.56}
                          height={Math.max(h, 3)}
                          rx="4"
                          fill={b.completed ? '#8daa85' : '#e9ede6'}
                        >
                          <title>
                            {b.label}
                            {period === 'month' ? '日' : '月'}：{b.completed}件，
                            {minutes(b.seconds)}
                          </title>
                        </rect>
                        {(count <= 12 || i % 3 === 0 || i === count - 1) && (
                          <text x={40 + i * width + width * 0.28} y="218" textAnchor="middle">
                            {b.label}
                            {period === 'year' ? '月' : ''}
                          </text>
                        )}
                      </g>
                    );
                  })}
                </svg>
              </div>
            </section>
            <div className="stats-bottom">
              <section>
                <div className="section-heading">
                  <h2>时间花在哪里</h2>
                  <ArrowUpRight size={18} />
                </div>
                {stats.distribution.length ? (
                  stats.distribution.map((d) => (
                    <div className="distribution-row" key={d.taskId}>
                      <div>
                        <span className="task-color" style={{ background: d.color }} />
                        <strong>{d.title}</strong>
                        <span>{minutes(d.seconds)}</span>
                      </div>
                      <div className="distribution-track">
                        <i
                          style={{
                            background: d.color,
                            width: `${totalDistribution ? (d.seconds / totalDistribution) * 100 : 0}%`,
                          }}
                        />
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="empty-copy">开始第一件事后，时间就会在这里留下痕迹。</p>
                )}
              </section>
              <section className="goal-summary">
                <h2>按自己的节奏</h2>
                <p>
                  连续达标 <strong>{stats.totals.goalStreak}</strong> 天
                </p>
                <p>
                  本期达标 <strong>{stats.totals.achievedDays}</strong> / {stats.totals.goalDays} 天
                </p>
                <div className="goal-track">
                  <i
                    style={{
                      width: `${stats.totals.goalDays ? (stats.totals.achievedDays / stats.totals.goalDays) * 100 : 0}%`,
                    }}
                  />
                </div>
                <small>
                  {stats.totals.goalDays
                    ? `达标率 ${Math.round((stats.totals.achievedDays / stats.totals.goalDays) * 100)}%`
                    : '设置一个温和的目标，明天开始记录。'}
                  <br />
                  至少完成一件，就是活跃的一天。
                </small>
              </section>
            </div>
            <section className="history-section">
              <div className="section-heading">
                <h2>那些开始过的事</h2>
                <span className="muted">本期历史 · {stats.history.length} 条</span>
              </div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>日期</th>
                      <th>任务</th>
                      <th>投入时间</th>
                      <th>状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.history.map((h) => (
                      <tr key={h.id}>
                        <td>{h.date}</td>
                        <td>
                          <span className="task-color" style={{ background: h.color }} />
                          {h.title}
                        </td>
                        <td>{minutes(h.seconds)}</td>
                        <td>
                          <span className={`status-tag ${h.status === 'COMPLETED' ? 'done' : ''}`}>
                            {
                              (
                                {
                                  COMPLETED: '已完成',
                                  RUNNING: '进行中',
                                  PAUSED: '已暂停',
                                  EXPIRED: '未完成',
                                  PENDING: '未开始',
                                } as Record<string, string>
                              )[h.status]
                            }
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!stats.history.length && (
                  <p className="empty-copy">还没有记录。今天，先开始一件吧。</p>
                )}
              </div>
            </section>
          </>
        )
      )}
    </>
  );
}
