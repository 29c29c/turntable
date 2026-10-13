import { randomInt } from 'node:crypto';
import { PrismaClient, Prisma, User } from '@prisma/client';

export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const DAY_MS = 86_400_000;
const OFFSET = 8 * 3_600_000;
export function dayKey(date: Date): string {
  return new Date(date.getTime() + OFFSET).toISOString().slice(0, 10);
}
export function dayStart(day: string): Date {
  return new Date(`${day}T00:00:00+08:00`);
}
export function nextMidnight(day: string): Date {
  return new Date(dayStart(day).getTime() + DAY_MS);
}
export const previousDay = (day: string) => dayKey(new Date(dayStart(day).getTime() - DAY_MS));
export const publicUser = (u: User) => ({
  id: u.id,
  username: u.username,
  role: u.role,
  mustChangePassword: u.mustChangePassword,
  timerCapMinutes: u.timerCapMinutes,
  goalTasks: u.goalTasks,
  goalMinutes: u.goalMinutes,
  pendingGoalTasks: u.pendingGoalTasks,
  pendingGoalMinutes: u.pendingGoalMinutes,
  goalEffectiveDay: u.goalEffectiveDay,
});

type Tx = Prisma.TransactionClient;
const itemInclude = { segments: { orderBy: { startedAt: 'asc' as const } } };
export type FullItem = Prisma.DailyItemGetPayload<{ include: typeof itemInclude }>;
export function elapsedSeconds(item: FullItem, now: Date): number {
  return Math.floor(
    item.segments.reduce(
      (sum, s) =>
        sum +
        Math.max(
          0,
          Math.min((s.endedAt ?? now).getTime(), s.deadline.getTime()) - s.startedAt.getTime(),
        ),
      0,
    ) / 1000,
  );
}
export function serializeItem(item: FullItem, now: Date) {
  return {
    ...item,
    elapsedSeconds: elapsedSeconds(item, now),
    runningDeadline: item.segments.find((s) => !s.endedAt)?.deadline.toISOString() ?? null,
  };
}

export class Domain {
  constructor(
    public db: PrismaClient,
    public now: () => Date = () => new Date(),
  ) {}

  async locked<T>(userId: string, fn: (tx: Tx, now: Date, user: User) => Promise<T>): Promise<T> {
    return this.db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
        const user = await tx.user.findUnique({ where: { id: userId } });
        if (!user || user.disabled) throw new AppError(401, '账号已停用或登录已失效');
        const now = this.now();
        await this.normalize(tx, userId, now);
        return fn(tx, now, user);
      },
      { maxWait: 10_000, timeout: 15_000 },
    );
  }

  async normalize(tx: Tx, userId: string, now: Date) {
    const today = dayKey(now);
    const open = await tx.segment.findMany({
      where: { endedAt: null, item: { day: { userId } } },
      include: { item: { include: { day: true } } },
    });
    for (const segment of open) {
      const cutoff = Math.min(
        segment.deadline.getTime(),
        nextMidnight(segment.item.day.date).getTime(),
      );
      if (now.getTime() >= cutoff) {
        await tx.segment.update({ where: { id: segment.id }, data: { endedAt: new Date(cutoff) } });
        await tx.dailyItem.update({
          where: { id: segment.itemId },
          data: {
            status: segment.item.day.date < today ? 'EXPIRED' : 'PAUSED',
          },
        });
      }
    }
    await tx.dailyItem.updateMany({
      where: { day: { userId, date: { lt: today } }, status: { in: ['RUNNING', 'PAUSED'] } },
      data: { status: 'EXPIRED' },
    });
  }

  async ensureDay(tx: Tx, user: User, now: Date) {
    const date = dayKey(now);
    const latest = await tx.day.findFirst({
      where: { userId: user.id },
      orderBy: { date: 'desc' },
    });
    let missingDate = latest
      ? dayKey(nextMidnight(latest.date))
      : dayKey(user.createdAt) < date
        ? dayKey(user.createdAt)
        : date;
    const missing: {
      userId: string;
      date: string;
      goalTasks: number | null;
      goalMinutes: number | null;
    }[] = [];
    while (missingDate <= date) {
      const pendingApplies = user.goalEffectiveDay !== null && missingDate >= user.goalEffectiveDay;
      missing.push({
        userId: user.id,
        date: missingDate,
        goalTasks: pendingApplies ? user.pendingGoalTasks : user.goalTasks,
        goalMinutes: pendingApplies ? user.pendingGoalMinutes : user.goalMinutes,
      });
      missingDate = dayKey(nextMidnight(missingDate));
    }
    if (missing.length) await tx.day.createMany({ data: missing, skipDuplicates: true });
    if (user.goalEffectiveDay && user.goalEffectiveDay <= date) {
      user = await tx.user.update({
        where: { id: user.id },
        data: {
          goalTasks: user.pendingGoalTasks,
          goalMinutes: user.pendingGoalMinutes,
          goalEffectiveDay: null,
          pendingGoalTasks: null,
          pendingGoalMinutes: null,
        },
      });
    }
    return tx.day.upsert({
      where: { userId_date: { userId: user.id, date } },
      update: {},
      create: { userId: user.id, date, goalTasks: user.goalTasks, goalMinutes: user.goalMinutes },
    });
  }

  async today(userId: string) {
    return this.locked(userId, async (tx, now, user) => {
      const day = await this.ensureDay(tx, user, now);
      const items = await tx.dailyItem.findMany({
        where: { dayId: day.id, selected: true },
        include: itemInclude,
        orderBy: { createdAt: 'asc' },
      });
      const yesterday = await tx.dailyItem.findMany({
        where: {
          day: { userId, date: previousDay(day.date) },
          selected: true,
          status: { not: 'COMPLETED' },
          task: { archived: false },
        },
        include: itemInclude,
        orderBy: { createdAt: 'asc' },
      });
      return {
        date: day.date,
        serverTime: now.toISOString(),
        goalTasks: day.goalTasks,
        goalMinutes: day.goalMinutes,
        items: items.map((i) => serializeItem(i, now)),
        yesterday: yesterday.map((i) => serializeItem(i, now)),
      };
    });
  }

  async select(userId: string, taskId: string, selected: boolean) {
    return this.locked(userId, async (tx, now, user) => {
      const task = await tx.task.findFirst({ where: { id: taskId, userId, archived: false } });
      if (!task) throw new AppError(404, '任务不存在或已归档');
      const day = await this.ensureDay(tx, user, now);
      const old = await tx.dailyItem.findUnique({
        where: { dayId_taskId: { dayId: day.id, taskId } },
      });
      if (old && ['RUNNING', 'PAUSED', 'COMPLETED'].includes(old.status))
        throw new AppError(409, '抽中的任务必须先完成，已完成的任务当天不能重复加入');
      return tx.dailyItem.upsert({
        where: { dayId_taskId: { dayId: day.id, taskId } },
        update: { selected },
        create: {
          dayId: day.id,
          taskId,
          title: task.title,
          note: task.note,
          color: task.color,
          selected,
        },
      });
    });
  }

  async selectMany(userId: string, date: string, changes: { taskId: string; selected: boolean }[]) {
    return this.locked(userId, async (tx, now, user) => {
      if (date !== dayKey(now)) throw new AppError(409, '已进入新的一天，请重新勾选今日任务');
      const day = await this.ensureDay(tx, user, now);
      const taskIds = changes.map((change) => change.taskId);
      const tasks = await tx.task.findMany({
        where: { id: { in: taskIds }, userId, archived: false },
      });
      if (tasks.length !== taskIds.length)
        throw new AppError(404, '任务不存在或已归档，请刷新后重新选择');
      const existing = await tx.dailyItem.findMany({
        where: { dayId: day.id, taskId: { in: taskIds } },
      });
      const byTask = new Map(existing.map((item) => [item.taskId, item]));
      for (const change of changes) {
        const item = byTask.get(change.taskId);
        if (item && item.status !== 'PENDING' && item.selected !== change.selected) {
          throw new AppError(409, '抽中的任务必须先完成，已完成的任务当天不能移出');
        }
      }
      const selected = new Set(
        changes.filter((change) => change.selected).map((change) => change.taskId),
      );
      const additions = tasks.filter((task) => selected.has(task.id) && !byTask.has(task.id));
      if (additions.length)
        await tx.dailyItem.createMany({
          data: additions.map((task) => ({
            dayId: day.id,
            taskId: task.id,
            title: task.title,
            note: task.note,
            color: task.color,
            selected: true,
          })),
        });
      const selects = existing
        .filter((item) => item.status === 'PENDING' && selected.has(item.taskId))
        .map((item) => item.id);
      const deselects = existing
        .filter((item) => item.status === 'PENDING' && !selected.has(item.taskId))
        .map((item) => item.id);
      if (selects.length)
        await tx.dailyItem.updateMany({ where: { id: { in: selects } }, data: { selected: true } });
      if (deselects.length)
        await tx.dailyItem.updateMany({
          where: { id: { in: deselects } },
          data: { selected: false },
        });
    });
  }

  async draw(userId: string, key: string) {
    return this.locked(userId, async (tx, now, user) => {
      const old = await tx.operation.findUnique({ where: { userId_key: { userId, key } } });
      if (old) {
        if (old.kind !== 'DRAW') throw new AppError(409, '请求标识已使用');
        const item = await tx.dailyItem.findUnique({
          where: { id: old.resultId },
          include: itemInclude,
        });
        if (!item) throw new AppError(409, '该抽取已失效');
        return serializeItem(item, now);
      }
      const day = await this.ensureDay(tx, user, now);
      if (
        await tx.dailyItem.findFirst({
          where: { dayId: day.id, status: { in: ['RUNNING', 'PAUSED'] } },
        })
      ) {
        throw new AppError(409, '先完成当前任务，再抽下一件事');
      }
      const pool = await tx.dailyItem.findMany({
        where: { dayId: day.id, selected: true, status: 'PENDING' },
        orderBy: { id: 'asc' },
      });
      if (!pool.length) throw new AppError(409, '先勾选今天想做的任务');
      const item = pool[randomInt(pool.length)];
      await tx.dailyItem.update({ where: { id: item.id }, data: { status: 'RUNNING' } });
      await this.startSegment(tx, item.id, day.date, user.timerCapMinutes, now);
      await tx.operation.create({ data: { userId, key, kind: 'DRAW', resultId: item.id } });
      return serializeItem(
        await tx.dailyItem.findUniqueOrThrow({ where: { id: item.id }, include: itemInclude }),
        now,
      );
    });
  }

  async startSegment(tx: Tx, itemId: string, date: string, cap: number, now: Date) {
    await tx.segment.create({
      data: {
        itemId,
        startedAt: now,
        deadline: new Date(Math.min(now.getTime() + cap * 60_000, nextMidnight(date).getTime())),
      },
    });
  }

  async control(userId: string, itemId: string, action: 'pause' | 'resume' | 'complete') {
    return this.locked(userId, async (tx, now, user) => {
      const item = await tx.dailyItem.findFirst({
        where: { id: itemId, day: { userId } },
        include: { day: true, ...itemInclude },
      });
      if (!item) throw new AppError(404, '任务不存在');
      if (item.status === 'COMPLETED' && action === 'complete') return serializeItem(item, now);
      if (item.day.date !== dayKey(now))
        throw new AppError(409, '已进入新的一天，请重新勾选今日任务');
      if (!['RUNNING', 'PAUSED'].includes(item.status)) throw new AppError(409, '请先抽取任务');
      if (action === 'resume' && item.status === 'PAUSED') {
        await this.startSegment(tx, item.id, item.day.date, user.timerCapMinutes, now);
      }
      if (action !== 'resume') {
        await tx.segment.updateMany({ where: { itemId, endedAt: null }, data: { endedAt: now } });
      }
      await tx.dailyItem.update({
        where: { id: itemId },
        data:
          action === 'complete'
            ? { status: 'COMPLETED', completedAt: now }
            : { status: action === 'pause' ? 'PAUSED' : 'RUNNING' },
      });
      return serializeItem(
        await tx.dailyItem.findUniqueOrThrow({ where: { id: itemId }, include: itemInclude }),
        now,
      );
    });
  }

  async settings(
    userId: string,
    data: { timerCapMinutes: number; goalTasks: number | null; goalMinutes: number | null },
  ) {
    return this.locked(userId, async (tx, now, user) => {
      await this.ensureDay(tx, user, now);
      return publicUser(
        await tx.user.update({
          where: { id: userId },
          data: {
            timerCapMinutes: data.timerCapMinutes,
            pendingGoalTasks: data.goalTasks,
            pendingGoalMinutes: data.goalMinutes,
            goalEffectiveDay: dayKey(nextMidnight(dayKey(now))),
          },
        }),
      );
    });
  }

  async stats(userId: string, year: number, month?: number) {
    return this.locked(userId, async (tx, now, user) => {
      await this.ensureDay(tx, user, now);
      // Calculate from records rather than mutable cached totals, so retries never inflate statistics.
      const days = await tx.day.findMany({
        where: { userId },
        include: { items: { include: itemInclude } },
        orderBy: { date: 'asc' },
      });
      const rows = days.map((day) => {
        const completed = day.items.filter((i) => i.status === 'COMPLETED').length;
        const seconds = day.items.reduce((s, i) => s + elapsedSeconds(i, now), 0);
        const hasGoal = day.goalTasks !== null || day.goalMinutes !== null;
        const achieved =
          hasGoal &&
          (day.goalTasks === null || completed >= day.goalTasks) &&
          (day.goalMinutes === null || seconds >= day.goalMinutes * 60);
        return {
          date: day.date,
          completed,
          seconds,
          goalTasks: day.goalTasks,
          goalMinutes: day.goalMinutes,
          hasGoal,
          achieved,
        };
      });
      const prefix = month ? `${year}-${String(month).padStart(2, '0')}` : String(year);
      const filtered = rows.filter((r) => r.date.startsWith(prefix));
      const map = new Map(rows.map((r) => [r.date, r]));
      const streak = (field: 'completed' | 'achieved') => {
        let date = dayKey(now),
          count = 0;
        if (!map.get(date)?.[field]) date = previousDay(date);
        while (map.get(date)?.[field]) {
          count++;
          date = previousDay(date);
        }
        return count;
      };
      const distribution = new Map<
        string,
        { taskId: string; title: string; color: string; seconds: number; completed: number }
      >();
      const history = [];
      for (const day of days.filter((d) => d.date.startsWith(prefix))) {
        for (const item of day.items) {
          const seconds = elapsedSeconds(item, now);
          if (seconds || item.status === 'COMPLETED') {
            const aggregate = distribution.get(item.taskId) ?? {
              taskId: item.taskId,
              title: item.title,
              color: item.color,
              seconds: 0,
              completed: 0,
            };
            aggregate.seconds += seconds;
            aggregate.completed += Number(item.status === 'COMPLETED');
            distribution.set(item.taskId, aggregate);
          }
          if (item.selected)
            history.push({
              id: item.id,
              date: day.date,
              title: item.title,
              color: item.color,
              status: item.status,
              seconds,
              completedAt: item.completedAt,
            });
        }
      }
      const goalDays = filtered.filter((r) => r.hasGoal && r.date <= dayKey(now));
      return {
        year,
        month: month ?? null,
        serverTime: now.toISOString(),
        days: filtered,
        totals: {
          completed: filtered.reduce((s, r) => s + r.completed, 0),
          seconds: filtered.reduce((s, r) => s + r.seconds, 0),
          activeDays: filtered.filter((r) => r.completed > 0).length,
          goalDays: goalDays.length,
          achievedDays: goalDays.filter((r) => r.achieved).length,
          activeStreak: streak('completed'),
          goalStreak: streak('achieved'),
        },
        distribution: [...distribution.values()].sort((a, b) => b.seconds - a.seconds),
        history: history.sort((a, b) => b.date.localeCompare(a.date)),
      };
    });
  }
}
