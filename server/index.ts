import { buildApp } from './app.js';
import staticFiles from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const { app, db, domain } = await buildApp({ logger: true });
const clientRoot = resolve('dist/client');
if (existsSync(clientRoot)) {
  await app.register(staticFiles, { root: clientRoot });
  app.setNotFoundHandler((req, reply) =>
    req.url.startsWith('/api/')
      ? reply.code(404).send({ error: '接口不存在' })
      : reply.sendFile('index.html'),
  );
}
const maintenance = setInterval(async () => {
  try {
    const userIds = await db.dailyItem.findMany({
      where: { status: { in: ['RUNNING', 'PAUSED'] } },
      select: { day: { select: { userId: true } } },
      distinct: ['dayId'],
    });
    for (const userId of new Set(userIds.map((i) => i.day.userId))) {
      try {
        await domain.locked(userId, async () => {});
      } catch {
        /* Disabled users are normalized on reactivation. */
      }
    }
    await db.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    await db.operation.deleteMany({
      where: { createdAt: { lt: new Date(Date.now() - 8 * 86_400_000) } },
    });
  } catch (err) {
    app.log.error({ err }, 'maintenance failed');
  }
}, 30_000);
maintenance.unref();
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, async () => {
    clearInterval(maintenance);
    await app.close();
    await db.$disconnect();
    process.exit(0);
  });
await app.listen({ port: Number(process.env.PORT ?? 3000), host: process.env.HOST ?? '0.0.0.0' });
