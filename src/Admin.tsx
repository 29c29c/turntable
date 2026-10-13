import { useEffect, useState, type FormEvent } from 'react';
import { Plus, Copy, X, ShieldCheck, Trash2, KeyRound, Ban, Check, Pencil } from 'lucide-react';
import { api, type User } from './api';

type Invite = {
  id: string;
  codeHint: string;
  startsAt: string;
  expiresAt: string;
  maxUses: number;
  usedCount: number;
  disabled: boolean;
};
type ManagedUser = {
  id: string;
  username: string;
  role: string;
  disabled: boolean;
  createdAt: string;
  _count: { tasks: number; days: number };
};
type Audit = { id: string; action: string; createdAt: string };
const localInput = (d: Date) =>
  new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
const dateLabel = (s: string) =>
  new Date(s).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });

export default function Admin({ user, notify }: { user: User; notify: (s: string) => void }) {
  const [tab, setTab] = useState<'invites' | 'users' | 'audit'>('invites');
  const [invites, setInvites] = useState<Invite[]>([]),
    [users, setUsers] = useState<ManagedUser[]>([]),
    [audits, setAudits] = useState<Audit[]>([]);
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [codes, setCodes] = useState<string[]>([]);
  const [creating, setCreating] = useState(false),
    [action, setAction] = useState<{ target: ManagedUser; kind: 'delete' | 'reset' } | null>(null);
  const [editingInvite, setEditingInvite] = useState<Invite | null>(null);
  const [actionError, setActionError] = useState('');
  async function refresh() {
    const [a, b, c] = await Promise.all([
      api<Invite[]>('/admin/invites'),
      api<ManagedUser[]>('/admin/users'),
      api<Audit[]>('/admin/audit'),
    ]);
    setInvites(a);
    setUsers(b);
    setAudits(c);
  }
  useEffect(() => {
    let alive = true;
    const update = () =>
      refresh().catch((e) => {
        if (alive) setError(e.message);
      });
    void update();
    const interval = setInterval(() => {
      if (!document.hidden) void update();
    }, 5000);
    return () => {
      alive = false;
      clearInterval(interval);
    };
  }, [tab]);
  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setActionError('');
    const f = new FormData(e.currentTarget);
    try {
      const data = {
        maxUses: Number(f.get('maxUses')),
        startsAt: new Date(String(f.get('startsAt'))).toISOString(),
        expiresAt: new Date(String(f.get('expiresAt'))).toISOString(),
      };
      if (editingInvite) {
        await api(`/admin/invites/${editingInvite.id}`, 'PATCH', data);
        notify('邀请码的有效期和使用限制已更新');
      } else {
        const r = await api<{ codes: string[] }>('/admin/invites', 'POST', {
          ...data,
          count: Number(f.get('count')),
        });
        setCodes(r.codes);
      }
      setCreating(false);
      setEditingInvite(null);
      await refresh();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function toggleInvite(invite: Invite) {
    try {
      await api(`/admin/invites/${invite.id}`, 'PATCH', { disabled: !invite.disabled });
      await refresh();
      notify(invite.disabled ? '邀请码已启用' : '邀请码已停用');
    } catch (e) {
      notify((e as Error).message);
    }
  }
  async function toggleUser(target: ManagedUser) {
    try {
      await api(`/admin/users/${target.id}`, 'PATCH', { disabled: !target.disabled });
      await refresh();
      notify(target.disabled ? '账号已恢复' : '账号已停用，所有登录已失效');
    } catch (e) {
      notify((e as Error).message);
    }
  }
  async function destructive(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!action) return;
    setBusy(true);
    setActionError('');
    const f = new FormData(e.currentTarget);
    try {
      await api(
        `/admin/users/${action.target.id}${action.kind === 'reset' ? '/reset-password' : ''}`,
        action.kind === 'reset' ? 'POST' : 'DELETE',
        {
          adminPassword: f.get('adminPassword'),
          ...(action.kind === 'reset'
            ? { temporaryPassword: f.get('temporaryPassword') }
            : { confirmUsername: f.get('confirmUsername') }),
        },
      );
      setAction(null);
      await refresh();
      notify(
        action.kind === 'reset'
          ? '密码已重置，请自行将临时密码交给用户；首次登录须修改。'
          : '账号及在线数据库中的关联记录已永久删除。',
      );
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>
            管理这个小空间<span className="heading-dot">.</span>
          </h1>
          <p>邀请码、账号和操作记录，都在这里。</p>
        </div>
        <span className="admin-label">
          <ShieldCheck size={17} />
          管理员
        </span>
      </div>
      <div className="list-toolbar">
        <div className="tabs">
          <button className={tab === 'invites' ? 'selected' : ''} onClick={() => setTab('invites')}>
            邀请码
          </button>
          <button className={tab === 'users' ? 'selected' : ''} onClick={() => setTab('users')}>
            用户账号
          </button>
          <button className={tab === 'audit' ? 'selected' : ''} onClick={() => setTab('audit')}>
            操作记录
          </button>
        </div>
        {tab === 'invites' && (
          <button
            className="button primary small"
            onClick={() => {
              setEditingInvite(null);
              setCreating(true);
              setActionError('');
            }}
          >
            <Plus size={16} />
            生成邀请码
          </button>
        )}
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {tab === 'invites' && (
        <>
          <div className="notice">
            邀请码原文只在生成时显示一次，请及时复制。列表只保留提示片段。
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>邀请码</th>
                  <th>生效时间（北京时间）</th>
                  <th>失效时间</th>
                  <th>使用次数</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {invites.map((i) => {
                  const status = i.disabled
                    ? '已停用'
                    : new Date(i.startsAt) > new Date()
                      ? '未生效'
                      : new Date(i.expiresAt) <= new Date()
                        ? '已失效'
                        : i.usedCount >= i.maxUses
                          ? '已用完'
                          : '可使用';
                  return (
                    <tr key={i.id}>
                      <td>
                        <code>{i.codeHint}</code>
                      </td>
                      <td>{dateLabel(i.startsAt)}</td>
                      <td>{dateLabel(i.expiresAt)}</td>
                      <td>
                        {i.usedCount} / {i.maxUses}
                      </td>
                      <td>
                        <span className={`status-tag ${status === '可使用' ? 'done' : ''}`}>
                          {status}
                        </span>
                      </td>
                      <td>
                        <div className="table-actions">
                          <button
                            className="icon-button"
                            aria-label={`编辑邀请码${i.codeHint}`}
                            onClick={() => {
                              setEditingInvite(i);
                              setCreating(true);
                              setActionError('');
                            }}
                          >
                            <Pencil size={15} />
                          </button>
                          <button className="text-button" onClick={() => toggleInvite(i)}>
                            {i.disabled ? '启用' : '停用'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!invites.length && <p className="empty-copy">生成第一批邀请码，邀请大家来开始。</p>}
          </div>
        </>
      )}
      {tab === 'users' && (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>用户名</th>
                <th>角色</th>
                <th>注册日期</th>
                <th>任务 / 天数</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>
                    <strong>{u.username}</strong>
                    {u.id === user.id && <span className="muted">（你）</span>}
                  </td>
                  <td>{u.role === 'ADMIN' ? '管理员' : '用户'}</td>
                  <td>{dateLabel(u.createdAt)}</td>
                  <td>
                    {u._count.tasks} / {u._count.days}
                  </td>
                  <td>
                    <span className={`status-tag ${!u.disabled ? 'done' : ''}`}>
                      {u.disabled ? '已停用' : '正常'}
                    </span>
                  </td>
                  <td>
                    <div className="table-actions">
                      <button
                        className="icon-button"
                        disabled={u.id === user.id}
                        aria-label={`${u.disabled ? '恢复' : '停用'}${u.username}`}
                        onClick={() => toggleUser(u)}
                      >
                        {u.disabled ? <Check size={16} /> : <Ban size={16} />}
                      </button>
                      <button
                        className="icon-button"
                        disabled={u.id === user.id}
                        aria-label={`重置${u.username}密码`}
                        onClick={() => {
                          setAction({ target: u, kind: 'reset' });
                          setActionError('');
                        }}
                      >
                        <KeyRound size={16} />
                      </button>
                      <button
                        className="icon-button danger-text"
                        disabled={u.id === user.id}
                        aria-label={`删除${u.username}`}
                        onClick={() => {
                          setAction({ target: u, kind: 'delete' });
                          setActionError('');
                        }}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {tab === 'audit' && (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>时间（北京时间）</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {audits.map((a) => (
                <tr key={a.id}>
                  <td>{dateLabel(a.createdAt)}</td>
                  <td>
                    {(
                      {
                        INVITES_CREATED: '生成邀请码',
                        INVITE_STATUS_CHANGED: '修改邀请码状态',
                        USER_STATUS_CHANGED: '修改账号状态',
                        USER_PASSWORD_RESET: '重置用户密码',
                        USER_PERMANENTLY_DELETED: '永久删除用户',
                      } as Record<string, string>
                    )[a.action] ?? a.action}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted">仅保存操作类别与时间，不保存被删除用户的内容。显示最近100条。</p>
        </div>
      )}
      {creating && (
        <div className="modal-backdrop">
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="invite-title">
            <div className="section-heading">
              <h2 id="invite-title">{editingInvite ? '编辑邀请码' : '生成邀请码'}</h2>
              <button className="icon-button" aria-label="关闭" onClick={() => setCreating(false)}>
                <X size={20} />
              </button>
            </div>
            <form onSubmit={create}>
              <div className="form-columns">
                {!editingInvite && (
                  <label>
                    生成数量
                    <input name="count" type="number" min={1} max={50} defaultValue={1} required />
                  </label>
                )}
                <label>
                  每码可用次数
                  <input
                    name="maxUses"
                    type="number"
                    min={Math.max(1, editingInvite?.usedCount ?? 1)}
                    max={10000}
                    defaultValue={editingInvite?.maxUses ?? 1}
                    required
                  />
                </label>
              </div>
              <label>
                开始生效（本地时间）
                <input
                  name="startsAt"
                  type="datetime-local"
                  required
                  defaultValue={localInput(
                    editingInvite ? new Date(editingInvite.startsAt) : new Date(),
                  )}
                />
              </label>
              <label>
                失效时间（本地时间）
                <input
                  name="expiresAt"
                  type="datetime-local"
                  required
                  defaultValue={localInput(
                    editingInvite
                      ? new Date(editingInvite.expiresAt)
                      : new Date(Date.now() + 7 * 86400000),
                  )}
                />
              </label>
              {actionError && (
                <p role="alert" className="form-error">
                  {actionError}
                </p>
              )}
              <button className="button primary wide" disabled={busy}>
                {busy ? '处理中…' : editingInvite ? '保存修改' : '生成并查看'}
              </button>
            </form>
          </section>
        </div>
      )}
      {!!codes.length && (
        <div className="modal-backdrop">
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="codes-title">
            <div className="section-heading">
              <h2 id="codes-title">邀请码准备好了</h2>
              <button className="icon-button" aria-label="关闭" onClick={() => setCodes([])}>
                <X size={20} />
              </button>
            </div>
            <p className="muted">关闭后无法再次查看原文，请先复制保存。</p>
            <pre className="invite-codes">{codes.join('\n')}</pre>
            <button
              className="button primary wide"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(codes.join('\n'));
                  notify('邀请码已复制');
                } catch {
                  notify('浏览器无法自动复制，请选中邀请码手动复制。');
                }
              }}
            >
              <Copy size={17} />
              复制全部邀请码
            </button>
          </section>
        </div>
      )}
      {action && (
        <div className="modal-backdrop">
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="action-title">
            <div className="section-heading">
              <h2 id="action-title">
                {action.kind === 'delete' ? '永久删除账号' : '重置用户密码'}
              </h2>
              <button className="icon-button" aria-label="关闭" onClick={() => setAction(null)}>
                <X size={20} />
              </button>
            </div>
            <p className="muted">
              目标账号：<strong>{action.target.username}</strong>
            </p>
            {action.kind === 'delete' && (
              <div className="notice warning">
                账号、任务、计时与在线数据库记录将永久删除，无法撤销。旧备份按7天保留周期过期。
              </div>
            )}
            <form onSubmit={destructive}>
              <label>
                你的管理员密码
                <input
                  autoFocus
                  name="adminPassword"
                  type="password"
                  required
                  maxLength={128}
                  autoComplete="current-password"
                />
              </label>
              {action.kind === 'delete' ? (
                <label>
                  输入目标用户名确认
                  <input
                    name="confirmUsername"
                    required
                    autoComplete="off"
                    placeholder={action.target.username}
                  />
                </label>
              ) : (
                <label>
                  临时密码
                  <input
                    name="temporaryPassword"
                    type="password"
                    required
                    minLength={12}
                    maxLength={128}
                    autoComplete="new-password"
                    placeholder="至少12位，需自行告知用户"
                  />
                </label>
              )}
              {actionError && (
                <p className="form-error" role="alert">
                  {actionError}
                </p>
              )}
              <button
                className={`button wide ${action.kind === 'delete' ? 'danger' : 'primary'}`}
                disabled={busy}
              >
                {busy ? '处理中…' : action.kind === 'delete' ? '确认永久删除' : '确认重置密码'}
              </button>
            </form>
          </section>
        </div>
      )}
    </>
  );
}
