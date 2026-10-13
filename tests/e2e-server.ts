import { buildApp } from '../server/app.js';
import staticFiles from '@fastify/static';
import { resolve } from 'node:path';
import { clearTestDb, makeTestDb, seedUser } from './helpers.js';

const db = makeTestDb();
await clearTestDb(db);
await seedUser(db, 'browser_admin', 'ADMIN');
const { app } = await buildApp({ db, origin: 'http://127.0.0.1:3000', rateLimits: false });
await app.register(staticFiles, { root: resolve('dist/client') });
app.setNotFoundHandler((req, reply) =>
  req.url.startsWith('/api/')
    ? reply.code(404).send({ error: '接口不存在' })
    : reply.sendFile('index.html'),
);
await app.listen({ port: 3000, host: '127.0.0.1' });
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, async () => {
    await app.close();
    await db.$disconnect();
    process.exit(0);
  });
