import { useState, type FormEvent } from 'react';
import { ArrowUpRight, CircleCheck, Shuffle, Timer, Sparkles } from 'lucide-react';
import { api, setCsrf, type User } from './api';

export default function Auth({ onLogin }: { onLogin: (user: User) => void }) {
  const [register, setRegister] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      const result = await api<{ user: User; csrfToken: string }>(
        `/auth/${register ? 'register' : 'login'}`,
        'POST',
        {
          username: form.get('username'),
          password: form.get('password'),
          ...(register ? { invite: form.get('invite') } : {}),
        },
      );
      setCsrf(result.csrfToken);
      onLogin(result.user);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-layout">
      <section className="auth-story">
        <a className="brand" href="/">
          <span className="brand-mark">
            <Shuffle size={21} />
          </span>
          转个开始<span className="brand-dot">.</span>
        </a>
        <div className="auth-story-body">
          <div className="orbit-art" aria-hidden="true">
            <div />
            <div />
            <div />
            <span>
              <Sparkles size={30} />
            </span>
          </div>
          <h1>
            想做的事很多，
            <br />
            先开始<span>一件就好。</span>
          </h1>
          <p>
            不用再想先做哪一件。
            <br />
            把选择交给转盘，把今天交给行动。
          </p>
          <div className="auth-steps">
            <span>
              <Shuffle size={17} />
              随机选一件
            </span>
            <span>
              <Timer size={17} />
              给它一点时间
            </span>
            <span>
              <CircleCheck size={17} />
              完成小小一步
            </span>
          </div>
        </div>
        <small>每天，都给那些一直想做的事一点机会。</small>
      </section>
      <section className="auth-form-area">
        <div className="auth-form-wrap">
          <span className="small-sun" aria-hidden="true">
            ✳
          </span>
          <h2>{register ? '给行动一个新开始' : '今天，也从这里开始'}</h2>
          <p>
            {register
              ? '使用邀请码，创建属于你的任务空间。'
              : '欢迎回来。你的任务和小小进步都在这里。'}
          </p>
          <form onSubmit={submit}>
            <label>
              用户名
              <input
                name="username"
                autoComplete="username"
                placeholder="你的用户名"
                required
                minLength={3}
                maxLength={32}
                pattern="[a-zA-Z0-9_]+"
              />
            </label>
            <label>
              密码
              <input
                name="password"
                type="password"
                autoComplete={register ? 'new-password' : 'current-password'}
                placeholder={register ? '至少 12 位字符' : '输入密码'}
                required
                minLength={register ? 12 : 1}
                maxLength={128}
              />
            </label>
            {register && (
              <label>
                邀请码
                <input
                  name="invite"
                  autoComplete="off"
                  placeholder="向管理员获取邀请码"
                  required
                  maxLength={100}
                />
              </label>
            )}
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <button className="button primary wide" disabled={busy}>
              {busy ? '稍等一下…' : register ? '创建账号' : '进入我的今天'}
              <ArrowUpRight size={18} />
            </button>
          </form>
          <p className="auth-switch">
            {register ? '已经有账号？' : '还没有账号？'}
            <button
              onClick={() => {
                setRegister(!register);
                setError('');
              }}
            >
              {register ? '去登录' : '邀请码注册'}
            </button>
          </p>
          {!register && <p className="auth-help">忘记密码？请联系管理员重置。</p>}
          <div className="auth-note">不需要完美的一天，只需要一个小小的开始。</div>
        </div>
      </section>
    </main>
  );
}
