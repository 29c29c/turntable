import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import {
  Shuffle,
  CircleDashed,
  ListTodo,
  ChartNoAxesCombined,
  Settings2,
  LogOut,
  ShieldCheck,
  ArrowUpRight,
  Plus,
  Check,
  Pause,
  Play,
  CheckCheck,
  Clock3,
  Sparkles,
  WifiOff,
  ChevronDown,
} from 'lucide-react';
import {
  api,
  ApiError,
  clock,
  colors,
  minutes,
  setCsrf,
  type Item,
  type Task,
  type Today,
  type User,
} from './api';
import Auth from './Auth';
import Wheel from './Wheel';
import Tasks, { TaskDialog } from './Tasks';
import Settings from './Settings';
import useDialogKeyboard from './useDialogKeyboard';
const Stats = lazy(() => import('./Stats'));
const Admin = lazy(() => import('./Admin'));
type Page = 'today' | 'tasks' | 'stats' | 'settings' | 'admin';
const pages = [
  { id: 'today', label: '我的今天', Icon: CircleDashed },
  { id: 'tasks', label: '长期任务库', Icon: ListTodo },
  { id: 'stats', label: '小小进步', Icon: ChartNoAxesCombined },
  { id: 'settings', label: '个人设置', Icon: Settings2 },
] as const;

export default function App() {
  useDialogKeyboard();
  const [user, setUser] = useState<User | null>(null),
    [loading, setLoading] = useState(true),
    [bootError, setBootError] = useState('');
  const [page, setPage] = useState<Page>('today'),
    [today, setToday] = useState<Today | null>(null),
    [tasks, setTasks] = useState<Task[]>([]);
  const [toast, setToast] = useState(''),
    [offline, setOffline] = useState(false),
    [busy, setBusy] = useState(false);
  const [spinning, setSpinning] = useState(false),
    [rotation, setRotation] = useState(0),
    [wheelSnapshot, setWheelSnapshot] = useState<Item[] | null>(null);
  const [addTask, setAddTask] = useState(false),
    [showSelection, setShowSelection] = useState(false),
    [tick, setTick] = useState(Date.now());
  const receivedAt = useRef(Date.now()),
    generation = useRef(0),
    toastTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    animationTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mutationLock = useRef(false);
  const notify = useCallback((message: string) => {
    setToast(message);
    clearTimeout(toastTimeout.current);
    toastTimeout.current = setTimeout(() => setToast(''), 5500);
  }, []);
  const applyToday = useCallback((data: Today) => {
    receivedAt.current = Date.now();
    setToday(data);
  }, []);
  const refresh = useCallback(async () => {
    if (!user || user.mustChangePassword) return;
    const revision = ++generation.current;
    try {
      const [data, library, account] = await Promise.all([
        api<Today>('/today'),
        api<Task[]>('/tasks'),
        api<{ user: User; csrfToken: string }>('/auth/me'),
      ]);
      if (generation.current === revision) {
        applyToday(data);
        setTasks(library);
        setUser(account.user);
        setCsrf(account.csrfToken);
        setOffline(false);
      }
    } catch (e) {
      if (generation.current !== revision) return;
      if (e instanceof ApiError && e.status === 401) {
        setUser(null);
        setToday(null);
        notify('登录已失效，请重新登录');
      } else {
        setOffline(true);
      }
    }
  }, [user?.id, user?.mustChangePassword, applyToday, notify]);
  useEffect(() => {
    let alive = true;
    api<{ user: User; csrfToken: string }>('/auth/me')
      .then((r) => {
        if (alive) {
          setCsrf(r.csrfToken);
          setUser(r.user);
        }
      })
      .catch((e) => {
        if (alive && (!(e instanceof ApiError) || e.status !== 401)) setBootError(e.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (user?.mustChangePassword) setPage('settings');
    void refresh();
    const interval = setInterval(() => {
      if (!document.hidden && !mutationLock.current) void refresh();
    }, 5000);
    const visible = () => {
      if (!document.hidden) void refresh();
    };
    const reconnect = () => {
      void refresh();
    };
    const disconnect = () => setOffline(true);
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('online', reconnect);
    window.addEventListener('offline', disconnect);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', visible);
      window.removeEventListener('online', reconnect);
      window.removeEventListener('offline', disconnect);
    };
  }, [refresh, user?.mustChangePassword]);
  useEffect(() => {
    const interval = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);
  useEffect(
    () => () => {
      clearTimeout(animationTimeout.current);
      clearTimeout(toastTimeout.current);
    },
    [],
  );
  const mutate = useCallback(
    async (fn: () => Promise<void>) => {
      if (mutationLock.current || offline) return;
      mutationLock.current = true;
      setBusy(true);
      generation.current++;
      try {
        await fn();
        await refresh();
      } catch (e) {
        notify((e as Error).message);
        if (e instanceof ApiError && e.status === 401) setUser(null);
        else await refresh();
      } finally {
        mutationLock.current = false;
        setBusy(false);
      }
    },
    [offline, refresh, notify],
  );

  const active = today?.items.find((i) => ['RUNNING', 'PAUSED'].includes(i.status));
  const pending = today?.items.filter((i) => i.status === 'PENDING') ?? [];
  const completed = today?.items.filter((i) => i.status === 'COMPLETED') ?? [];
  const pool = today?.items.filter((i) => i.status !== 'COMPLETED') ?? [];
  const wheelRotation =
    active && !spinning && pool.length
      ? (-(pool.findIndex((i) => i.id === active.id) + 0.5) * 360) / pool.length
      : rotation;
  const liveSeconds = (item: Item) =>
    item.elapsedSeconds +
    (item.status === 'RUNNING'
      ? Math.max(
          0,
          Math.min(
            tick - receivedAt.current,
            new Date(item.runningDeadline!).getTime() - new Date(today!.serverTime).getTime(),
          ),
        ) / 1000
      : 0);
  const elapsed = active ? liveSeconds(active) : 0;
  const reachedCap =
    !!active?.runningDeadline &&
    tick - receivedAt.current >=
      new Date(active.runningDeadline).getTime() - new Date(today!.serverTime).getTime();
  const totalSeconds = today?.items.reduce((sum, i) => sum + liveSeconds(i), 0) ?? 0;
  async function select(taskId: string, selected: boolean) {
    if (selected) setShowSelection(true);
    await mutate(async () => {
      applyToday(await api<Today>('/today/selection', 'PUT', { taskId, selected }));
    });
  }
  async function draw() {
    if (active || !pending.length || spinning || busy) return;
    setWheelSnapshot(pool);
    await mutate(async () => {
      const storageKey = `draw-${user!.id}-${today!.date}`;
      const key = sessionStorage.getItem(storageKey) ?? crypto.randomUUID();
      sessionStorage.setItem(storageKey, key);
      const result = await api<{ item: Item; today: Today }>('/today/draw', 'POST', undefined, {
        'Idempotency-Key': key,
      });
      sessionStorage.removeItem(storageKey);
      applyToday(result.today);
      const index = pool.findIndex((i) => i.id === result.item.id);
      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (index >= 0 && pool.length > 1 && !reducedMotion) {
        setSpinning(true);
        setRotation(
          (previous) =>
            Math.ceil(previous / 360) * 360 + 1800 - (index + 0.5) * (360 / pool.length),
        );
        clearTimeout(animationTimeout.current);
        animationTimeout.current = setTimeout(() => {
          setSpinning(false);
          setWheelSnapshot(null);
          notify(`就从「${result.item.title}」开始。`);
        }, 3200);
      } else {
        setWheelSnapshot(null);
        notify(`就从「${result.item.title}」开始。`);
      }
    });
  }
  async function control(action: 'pause' | 'resume' | 'complete') {
    if (!active) return;
    await mutate(async () => {
      applyToday(await api<Today>(`/today/${active.id}/${action}`, 'POST'));
      if (action === 'complete') {
        sessionStorage.removeItem(`draw-${user!.id}-${today!.date}`);
        notify('又完成了一件。小小一步，也很棒。');
        setRotation(0);
      }
    });
  }
  async function logout() {
    try {
      await api('/auth/logout', 'POST');
      setUser(null);
      setToday(null);
      setCsrf('');
      setPage('today');
    } catch (e) {
      notify((e as Error).message);
    }
  }
  if (loading)
    return (
      <div className="boot-screen">
        <span className="brand-mark">
          <Shuffle size={24} />
        </span>
        <h1>
          转个开始<span className="brand-dot">.</span>
        </h1>
        <p>给今天一个小小的开始…</p>
      </div>
    );
  if (bootError)
    return (
      <div className="boot-screen">
        <h1>暂时连接不上</h1>
        <p>{bootError}</p>
        <button className="button primary" onClick={() => window.location.reload()}>
          重新连接
        </button>
      </div>
    );
  if (!user)
    return (
      <>
        <Auth
          onLogin={(u) => {
            setUser(u);
            setPage(u.mustChangePassword ? 'settings' : 'today');
          }}
        />
        {toast && (
          <div className="toast" role="status">
            {toast}
          </div>
        )}
      </>
    );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#today" onClick={() => setPage('today')}>
          <span className="brand-mark">
            <Shuffle size={19} />
          </span>
          转个开始<span className="brand-dot">.</span>
        </a>
        <span className="sidebar-caption">一点随机，一点行动。</span>
        <nav aria-label="主导航">
          {pages.map(({ id, label, Icon }) => (
            <button
              key={id}
              aria-label={label}
              className={page === id ? 'active' : ''}
              disabled={user.mustChangePassword && id !== 'settings'}
              onClick={() => setPage(id)}
            >
              <Icon size={19} />
              {label}
              {id === 'today' && today && (
                <span className="nav-count" aria-hidden="true">
                  {pool.length}
                </span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <span>✳</span>
            <p>
              先开始，
              <br />
              给这件事 30 分钟。
            </p>
            <small>开始本身，就是进步。</small>
          </div>
          {user.role === 'ADMIN' && (
            <button
              className={`admin-link ${page === 'admin' ? 'active' : ''}`}
              onClick={() => setPage('admin')}
              disabled={user.mustChangePassword}
            >
              <ShieldCheck size={17} />
              管理空间
              <ArrowUpRight size={15} />
            </button>
          )}
          <div className="profile">
            <span className="avatar">{user.username[0].toUpperCase()}</span>
            <div>
              <strong>{user.username}</strong>
              <small>今天也慢慢来</small>
            </div>
            <button className="icon-button" aria-label="退出登录" onClick={logout}>
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="workspace-header">
          <span>
            {new Intl.DateTimeFormat('zh-CN', {
              timeZone: 'Asia/Shanghai',
              month: 'long',
              day: 'numeric',
              weekday: 'long',
            }).format(new Date())}
          </span>
          <div>
            <span className={`sync-indicator ${offline ? 'offline' : ''}`} />
            {offline ? '连接中断' : '你的进度已同步'}
            <span className="header-separator">/</span>
            <span>给今天一点可能</span>
          </div>
        </header>
        {offline && (
          <div className="notice warning offline-notice">
            <WifiOff size={17} />
            暂时连接不上服务器，已暂停修改。计时以服务器记录为准，联网后自动同步。
          </div>
        )}
        <main className="page-content">
          <div className="mobile-account-row">
            <span className="brand">
              <span className="brand-mark">
                <Shuffle size={17} />
              </span>
              转个开始<span className="brand-dot">.</span>
            </span>
            <details className="mobile-account">
              <summary aria-label="账号菜单">
                <span className="avatar">{user.username[0].toUpperCase()}</span>
                <ChevronDown size={13} />
              </summary>
              <div>
                <strong>{user.username}</strong>
                {user.role === 'ADMIN' && (
                  <button
                    disabled={user.mustChangePassword}
                    onClick={() => {
                      setPage('admin');
                      document.querySelector<HTMLDetailsElement>('.mobile-account')!.open = false;
                    }}
                  >
                    <ShieldCheck size={15} />
                    管理空间
                  </button>
                )}
                <button onClick={logout}>
                  <LogOut size={15} />
                  退出登录
                </button>
              </div>
            </details>
          </div>
          <Suspense fallback={<div className="loading-inline">正在打开…</div>}>
            {page === 'today' && (
              <>
                <div className="page-heading today-heading">
                  <div>
                    <h1>
                      今天，从哪件事开始<span className="heading-dot">？</span>
                    </h1>
                    <p>不用排好顺序。选几件想做的，让转盘替你决定。</p>
                  </div>
                  <div className="today-counter">
                    <strong>{String(completed.length).padStart(2, '0')}</strong>
                    <span>
                      / {String(today?.items.length ?? 0).padStart(2, '0')}
                      <small>今日已完成</small>
                    </span>
                  </div>
                </div>
                {!today ? (
                  <div className="loading-inline">正在准备你的今天…</div>
                ) : (
                  <>
                    <div className="today-layout">
                      <section className="roulette-section">
                        <Wheel
                          items={wheelSnapshot ?? pool}
                          rotation={wheelRotation}
                          spinning={spinning}
                          locked={!!active}
                          disabled={!pending.length || busy || offline}
                          onDraw={draw}
                        />
                        {active && !spinning ? (
                          <div className="focus-panel">
                            <div className="focus-heading">
                              <span className="task-color" style={{ background: active.color }} />
                              <span>
                                {active.status === 'PAUSED' || reachedCap
                                  ? '暂停一下，随时继续'
                                  : '现在，只做这一件'}
                              </span>
                            </div>
                            <h2>{active.title}</h2>
                            {active.note && <p>{active.note}</p>}
                            <div className="timer" aria-label="当前任务已投入时间">
                              {clock(elapsed)}
                            </div>
                            <div className="focus-actions">
                              <button
                                className="button secondary"
                                disabled={busy || offline}
                                onClick={() =>
                                  control(
                                    active.status === 'PAUSED' || reachedCap ? 'resume' : 'pause',
                                  )
                                }
                              >
                                {active.status === 'PAUSED' || reachedCap ? (
                                  <Play size={17} />
                                ) : (
                                  <Pause size={17} />
                                )}
                                {active.status === 'PAUSED' || reachedCap ? '继续计时' : '暂停'}
                              </button>
                              <button
                                className="button primary"
                                disabled={busy || offline}
                                onClick={() => control('complete')}
                              >
                                <Check size={18} />
                                完成这件事
                              </button>
                            </div>
                            <small>完成当前任务后，才能抽取下一件。</small>
                          </div>
                        ) : (
                          <div className="wheel-caption">
                            {spinning ? (
                              <>
                                <Sparkles size={17} />
                                <p>下一件好事，正在转向你。</p>
                              </>
                            ) : today.items.length && !pool.length ? (
                              <>
                                <CheckCheck size={20} />
                                <h2>今天勾选的，都完成了。</h2>
                                <p>值得好好休息，也可以再选一件想做的事。</p>
                              </>
                            ) : (
                              <>
                                <p>
                                  {pending.length
                                    ? `还有 ${pending.length} 件想做的事，抽一件开始吧。`
                                    : '先在右边勾选几件今天想做的事。'}
                                </p>
                                <span>每一件事，都有同样的机会。</span>
                              </>
                            )}
                          </div>
                        )}
                      </section>
                      <section className="today-list-section">
                        <div className="section-heading">
                          <h2>
                            今天想做的事 <span>{pool.length}</span>
                          </h2>
                          <button
                            className="icon-button"
                            aria-label="新增任务"
                            onClick={() => setAddTask(true)}
                          >
                            <Plus size={19} />
                          </button>
                        </div>
                        <p className="muted list-intro">选得少一点也没关系，开始就好。</p>
                        <div className="today-list">
                          {today.items
                            .filter((i) => i.status !== 'COMPLETED')
                            .map((item, index) => (
                              <div
                                className={`today-row ${item.id === active?.id ? 'current' : ''}`}
                                key={item.id}
                              >
                                <span className="task-index">
                                  {String(index + 1).padStart(2, '0')}
                                </span>
                                <span className="task-color" style={{ background: item.color }} />
                                <div>
                                  <h3>{item.title}</h3>
                                  <small>
                                    {item.id === active?.id
                                      ? item.status === 'RUNNING'
                                        ? '正在进行 · 完成后再抽'
                                        : '已暂停 · 完成后再抽'
                                      : item.note || '等一个随机的开始'}
                                  </small>
                                </div>
                                {item.id === active?.id ? (
                                  <span className="current-dot" />
                                ) : (
                                  <button
                                    className="icon-button remove-task"
                                    disabled={busy || offline}
                                    aria-label={`移出今日${item.title}`}
                                    onClick={() => select(item.taskId, false)}
                                  >
                                    ×
                                  </button>
                                )}
                              </div>
                            ))}
                          {!pool.length && (
                            <div className="today-empty">
                              <CircleDashed size={32} />
                              <p>
                                {completed.length ? '又腾出了新的空间。' : '今天还是一张空白纸。'}
                              </p>
                              <small>从任务库里选一件，写下你的开始。</small>
                            </div>
                          )}
                        </div>
                        <button
                          className={`choose-tasks ${showSelection ? 'expanded' : ''}`}
                          onClick={() => setShowSelection(!showSelection)}
                        >
                          <Plus size={17} />
                          从任务库勾选
                          <ChevronDown size={16} />
                        </button>
                        {(showSelection || !today.items.length) && (
                          <div className="selection-list">
                            {tasks
                              .filter((t) => !t.archived)
                              .map((task) => {
                                const item = today.items.find((i) => i.taskId === task.id),
                                  locked = !!item && item.status !== 'PENDING';
                                return (
                                  <label
                                    className={locked ? 'selection-disabled' : ''}
                                    key={task.id}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={!!item}
                                      disabled={locked || busy || offline}
                                      onChange={(e) => select(task.id, e.target.checked)}
                                    />
                                    <span
                                      className="task-color"
                                      style={{ background: task.color }}
                                    />
                                    <span>{task.title}</span>
                                    {item?.status === 'COMPLETED' && <small>已完成</small>}
                                  </label>
                                );
                              })}
                            {!tasks.filter((t) => !t.archived).length && (
                              <button className="text-button" onClick={() => setAddTask(true)}>
                                <Plus size={15} />
                                先创建第一件想做的事
                              </button>
                            )}
                          </div>
                        )}
                        {!!today.yesterday.length && (
                          <details className="yesterday">
                            <summary>昨日还有 {today.yesterday.length} 件未完成</summary>
                            <p>今天仍想做的话，再给它一次机会。</p>
                            {today.yesterday.map((i) => (
                              <button
                                key={i.id}
                                disabled={
                                  busy || offline || today.items.some((t) => t.taskId === i.taskId)
                                }
                                onClick={() => select(i.taskId, true)}
                              >
                                {i.title}
                                <Plus size={14} />
                              </button>
                            ))}
                          </details>
                        )}
                        {!!completed.length && (
                          <div className="completed-list">
                            <div className="section-heading">
                              <h3>
                                已经完成 <span>{completed.length}</span>
                              </h3>
                              <CheckCheck size={17} />
                            </div>
                            {completed.map((i) => (
                              <div key={i.id}>
                                <Check size={15} />
                                <span>{i.title}</span>
                                <small>{minutes(i.elapsedSeconds)}</small>
                              </div>
                            ))}
                          </div>
                        )}
                      </section>
                    </div>
                    <div className="today-bottom">
                      <div className="mini-stat">
                        <CheckCheck size={20} />
                        <div>
                          <strong>
                            {completed.length}
                            <small> 件</small>
                          </strong>
                          <span>今天的小小完成</span>
                        </div>
                      </div>
                      <div className="mini-stat">
                        <Clock3 size={20} />
                        <div>
                          <strong>
                            {Math.floor(totalSeconds / 60)}
                            <small> 分钟</small>
                          </strong>
                          <span>认真投入的时间</span>
                        </div>
                      </div>
                      <div className="daily-goal">
                        <span>今天的小目标</span>
                        <strong>
                          {today.goalTasks !== null || today.goalMinutes !== null
                            ? [
                                today.goalTasks !== null
                                  ? `${completed.length}/${today.goalTasks} 件`
                                  : '',
                                today.goalMinutes !== null
                                  ? `${Math.floor(totalSeconds / 60)}/${today.goalMinutes} 分钟`
                                  : '',
                              ]
                                .filter(Boolean)
                                .join(' · ')
                            : '按自己的节奏就好'}
                        </strong>
                        <button className="text-button" onClick={() => setPage('settings')}>
                          {today.goalTasks === null && today.goalMinutes === null
                            ? '设置一个目标'
                            : '调整明日目标'}
                          <ArrowUpRight size={14} />
                        </button>
                      </div>
                    </div>
                    <footer className="page-footer">
                      <span>每一件开始的事，都有可能成为新的习惯。</span>
                      <span>慢慢来，也是在向前。</span>
                    </footer>
                  </>
                )}
              </>
            )}
            {page === 'tasks' && <Tasks tasks={tasks} refresh={refresh} notify={notify} />}
            {page === 'stats' && <Stats />}
            {page === 'settings' && (
              <Settings key={user.id} user={user} onUser={setUser} notify={notify} />
            )}
            {page === 'admin' && user.role === 'ADMIN' && <Admin user={user} notify={notify} />}
          </Suspense>
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <Check size={16} />
          {toast}
        </div>
      )}
      {addTask && (
        <TaskDialog
          defaultColor={colors[tasks.length % colors.length]}
          onClose={() => setAddTask(false)}
          onSaved={refresh}
        />
      )}
    </div>
  );
}
