import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import type { Task, Today } from './api';

export interface SelectionChange {
  taskId: string;
  selected: boolean;
}

export default function TaskSelection({
  tasks,
  today,
  disabled,
  onSave,
  onCancel,
  onAdd,
}: {
  tasks: Task[];
  today: Today;
  disabled: boolean;
  onSave: (date: string, changes: SelectionChange[]) => Promise<void>;
  onCancel: () => void;
  onAdd: () => void;
}) {
  const [base] = useState(() => new Set(today.items.map((item) => item.taskId)));
  const [date] = useState(today.date);
  const [draft, setDraft] = useState(() => new Set(base));
  const [saving, setSaving] = useState(false),
    [error, setError] = useState('');
  const allInput = useRef<HTMLInputElement>(null);
  const items = useMemo(
    () => new Map(today.items.map((item) => [item.taskId, item])),
    [today.items],
  );
  const visible = useMemo(() => tasks.filter((task) => !task.archived), [tasks]);
  const editable = visible.filter(
    (task) => !items.has(task.id) || items.get(task.id)!.status === 'PENDING',
  );
  const selectedCount = editable.filter((task) => draft.has(task.id)).length;
  const allSelected = editable.length > 0 && selectedCount === editable.length;
  const expired = date !== today.date;
  const blocked = disabled || saving || expired;
  useEffect(() => {
    if (allInput.current) allInput.current.indeterminate = selectedCount > 0 && !allSelected;
  }, [selectedCount, allSelected]);
  function toggle(id: string, checked: boolean) {
    setDraft((previous) => {
      const next = new Set(previous);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
    setError('');
  }
  function toggleAll(checked: boolean) {
    setDraft((previous) => {
      const next = new Set(previous);
      for (const task of editable) {
        if (checked) next.add(task.id);
        else next.delete(task.id);
      }
      return next;
    });
    setError('');
  }
  async function save() {
    setSaving(true);
    setError('');
    try {
      const changes = editable
        .filter((task) => draft.has(task.id) !== base.has(task.id))
        .map((task) => ({ taskId: task.id, selected: draft.has(task.id) }));
      await onSave(date, changes);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="selection-editor">
      <div className="selection-toolbar">
        <label>
          <input
            ref={allInput}
            type="checkbox"
            aria-label="全选任务"
            checked={allSelected}
            disabled={blocked || !editable.length}
            onChange={(e) => toggleAll(e.target.checked)}
          />
          全选
        </label>
        <span>
          已勾选{' '}
          {
            visible.filter((task) => {
              const item = items.get(task.id);
              return item && item.status !== 'PENDING' ? true : draft.has(task.id);
            }).length
          }{' '}
          项
        </span>
      </div>
      <div className="selection-list">
        {visible.map((task) => {
          const item = items.get(task.id),
            locked = !!item && item.status !== 'PENDING';
          return (
            <label key={task.id} className={locked ? 'selection-disabled' : ''}>
              <input
                type="checkbox"
                checked={locked || draft.has(task.id)}
                disabled={locked || blocked}
                onChange={(e) => toggle(task.id, e.target.checked)}
              />
              <span className="task-color" style={{ background: task.color }} />
              <span>{task.title}</span>
              {locked && <small>{item.status === 'COMPLETED' ? '已完成' : '已抽中'}</small>}
            </label>
          );
        })}
        {!visible.length && (
          <button className="text-button" onClick={onAdd}>
            <Plus size={15} />
            先创建第一件想做的事
          </button>
        )}
      </div>
      {expired && (
        <p className="selection-error" role="alert">
          已进入新的一天，请取消后重新勾选。
        </p>
      )}
      {error && (
        <p className="selection-error" role="alert">
          {error}
        </p>
      )}
      <div className="selection-footer">
        <span>点完成后更新今日任务</span>
        <button className="button secondary small" disabled={saving} onClick={onCancel}>
          取消
        </button>
        <button className="button primary small" disabled={blocked} onClick={save}>
          {saving ? '保存中…' : '完成'}
        </button>
      </div>
    </div>
  );
}
