export interface User {
  id: string;
  username: string;
  role: string;
  mustChangePassword: boolean;
  timerCapMinutes: number;
  goalTasks: number | null;
  goalMinutes: number | null;
  pendingGoalTasks: number | null;
  pendingGoalMinutes: number | null;
  goalEffectiveDay: string | null;
}
export interface Task {
  id: string;
  title: string;
  note: string;
  color: string;
  archived: boolean;
}
export interface Item {
  id: string;
  taskId: string;
  title: string;
  note: string;
  color: string;
  status: 'PENDING' | 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'EXPIRED';
  elapsedSeconds: number;
  runningDeadline: string | null;
}
export interface Today {
  date: string;
  serverTime: string;
  goalTasks: number | null;
  goalMinutes: number | null;
  items: Item[];
  yesterday: Item[];
}
export interface Stats {
  year: number;
  month: number | null;
  serverTime: string;
  totals: {
    completed: number;
    seconds: number;
    activeDays: number;
    goalDays: number;
    achievedDays: number;
    activeStreak: number;
    goalStreak: number;
  };
  days: {
    date: string;
    completed: number;
    seconds: number;
    goalTasks: number | null;
    goalMinutes: number | null;
    hasGoal: boolean;
    achieved: boolean;
  }[];
  distribution: {
    taskId: string;
    title: string;
    color: string;
    seconds: number;
    completed: number;
  }[];
  history: {
    id: string;
    date: string;
    title: string;
    color: string;
    status: string;
    seconds: number;
  }[];
}
let csrfToken = '';
export function setCsrf(value: string) {
  csrfToken = value;
}
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  method = 'GET',
  data?: unknown,
  headers: Record<string, string> = {},
): Promise<T> {
  if (method !== 'GET' && !navigator.onLine)
    throw new ApiError(0, '离线时不能修改，请恢复连接后再试');
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: {
        ...(data !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(method !== 'GET' ? { 'X-CSRF-Token': csrfToken } : {}),
        ...headers,
      },
      ...(data !== undefined ? { body: JSON.stringify(data) } : {}),
    });
  } catch {
    throw new ApiError(0, '网络连接中断，请恢复连接后再试');
  }
  let body;
  try {
    body = await response.json();
  } catch {
    throw new ApiError(response.status, '服务器暂时无法响应，请稍后再试');
  }
  if (!response.ok) throw new ApiError(response.status, body.error ?? '操作失败，请稍后重试');
  return body as T;
}
export const colors = [
  '#b9ccf6',
  '#f6c6ae',
  '#c4dbbf',
  '#ecd694',
  '#d8c8ec',
  '#f0bbc7',
  '#a9d5d9',
  '#cbd2e2',
];
export function clock(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
export const minutes = (seconds: number) =>
  seconds < 60 ? `${seconds} 秒` : `${Math.round(seconds / 60)} 分钟`;
