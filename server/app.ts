import Fastify, { FastifyRequest, FastifyReply } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { PrismaClient, User } from '@prisma/client';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import argon2 from 'argon2';
import { z, ZodError } from 'zod';
import { AppError, Domain, publicUser, dayKey } from './domain.js';

declare module 'fastify' {
  interface FastifyRequest {
    currentUser: User | null;
    sessionId: string | null;
    csrf: string | null;
  }
}
const username = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_]{3,32}$/, '用户名为3～32位字母、数字或下划线');
const password = z.string().min(12, '密码至少12位').max(128, '密码最多128位');
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const token = () => randomBytes(32).toString('base64url');
const passwordOptions = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;
const safeEqual = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const paramId = (r: FastifyRequest) => z.object({ id: z.string().uuid() }).parse(r.params).id;
const taskInput = z.object({
  title: z.string().trim().min(1, '请输入任务名称').max(100),
  note: z.string().trim().max(500).default(''),
  color: z
    .string()
    .regex(/^#[a-fA-F0-9]{6}$/)
    .default('#a9c4fa'),
});

export async function buildApp(
  options: {
    db?: PrismaClient;
    now?: () => Date;
    logger?: boolean;
    origin?: string;
    rateLimits?: boolean;
  } = {},
) {
  const db = options.db ?? new PrismaClient();
  const domain = new Domain(db, options.now);
  const origin = options.origin ?? process.env.APP_ORIGIN ?? 'http://localhost:8080';
  const production = process.env.NODE_ENV === 'production';
  const allowedOrigins = new Set([
    origin,
    ...(!production
      ? [
          'http://localhost:5173',
          'http://127.0.0.1:5173',
          'http://127.0.0.1:3000',
          'http://localhost:3000',
        ]
      : []),
  ]);
  const app = Fastify({
    logger: options.logger
      ? {
          redact: [
            'req.headers.cookie',
            'req.headers.authorization',
            'req.headers["x-csrf-token"]',
          ],
        }
      : false,
    bodyLimit: 32 * 1024,
    trustProxy: (_address, hop) => hop < 1,
  });
  app.decorateRequest('currentUser', null);
  app.decorateRequest('sessionId', null);
  app.decorateRequest('csrf', null);
  await app.register(cookie);
  await app.register(rateLimit, {
    global: true,
    max: options.rateLimits === false ? 100_000 : 240,
    timeWindow: '1 minute',
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) return reply.code(error.status).send({ error: error.message });
    if (error instanceof ZodError)
      return reply.code(400).send({ error: error.issues[0]?.message ?? '输入格式不正确' });
    const failure = error as { code?: string; statusCode?: number };
    if (failure.code === 'P2002') return reply.code(409).send({ error: '该用户名或记录已存在' });
    if (failure.statusCode && failure.statusCode < 500)
      return reply
        .code(failure.statusCode)
        .send({ error: failure.statusCode === 429 ? '操作太频繁，请稍后再试' : '请求格式不正确' });
    request.log.error({ err: error }, 'request failed');
    return reply.code(500).send({ error: '服务暂时不可用，请稍后重试' });
  });
  app.addHook('onSend', async (req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'same-origin');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    reply.header(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
    if (req.url.startsWith('/api')) reply.header('Cache-Control', 'no-store');
    if (origin.startsWith('https://'))
      reply.header('Strict-Transport-Security', 'max-age=31536000');
  });
  app.addHook('preHandler', async (req) => {
    const path = req.url.split('?')[0];
    if (!path.startsWith('/api/')) return;
    const mutation = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    if (mutation && (!req.headers.origin || !allowedOrigins.has(req.headers.origin)))
      throw new AppError(403, '请求来源不受信任');
    const rawSession = req.cookies.session;
    if (rawSession && rawSession.length < 200) {
      const session = await db.session.findUnique({
        where: { id: hash(rawSession) },
        include: { user: true },
      });
      if (session && session.expiresAt > domain.now() && !session.user.disabled) {
        req.currentUser = session.user;
        req.sessionId = session.id;
        req.csrf = session.csrfToken;
      }
    }
    const publicRoute = ['/api/health', '/api/auth/login', '/api/auth/register'].includes(path);
    if (publicRoute) return;
    if (!req.currentUser) throw new AppError(401, '请先登录');
    if (mutation) {
      const csrf = req.headers['x-csrf-token'];
      if (typeof csrf !== 'string' || !req.csrf || !safeEqual(csrf, req.csrf))
        throw new AppError(403, '安全校验失败，请刷新页面');
    }
    if (
      req.currentUser.mustChangePassword &&
      !['/api/auth/me', '/api/auth/logout', '/api/auth/password'].includes(path)
    )
      throw new AppError(403, '请先修改临时密码');
    if (path.startsWith('/api/admin/') && req.currentUser.role !== 'ADMIN')
      throw new AppError(403, '仅管理员可执行此操作');
  });
  const createSession = async (userId: string, reply: FastifyReply) => {
    const raw = token();
    const csrfToken = token();
    const expiresAt = new Date(domain.now().getTime() + 7 * 86_400_000);
    await db.session.create({ data: { id: hash(raw), userId, csrfToken, expiresAt } });
    reply.setCookie('session', raw, {
      httpOnly: true,
      sameSite: 'lax',
      secure: origin.startsWith('https://'),
      path: '/',
      maxAge: 7 * 86400,
    });
    return csrfToken;
  };
  const dummyPasswordHash = await argon2.hash('unavailable-account-password', passwordOptions);
  const authLimit = {
    config: {
      rateLimit: { max: options.rateLimits === false ? 100_000 : 10, timeWindow: '1 minute' },
    },
  };
  app.get('/api/health', async (_req, reply) => {
    try {
      await db.$queryRaw`SELECT 1`;
      return { status: 'ok' };
    } catch {
      return reply.code(503).send({ status: 'unavailable' });
    }
  });
  app.post('/api/auth/register', authLimit, async (req, reply) => {
    const data = z
      .object({ username, password, invite: z.string().trim().min(8).max(100) })
      .parse(req.body);
    const passwordHash = await argon2.hash(data.password, passwordOptions);
    const user = await db.$transaction(async (tx) => {
      const codeHash = hash(data.invite);
      await tx.$queryRaw`SELECT id FROM "Invite" WHERE "codeHash" = ${codeHash} FOR UPDATE`;
      const invite = await tx.invite.findUnique({ where: { codeHash } });
      const now = domain.now();
      if (
        !invite ||
        invite.disabled ||
        now < invite.startsAt ||
        now >= invite.expiresAt ||
        invite.usedCount >= invite.maxUses
      )
        throw new AppError(400, '邀请码无效、尚未生效或已用完');
      const user = await tx.user.create({ data: { username: data.username, passwordHash } });
      await tx.invite.update({ where: { id: invite.id }, data: { usedCount: { increment: 1 } } });
      await tx.inviteRedemption.create({ data: { userId: user.id, inviteId: invite.id } });
      return user;
    });
    return reply
      .code(201)
      .send({ user: publicUser(user), csrfToken: await createSession(user.id, reply) });
  });
  app.post('/api/auth/login', authLimit, async (req, reply) => {
    const data = z.object({ username, password: z.string().min(1).max(128) }).parse(req.body);
    const user = await db.user.findUnique({ where: { username: data.username } });
    // Run the expensive verifier for unknown accounts too, reducing account enumeration by timing.
    const fallbackHash = user ? user.passwordHash : dummyPasswordHash;
    const valid = await argon2.verify(fallbackHash, data.password);
    if (!user || !valid || user.disabled) throw new AppError(401, '用户名或密码错误，或账号已停用');
    if (req.sessionId) await db.session.deleteMany({ where: { id: req.sessionId } });
    return { user: publicUser(user), csrfToken: await createSession(user.id, reply) };
  });
  app.get('/api/auth/me', async (req) => {
    await domain.today(req.currentUser!.id);
    return {
      user: publicUser(await db.user.findUniqueOrThrow({ where: { id: req.currentUser!.id } })),
      csrfToken: req.csrf,
    };
  });
  app.post('/api/auth/logout', async (req, reply) => {
    await db.session.deleteMany({ where: { id: req.sessionId! } });
    reply.clearCookie('session', { path: '/' });
    return { ok: true };
  });
  app.post('/api/auth/password', authLimit, async (req) => {
    const data = z
      .object({ currentPassword: z.string().max(128), newPassword: password })
      .parse(req.body);
    if (!(await argon2.verify(req.currentUser!.passwordHash, data.currentPassword)))
      throw new AppError(400, '当前密码不正确');
    const passwordHash = await argon2.hash(data.newPassword, passwordOptions);
    await domain.locked(req.currentUser!.id, async (tx) => {
      await tx.user.update({
        where: { id: req.currentUser!.id },
        data: { passwordHash, mustChangePassword: false },
      });
      await tx.session.deleteMany({
        where: { userId: req.currentUser!.id, id: { not: req.sessionId! } },
      });
    });
    return { ok: true };
  });

  app.get('/api/tasks', async (req) =>
    db.task.findMany({ where: { userId: req.currentUser!.id }, orderBy: { createdAt: 'asc' } }),
  );
  app.post('/api/tasks', async (req) => {
    const data = taskInput.parse(req.body);
    return domain.locked(req.currentUser!.id, (tx) =>
      tx.task.create({ data: { ...data, userId: req.currentUser!.id } }),
    );
  });
  app.patch('/api/tasks/:id', async (req) => {
    const data = taskInput.extend({ archived: z.boolean().optional() }).partial().parse(req.body);
    const id = paramId(req);
    return domain.locked(req.currentUser!.id, async (tx, now) => {
      const task = await tx.task.findFirst({ where: { id, userId: req.currentUser!.id } });
      if (!task) throw new AppError(404, '任务不存在');
      if (data.archived) {
        const active = await tx.dailyItem.findFirst({
          where: { taskId: id, day: { date: dayKey(now) }, status: { in: ['RUNNING', 'PAUSED'] } },
        });
        if (active) throw new AppError(409, '请先完成当前任务，再归档');
        await tx.dailyItem.updateMany({
          where: { taskId: id, status: 'PENDING', day: { date: dayKey(now) } },
          data: { selected: false },
        });
      }
      return tx.task.update({ where: { id }, data });
    });
  });
  app.get('/api/today', async (req) => domain.today(req.currentUser!.id));
  app.put('/api/today/selection', async (req) => {
    const data = z.object({ taskId: z.string().uuid(), selected: z.boolean() }).parse(req.body);
    await domain.select(req.currentUser!.id, data.taskId, data.selected);
    return domain.today(req.currentUser!.id);
  });
  app.put('/api/today/selection/batch', { bodyLimit: 128 * 1024 }, async (req) => {
    const data = z
      .object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        changes: z
          .array(z.object({ taskId: z.string().uuid(), selected: z.boolean() }))
          .max(1000)
          .refine(
            (changes) => new Set(changes.map((change) => change.taskId)).size === changes.length,
            '任务不能重复',
          ),
      })
      .parse(req.body);
    await domain.selectMany(req.currentUser!.id, data.date, data.changes);
    return domain.today(req.currentUser!.id);
  });
  app.post('/api/today/draw', async (req) => {
    const key = z.string().uuid('缺少有效的请求标识').parse(req.headers['idempotency-key']);
    const item = await domain.draw(req.currentUser!.id, key);
    return { item, today: await domain.today(req.currentUser!.id) };
  });
  app.post('/api/today/:id/:action', async (req) => {
    const params = z
      .object({ id: z.string().uuid(), action: z.enum(['pause', 'resume', 'complete']) })
      .parse(req.params);
    await domain.control(req.currentUser!.id, params.id, params.action);
    return domain.today(req.currentUser!.id);
  });
  app.put('/api/settings', async (req) => {
    const data = z
      .object({
        timerCapMinutes: z.number().int().min(15).max(240),
        goalTasks: z.number().int().min(1).max(100).nullable(),
        goalMinutes: z.number().int().min(1).max(1440).nullable(),
      })
      .parse(req.body);
    return domain.settings(req.currentUser!.id, data);
  });
  app.get('/api/stats', async (req) => {
    const query = z
      .object({
        year: z.coerce.number().int().min(2000).max(2100),
        month: z.coerce.number().int().min(1).max(12).optional(),
      })
      .parse(req.query);
    return domain.stats(req.currentUser!.id, query.year, query.month);
  });

  app.get('/api/admin/invites', async () =>
    db.invite.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        codeHint: true,
        startsAt: true,
        expiresAt: true,
        maxUses: true,
        usedCount: true,
        disabled: true,
        createdAt: true,
      },
    }),
  );
  app.post('/api/admin/invites', async (req) => {
    const data = z
      .object({
        count: z.number().int().min(1).max(50),
        maxUses: z.number().int().min(1).max(10000),
        startsAt: z.string().datetime(),
        expiresAt: z.string().datetime(),
      })
      .parse(req.body);
    if (
      new Date(data.expiresAt) <= new Date(data.startsAt) ||
      new Date(data.expiresAt) <= domain.now()
    )
      throw new AppError(400, '失效时间必须晚于生效时间和当前时间');
    const codes = Array.from(
      { length: data.count },
      () => `TT-${randomBytes(12).toString('hex').toUpperCase()}`,
    );
    await db.$transaction(async (tx) => {
      await tx.invite.createMany({
        data: codes.map((code) => ({
          codeHash: hash(code),
          codeHint: `${code.slice(0, 6)}…${code.slice(-4)}`,
          startsAt: new Date(data.startsAt),
          expiresAt: new Date(data.expiresAt),
          maxUses: data.maxUses,
        })),
      });
      await tx.audit.create({ data: { action: 'INVITES_CREATED' } });
    });
    return { codes };
  });
  app.patch('/api/admin/invites/:id', async (req) => {
    const id = paramId(req);
    const data = z
      .object({
        disabled: z.boolean().optional(),
        startsAt: z.string().datetime().optional(),
        expiresAt: z.string().datetime().optional(),
        maxUses: z.number().int().min(1).max(10000).optional(),
      })
      .parse(req.body);
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Invite" WHERE id = ${id} FOR UPDATE`;
      const invite = await tx.invite.findUnique({ where: { id } });
      if (!invite) throw new AppError(404, '邀请码不存在');
      const startsAt = data.startsAt ? new Date(data.startsAt) : invite.startsAt;
      const expiresAt = data.expiresAt ? new Date(data.expiresAt) : invite.expiresAt;
      if (expiresAt <= startsAt || (data.maxUses !== undefined && data.maxUses < invite.usedCount))
        throw new AppError(400, '时间范围不正确，或使用上限小于已使用次数');
      await tx.invite.update({ where: { id }, data: { ...data, startsAt, expiresAt } });
      await tx.audit.create({ data: { action: 'INVITE_STATUS_CHANGED' } });
    });
    return { ok: true };
  });
  app.get('/api/admin/users', async () =>
    db.user.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        username: true,
        role: true,
        disabled: true,
        createdAt: true,
        _count: { select: { tasks: true, days: true } },
      },
    }),
  );
  app.patch('/api/admin/users/:id', async (req) => {
    const id = paramId(req);
    const data = z.object({ disabled: z.boolean() }).parse(req.body);
    if (id === req.currentUser!.id) throw new AppError(400, '不能停用自己的账号');
    await domain
      .locked(id, async (tx) => {
        await tx.user.update({ where: { id }, data });
        if (data.disabled) await tx.session.deleteMany({ where: { userId: id } });
        await tx.audit.create({ data: { action: 'USER_STATUS_CHANGED' } });
      })
      .catch(async (error) => {
        // Disabled users still need to be re-enabled by an administrator.
        if (error instanceof AppError && error.status === 401 && !data.disabled) {
          await db.$transaction(async (tx) => {
            if (!(await tx.user.findUnique({ where: { id } })))
              throw new AppError(404, '用户不存在');
            await tx.user.update({ where: { id }, data });
            await tx.audit.create({ data: { action: 'USER_STATUS_CHANGED' } });
          });
        } else throw error;
      });
    return { ok: true };
  });
  app.post('/api/admin/users/:id/reset-password', authLimit, async (req) => {
    const id = paramId(req);
    const data = z
      .object({ adminPassword: z.string().max(128), temporaryPassword: password })
      .parse(req.body);
    if (id === req.currentUser!.id) throw new AppError(400, '请在个人设置中修改自己的密码');
    if (!(await argon2.verify(req.currentUser!.passwordHash, data.adminPassword)))
      throw new AppError(403, '管理员密码不正确');
    const passwordHash = await argon2.hash(data.temporaryPassword, passwordOptions);
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${id} FOR UPDATE`;
      if (!(await tx.user.findUnique({ where: { id } }))) throw new AppError(404, '用户不存在');
      await tx.user.update({ where: { id }, data: { passwordHash, mustChangePassword: true } });
      await tx.session.deleteMany({ where: { userId: id } });
      await tx.audit.create({ data: { action: 'USER_PASSWORD_RESET' } });
    });
    return { ok: true };
  });
  app.delete('/api/admin/users/:id', authLimit, async (req) => {
    const id = paramId(req);
    const data = z
      .object({ adminPassword: z.string().max(128), confirmUsername: z.string() })
      .parse(req.body);
    if (id === req.currentUser!.id) throw new AppError(400, '管理员不能删除自己');
    if (!(await argon2.verify(req.currentUser!.passwordHash, data.adminPassword)))
      throw new AppError(403, '管理员密码不正确');
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${id} FOR UPDATE`;
      const target = await tx.user.findUnique({ where: { id } });
      if (!target) throw new AppError(404, '用户不存在');
      if (target.username !== data.confirmUsername) throw new AppError(400, '确认用户名不匹配');
      await tx.user.delete({ where: { id } });
      await tx.audit.create({ data: { action: 'USER_PERMANENTLY_DELETED' } });
    });
    return { ok: true };
  });
  app.get('/api/admin/audit', async () =>
    db.audit.findMany({ take: 100, orderBy: { createdAt: 'desc' } }),
  );
  return { app, db, domain };
}
