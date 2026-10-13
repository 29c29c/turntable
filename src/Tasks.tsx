import { useState, type FormEvent } from 'react';
import { Plus, Pencil, Archive, RotateCcw, X, Check } from 'lucide-react';
import { api, colors, type Task } from './api';

export function TaskDialog({
  task,
  defaultColor,
  onClose,
  onSaved,
}: {
  task?: Task;
  defaultColor?: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [color, setColor] = useState(task?.color ?? defaultColor ?? colors[0]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const form = new FormData(e.currentTarget);
    try {
      await api(task ? `/tasks/${task.id}` : '/tasks', task ? 'PATCH' : 'POST', {
        title: form.get('title'),
        note: form.get('note'),
        color,
      });
      await onSaved();
      onClose();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-dialog-title"
        className="modal"
      >
        <div className="section-heading">
          <h2 id="task-dialog-title">{task ? '编辑这件事' : '留下一件想做的事'}</h2>
          <button className="icon-button" aria-label="关闭" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <p className="muted">放进长期任务库，今天或明天，随时开始。</p>
        <form onSubmit={submit}>
          <label>
            任务名称
            <input
              autoFocus
              name="title"
              required
              maxLength={100}
              placeholder="比如：读 20 页书"
              defaultValue={task?.title}
            />
          </label>
          <label>
            一点备注 <span className="muted">（可选）</span>
            <textarea
              name="note"
              rows={3}
              maxLength={500}
              placeholder="想从哪里开始？"
              defaultValue={task?.note}
            />
          </label>
          <fieldset className="color-field">
            <legend>转盘颜色</legend>
            <div className="color-options">
              {colors.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`颜色 ${c}`}
                  aria-pressed={color === c}
                  onClick={() => setColor(c)}
                  style={{ background: c }}
                >
                  {color === c && <Check size={18} />}
                </button>
              ))}
            </div>
          </fieldset>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button className="button primary wide" disabled={busy}>
            {busy ? '保存中…' : task ? '保存修改' : '加入任务库'}
          </button>
        </form>
      </section>
    </div>
  );
}

export default function Tasks({
  tasks,
  refresh,
  notify,
}: {
  tasks: Task[];
  refresh: () => Promise<void>;
  notify: (s: string) => void;
}) {
  const [archived, setArchived] = useState(false),
    [editing, setEditing] = useState<Task | null | undefined>(undefined);
  const [busy, setBusy] = useState<string | null>(null);
  const visible = tasks.filter((t) => t.archived === archived);
  async function archive(task: Task) {
    setBusy(task.id);
    try {
      await api(`/tasks/${task.id}`, 'PATCH', { archived: !task.archived });
      await refresh();
      notify(task.archived ? '这件事回到任务库了' : '已归档，历史记录仍然保留');
    } catch (error) {
      notify((error as Error).message);
    } finally {
      setBusy(null);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>
            想做的那些事<span className="heading-dot">.</span>
          </h1>
          <p>一直想做的、想慢慢变好的，都可以放在这里。</p>
        </div>
        <button className="button primary" onClick={() => setEditing(null)}>
          <Plus size={18} />
          新增任务
        </button>
      </div>
      <div className="list-toolbar">
        <div className="tabs">
          <button className={!archived ? 'selected' : ''} onClick={() => setArchived(false)}>
            任务库 <span>{tasks.filter((t) => !t.archived).length}</span>
          </button>
          <button className={archived ? 'selected' : ''} onClick={() => setArchived(true)}>
            已归档
          </button>
        </div>
        <span className="muted">每天从这里勾选，完成后仍会保留</span>
      </div>
      <div className="library-list">
        {visible.map((task, index) => (
          <article className="library-row" key={task.id}>
            <span className="task-number">{String(index + 1).padStart(2, '0')}</span>
            <span className="task-color" style={{ background: task.color }} />
            <div className="task-copy">
              <h3>{task.title}</h3>
              <p>{task.note || '给这件事一点时间。'}</p>
            </div>
            <button
              className="icon-button"
              aria-label={`编辑${task.title}`}
              onClick={() => setEditing(task)}
            >
              <Pencil size={17} />
            </button>
            <button
              className="icon-button"
              disabled={busy === task.id}
              aria-label={`${archived ? '恢复' : '归档'}${task.title}`}
              onClick={() => archive(task)}
            >
              {archived ? <RotateCcw size={17} /> : <Archive size={17} />}
            </button>
          </article>
        ))}
        {!visible.length && (
          <div className="empty-state">
            <span>✳</span>
            <h3>{archived ? '暂时没有归档的任务' : '把第一件想做的事放进来'}</h3>
            <p>
              {archived
                ? '暂时不想做的，可以归档，想做时再恢复。'
                : '不用写很多，一件小事就是很好的开始。'}
            </p>
            {!archived && (
              <button className="button primary" onClick={() => setEditing(null)}>
                <Plus size={17} />
                新增任务
              </button>
            )}
          </div>
        )}
      </div>
      {editing !== undefined && (
        <TaskDialog
          task={editing ?? undefined}
          defaultColor={colors[tasks.length % colors.length]}
          onClose={() => setEditing(undefined)}
          onSaved={refresh}
        />
      )}
    </>
  );
}
