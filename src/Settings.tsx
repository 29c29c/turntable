import { useState, type FormEvent } from 'react';
import { Check, Timer, Target, ShieldCheck } from 'lucide-react';
import { api, type User } from './api';

export default function Settings({
  user,
  onUser,
  notify,
}: {
  user: User;
  onUser: (u: User) => void;
  notify: (s: string) => void;
}) {
  const [busy, setBusy] = useState(false),
    [passwordBusy, setPasswordBusy] = useState(false),
    [error, setError] = useState('');
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const f = new FormData(e.currentTarget);
    try {
      const user = await api<User>('/settings', 'PUT', {
        timerCapMinutes: Number(f.get('cap')),
        goalTasks: f.get('tasks') ? Number(f.get('tasks')) : null,
        goalMinutes: f.get('minutes') ? Number(f.get('minutes')) : null,
      });
      onUser(user);
      notify('已保存。计时上限适用于新计时段，目标从明天生效。');
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function changePassword(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget,
      f = new FormData(form);
    setPasswordBusy(true);
    setError('');
    if (f.get('newPassword') !== f.get('confirmPassword')) {
      setError('两次新密码不一致');
      setPasswordBusy(false);
      return;
    }
    try {
      await api('/auth/password', 'POST', {
        currentPassword: f.get('currentPassword'),
        newPassword: f.get('newPassword'),
      });
      form.reset();
      onUser({ ...user, mustChangePassword: false });
      notify('密码已修改，其他设备的登录已失效。');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPasswordBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>
            按自己的节奏<span className="heading-dot">.</span>
          </h1>
          <p>设一个温和的目标，给行动留一点空间。</p>
        </div>
      </div>
      {user.mustChangePassword && (
        <div className="notice warning">
          你正在使用临时密码。请先修改密码，才能开始使用任务空间。
        </div>
      )}
      {!user.mustChangePassword && (
        <form className="settings-form" onSubmit={save}>
          <section className="settings-section">
            <div className="settings-label">
              <Timer size={21} />
              <h2>计时与自动暂停</h2>
              <p>
                防止忘记关掉计时。
                <br />
                到上限只会暂停，不会自动完成。
              </p>
            </div>
            <div className="settings-fields">
              <label>
                每段连续计时上限{' '}
                <div className="input-unit">
                  <input
                    name="cap"
                    type="number"
                    min={15}
                    max={240}
                    required
                    defaultValue={user.timerCapMinutes}
                  />
                  <span>分钟</span>
                </div>
              </label>
              <p className="muted">15～240 分钟 · 暂停后可以继续当前任务</p>
              <p className="muted">每天按北京时间 00:00 换日，结束昨日计时并解除锁定。</p>
            </div>
          </section>
          <section className="settings-section">
            <div className="settings-label">
              <Target size={21} />
              <h2>每日小目标</h2>
              <p>
                留空表示不设目标。
                <br />
                目标从次日生效，历史不会改变。
              </p>
            </div>
            <div className="settings-fields">
              <label>
                希望完成多少件事{' '}
                <div className="input-unit">
                  <input
                    name="tasks"
                    type="number"
                    min={1}
                    max={100}
                    placeholder="不设目标"
                    defaultValue={
                      (user.goalEffectiveDay ? user.pendingGoalTasks : user.goalTasks) ?? ''
                    }
                  />
                  <span>件 / 天</span>
                </div>
              </label>
              <label>
                希望投入多少时间{' '}
                <div className="input-unit">
                  <input
                    name="minutes"
                    type="number"
                    min={1}
                    max={1440}
                    placeholder="不设目标"
                    defaultValue={
                      (user.goalEffectiveDay ? user.pendingGoalMinutes : user.goalMinutes) ?? ''
                    }
                  />
                  <span>分钟 / 天</span>
                </div>
              </label>
              <p className="muted">两项都设置时，同时达到才算达标。完成一件就算活跃一天。</p>
              {user.goalEffectiveDay && (
                <p className="save-note">
                  <Check size={15} />
                  已安排在 {user.goalEffectiveDay} 生效
                </p>
              )}
            </div>
          </section>
          <div className="settings-save">
            <button className="button primary" disabled={busy}>
              {busy ? '保存中…' : '保存设置'}
              <Check size={16} />
            </button>
          </div>
        </form>
      )}
      <section className="settings-section">
        <div className="settings-label">
          <ShieldCheck size={21} />
          <h2>账号与安全</h2>
          <p>
            用户名：{user.username}
            <br />
            修改密码后，其他设备需要重新登录。
          </p>
        </div>
        <form className="settings-fields" onSubmit={changePassword}>
          <label>
            当前密码
            <input
              name="currentPassword"
              type="password"
              required
              autoComplete="current-password"
              maxLength={128}
            />
          </label>
          <label>
            新密码
            <input
              name="newPassword"
              type="password"
              required
              minLength={12}
              maxLength={128}
              placeholder="至少12位字符"
              autoComplete="new-password"
            />
          </label>
          <label>
            再输入一次新密码
            <input
              name="confirmPassword"
              type="password"
              required
              minLength={12}
              maxLength={128}
              autoComplete="new-password"
            />
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button className="button secondary" disabled={passwordBusy}>
            {passwordBusy ? '修改中…' : '修改密码'}
          </button>
        </form>
      </section>
    </>
  );
}
