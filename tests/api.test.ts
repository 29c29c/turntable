import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../server/app.js';
import { dayKey, dayStart } from '../server/domain.js';
import { clearTestDb, fixturePassword, makeTestDb, seedUser } from './helpers.js';

const db = makeTestDb();
let now = new Date('2026-10-13T09:00:00+08:00');
let app: Awaited<ReturnType<typeof buildApp>>['app'];
type Auth = { cookie: string; csrf: string; id: string };
let admin: Auth, user: Auth;
const origin = 'http://127.0.0.1:3000';
async function login(username: string, pass = fixturePassword): Promise<Auth> {
  const r = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { origin },
    payload: { username, password: pass },
  });
  assert.equal(r.statusCode, 200, r.body);
  return {
    cookie: r.cookies.map((c) => `${c.name}=${c.value}`).join('; '),
    csrf: r.json().csrfToken,
    id: r.json().user.id,
  };
}
async function call(
  auth: Auth,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  url: string,
  payload?: unknown,
  headers: Record<string, string> = {},
) {
  return app.inject({
    method,
    url: `/api${url}`,
    headers: { origin, cookie: auth.cookie, 'x-csrf-token': auth.csrf, ...headers },
    ...(payload !== undefined ? { payload: payload as object } : {}),
  });
}
async function task(title = '读书') {
  const r = await call(user, 'POST', '/tasks', { title });
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
}
async function select(taskId: string) {
  const r = await call(user, 'PUT', '/today/selection', { taskId, selected: true });
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
}
async function draw(key = randomUUID()) {
  return call(user, 'POST', '/today/draw', undefined, { 'idempotency-key': key });
}
before(async () => {
  ({ app } = await buildApp({ db, now: () => now, origin, rateLimits: false }));
  await app.ready();
});
beforeEach(async () => {
  await clearTestDb(db);
  now = new Date('2026-10-13T09:00:00+08:00');
  await seedUser(db, 'fixture_admin', 'ADMIN');
  await seedUser(db);
  admin = await login('fixture_admin');
  user = await login('fixture_user');
});
after(async () => {
  await app.close();
  await db.$disconnect();
});

test('Beijing day boundaries are independent of host timezone', () => {
  assert.equal(dayKey(new Date('2026-10-13T15:59:59Z')), '2026-10-13');
  assert.equal(dayKey(new Date('2026-10-13T16:00:00Z')), '2026-10-14');
  assert.equal(dayStart('2026-10-14').toISOString(), '2026-10-13T16:00:00.000Z');
});
test('sessions, CSRF and Origin protect private mutations', async () => {
  assert.equal((await app.inject('/api/tasks')).statusCode, 401);
  assert.equal(
    (await call(user, 'POST', '/tasks', { title: 'x' }, { 'x-csrf-token': '' })).statusCode,
    403,
  );
  assert.equal(
    (await call(user, 'POST', '/tasks', { title: 'x' }, { origin: 'https://untrusted.example' }))
      .statusCode,
    403,
  );
  assert.equal((await call(user, 'GET', '/admin/users')).statusCode, 403);
  const r = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { origin },
    payload: { username: 'fixture_user', password: fixturePassword },
  });
  const cookie = r.headers['set-cookie'] as string;
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
});
test('single-use invitation is consumed atomically during parallel registrations', async () => {
  const created = await call(admin, 'POST', '/admin/invites', {
    count: 1,
    maxUses: 1,
    startsAt: new Date(now.getTime() - 60000).toISOString(),
    expiresAt: new Date(now.getTime() + 86400000).toISOString(),
  });
  const invite = created.json().codes[0];
  const result = await Promise.all(
    ['new_user_a', 'new_user_b'].map((username) =>
      app.inject({
        method: 'POST',
        url: '/api/auth/register',
        headers: { origin },
        payload: { username, password: fixturePassword, invite },
      }),
    ),
  );
  assert.deepEqual(result.map((r) => r.statusCode).sort(), [201, 400]);
  assert.equal((await db.invite.findFirstOrThrow()).usedCount, 1);
  assert.equal(await db.inviteRedemption.count(), 1);
  const list = (await call(admin, 'GET', '/admin/invites')).json();
  assert.equal(list[0].codeHash, undefined);
  assert.notEqual(list[0].codeHint, invite);
});
test('not-yet-valid, expired and disabled invitations reject registration', async () => {
  const r = await call(admin, 'POST', '/admin/invites', {
    count: 1,
    maxUses: 2,
    startsAt: new Date(now.getTime() + 60000).toISOString(),
    expiresAt: new Date(now.getTime() + 120000).toISOString(),
  });
  const invite = r.json().codes[0];
  const register = () =>
    app.inject({
      method: 'POST',
      url: '/api/auth/register',
      headers: { origin },
      payload: { username: 'future_user', password: fixturePassword, invite },
    });
  assert.equal((await register()).statusCode, 400);
  now = new Date(now.getTime() + 180000);
  assert.equal((await register()).statusCode, 400);
  now = new Date(now.getTime() - 100000);
  const record = await db.invite.findFirstOrThrow();
  await call(admin, 'PATCH', `/admin/invites/${record.id}`, { disabled: true });
  assert.equal((await register()).statusCode, 400);
  assert.equal((await db.invite.findFirstOrThrow()).usedCount, 0);
});
test('invalid or duplicate registration does not consume an invitation', async () => {
  const r = await call(admin, 'POST', '/admin/invites', {
    count: 1,
    maxUses: 2,
    startsAt: new Date(now.getTime() - 1).toISOString(),
    expiresAt: new Date(now.getTime() + 60000).toISOString(),
  });
  const invite = r.json().codes[0];
  const duplicate = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    headers: { origin },
    payload: { username: 'fixture_user', password: fixturePassword, invite },
  });
  assert.equal(duplicate.statusCode, 409);
  assert.equal((await db.invite.findFirstOrThrow()).usedCount, 0);
});
test('administrators can edit invitation windows and limits without erasing consumed uses', async () => {
  const created = await call(admin, 'POST', '/admin/invites', {
    count: 1,
    maxUses: 1,
    startsAt: new Date(now.getTime() - 60000).toISOString(),
    expiresAt: new Date(now.getTime() + 60000).toISOString(),
  });
  const invite = created.json().codes[0];
  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    headers: { origin },
    payload: { username: 'invite_editor_user', password: fixturePassword, invite },
  });
  assert.equal(registered.statusCode, 201);
  const record = await db.invite.findFirstOrThrow();
  const edited = await call(admin, 'PATCH', `/admin/invites/${record.id}`, {
    maxUses: 2,
    expiresAt: new Date(now.getTime() + 86400000).toISOString(),
  });
  assert.equal(edited.statusCode, 200);
  const updated = await db.invite.findUniqueOrThrow({ where: { id: record.id } });
  assert.equal(updated.maxUses, 2);
  assert.equal(updated.usedCount, 1);
  assert.equal(
    (
      await call(admin, 'PATCH', `/admin/invites/${record.id}`, {
        startsAt: updated.expiresAt.toISOString(),
      })
    ).statusCode,
    400,
  );
});
test('parallel draws choose only one item and retrying a request is idempotent', async () => {
  await select((await task('读书')).id);
  await select((await task('练习')).id);
  const key = randomUUID();
  const results = await Promise.all([draw(key), draw()]);
  assert.deepEqual(results.map((r) => r.statusCode).sort(), [200, 409]);
  const success = results.find((r) => r.statusCode === 200)!;
  const stored = await db.operation.findFirstOrThrow();
  const retry = await draw(stored.key);
  assert.equal(retry.statusCode, 200);
  assert.equal(retry.json().item.id, success.json().item.id);
  assert.equal(await db.segment.count(), 1);
  assert.equal(await db.dailyItem.count({ where: { status: 'RUNNING' } }), 1);
});
test('batch selection adds and removes tasks together, preserves other-device selections, and is repeatable', async () => {
  const a = await task('第一项'),
    b = await task('第二项'),
    c = await task('其他设备选择');
  await select(c.id);
  const payload = {
    date: '2026-10-13',
    changes: [
      { taskId: a.id, selected: true },
      { taskId: b.id, selected: true },
    ],
  };
  assert.equal((await call(user, 'PUT', '/today/selection/batch', payload)).json().items.length, 3);
  assert.equal((await call(user, 'PUT', '/today/selection/batch', payload)).json().items.length, 3);
  assert.equal(await db.dailyItem.count(), 3);
  const result = await call(user, 'PUT', '/today/selection/batch', {
    date: payload.date,
    changes: [
      { taskId: a.id, selected: false },
      { taskId: b.id, selected: false },
    ],
  });
  assert.deepEqual(
    result.json().items.map((item: { taskId: string }) => item.taskId),
    [c.id],
  );
});
test('invalid or locked batch selection rolls back all changes', async () => {
  const a = await task(),
    b = await task('待添加');
  await select(a.id);
  await draw();
  const result = await call(user, 'PUT', '/today/selection/batch', {
    date: '2026-10-13',
    changes: [
      { taskId: b.id, selected: true },
      { taskId: a.id, selected: false },
    ],
  });
  assert.equal(result.statusCode, 409);
  assert.equal(await db.dailyItem.count(), 1);
  await call(user, 'POST', `/today/${(await db.dailyItem.findFirstOrThrow()).id}/complete`);
  assert.equal(
    (
      await call(user, 'PUT', '/today/selection/batch', {
        date: '2026-10-13',
        changes: [{ taskId: a.id, selected: false }],
      })
    ).statusCode,
    409,
  );
  await seedUser(db, 'batch_other');
  const other = await login('batch_other');
  assert.equal(
    (
      await call(other, 'PUT', '/today/selection/batch', {
        date: '2026-10-13',
        changes: [{ taskId: b.id, selected: true }],
      })
    ).statusCode,
    404,
  );
});
test('batch selection rejects duplicate tasks and yesterday drafts without side effects', async () => {
  const a = await task();
  const change = { taskId: a.id, selected: true };
  assert.equal(
    (
      await call(user, 'PUT', '/today/selection/batch', {
        date: '2026-10-13',
        changes: [change, change],
      })
    ).statusCode,
    400,
  );
  now = new Date('2026-10-14T09:00:00+08:00');
  assert.equal(
    (await call(user, 'PUT', '/today/selection/batch', { date: '2026-10-13', changes: [change] }))
      .statusCode,
    409,
  );
  assert.equal(await db.dailyItem.count(), 0);
});
test('draw with missing idempotency key or empty pool is rejected', async () => {
  assert.equal((await call(user, 'POST', '/today/draw')).statusCode, 400);
  assert.equal((await draw()).statusCode, 409);
});
test('active item cannot be removed, archived or rerolled, including while paused', async () => {
  const t = await task();
  await select(t.id);
  const r = await draw(),
    id = r.json().item.id;
  assert.equal(
    (await call(user, 'PUT', '/today/selection', { taskId: t.id, selected: false })).statusCode,
    409,
  );
  assert.equal((await call(user, 'PATCH', `/tasks/${t.id}`, { archived: true })).statusCode, 409);
  await call(user, 'POST', `/today/${id}/pause`);
  assert.equal((await draw()).statusCode, 409);
});
test('pause excludes idle time, resume creates one segment, completion counts once', async () => {
  await select((await task()).id);
  const r = await draw(),
    id = r.json().item.id;
  now = new Date(now.getTime() + 600000);
  await call(user, 'POST', `/today/${id}/pause`);
  now = new Date(now.getTime() + 3600000);
  await call(user, 'POST', `/today/${id}/resume`);
  await call(user, 'POST', `/today/${id}/resume`);
  now = new Date(now.getTime() + 240000);
  const results = await Promise.all([
    call(user, 'POST', `/today/${id}/complete`),
    call(user, 'POST', `/today/${id}/complete`),
  ]);
  assert.ok(results.every((r) => r.statusCode === 200));
  const stats = (await call(user, 'GET', '/stats?year=2026&month=10')).json();
  assert.equal(stats.totals.seconds, 840);
  assert.equal(stats.totals.completed, 1);
  assert.equal(stats.totals.activeStreak, 1);
  assert.equal(await db.segment.count(), 2);
  assert.equal(await db.segment.count({ where: { endedAt: null } }), 0);
});
test('completed task remains in its template and cannot reappear that day', async () => {
  const t = await task();
  await select(t.id);
  const r = await draw(),
    id = r.json().item.id;
  await call(user, 'POST', `/today/${id}/complete`);
  assert.equal(
    (await call(user, 'PUT', '/today/selection', { taskId: t.id, selected: true })).statusCode,
    409,
  );
  assert.equal((await draw()).statusCode, 409);
  assert.equal(await db.task.count(), 1);
});
test('timer caps at 120 minutes even with no browser or maintenance requests', async () => {
  await select((await task()).id);
  const r = await draw(),
    id = r.json().item.id;
  now = new Date(now.getTime() + 3 * 3600000);
  const state = (await call(user, 'GET', '/today')).json();
  assert.equal(state.items[0].status, 'PAUSED');
  assert.equal(state.items[0].elapsedSeconds, 7200);
  assert.equal((await draw()).statusCode, 409);
  await call(user, 'POST', `/today/${id}/resume`);
  now = new Date(now.getTime() + 60000);
  const completed = (await call(user, 'POST', `/today/${id}/complete`)).json();
  assert.equal(completed.items[0].elapsedSeconds, 7260);
});
test('midnight stops yesterday precisely, unlocks today and supports manual carryover', async () => {
  now = new Date('2026-10-13T23:50:00+08:00');
  const t = await task();
  await select(t.id);
  await draw();
  now = new Date('2026-10-14T00:10:00+08:00');
  const state = (await call(user, 'GET', '/today')).json();
  assert.equal(state.items.length, 0);
  assert.equal(state.yesterday[0].status, 'EXPIRED');
  assert.equal(state.yesterday[0].elapsedSeconds, 600);
  await select(t.id);
  const r = await draw();
  assert.equal(r.statusCode, 200);
  const stats = (await call(user, 'GET', '/stats?year=2026')).json();
  assert.equal(stats.totals.completed, 0);
  assert.equal(stats.days[0].seconds, 600);
});
test('template edits and archives preserve historical names and durations', async () => {
  const t = await task('原始名称');
  await select(t.id);
  const r = await draw();
  now = new Date(now.getTime() + 120000);
  await call(user, 'POST', `/today/${r.json().item.id}/complete`);
  await call(user, 'PATCH', `/tasks/${t.id}`, { title: '新名称', archived: true });
  const stats = (await call(user, 'GET', '/stats?year=2026')).json();
  assert.equal(stats.history[0].title, '原始名称');
  assert.equal(stats.totals.seconds, 120);
});
test('goals apply tomorrow, both must be met, and historical snapshots survive later edits', async () => {
  await call(user, 'GET', '/today');
  await call(user, 'PUT', '/settings', { timerCapMinutes: 30, goalTasks: 1, goalMinutes: 2 });
  assert.equal((await call(user, 'GET', '/today')).json().goalTasks, null);
  now = new Date('2026-10-14T09:00:00+08:00');
  const t = await task();
  await select(t.id);
  const r = await draw();
  now = new Date(now.getTime() + 60000);
  await call(user, 'POST', `/today/${r.json().item.id}/complete`);
  let stats = (await call(user, 'GET', '/stats?year=2026')).json();
  assert.equal(stats.totals.achievedDays, 0);
  await call(user, 'PUT', '/settings', {
    timerCapMinutes: 120,
    goalTasks: null,
    goalMinutes: null,
  });
  now = new Date('2026-10-15T09:00:00+08:00');
  await call(user, 'GET', '/today');
  stats = (await call(user, 'GET', '/stats?year=2026')).json();
  assert.equal(stats.days.find((d: { date: string }) => d.date === '2026-10-14').goalTasks, 1);
  assert.equal(stats.days.at(-1).goalTasks, null);
});
test('user data is isolated, including guessed task and daily item ids', async () => {
  const other = await seedUser(db, 'other_user');
  const otherAuth = await login('other_user');
  const t = await task();
  await select(t.id);
  const r = await draw();
  assert.deepEqual((await call(otherAuth, 'GET', '/tasks')).json(), []);
  assert.equal(
    (await call(otherAuth, 'PUT', '/today/selection', { taskId: t.id, selected: true })).statusCode,
    404,
  );
  assert.equal(
    (await call(otherAuth, 'POST', `/today/${r.json().item.id}/complete`)).statusCode,
    404,
  );
  assert.equal(
    (await call(otherAuth, 'PATCH', `/tasks/${t.id}`, { title: 'hacked' })).statusCode,
    404,
  );
  assert.equal(other.id, otherAuth.id);
});
test('missed calendar days count toward goal rates, without rewriting their snapshots', async () => {
  await call(user, 'PUT', '/settings', { timerCapMinutes: 120, goalTasks: 1, goalMinutes: null });
  now = new Date('2026-10-17T09:00:00+08:00');
  const stats = (await call(user, 'GET', '/stats?year=2026')).json();
  assert.equal(stats.totals.goalDays, 4);
  assert.equal(stats.totals.achievedDays, 0);
  for (const date of ['2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17']) {
    assert.equal(stats.days.find((d: { date: string }) => d.date === date).goalTasks, 1);
  }
});
test('password reset revokes sessions and forces the next login to change the temporary password', async () => {
  const temporaryPassword = 'test-only-temporary-password';
  const r = await call(admin, 'POST', `/admin/users/${user.id}/reset-password`, {
    adminPassword: fixturePassword,
    temporaryPassword,
  });
  assert.equal(r.statusCode, 200);
  assert.equal((await call(user, 'GET', '/today')).statusCode, 401);
  const reset = await login('fixture_user', temporaryPassword);
  assert.equal((await call(reset, 'GET', '/today')).statusCode, 403);
  assert.equal(
    (
      await call(reset, 'POST', '/auth/password', {
        currentPassword: temporaryPassword,
        newPassword: fixturePassword,
      })
    ).statusCode,
    200,
  );
  assert.equal((await call(reset, 'GET', '/today')).statusCode, 200);
});
test('disable/re-enable invalidates sessions without deleting user data', async () => {
  await task();
  assert.equal(
    (await call(admin, 'PATCH', `/admin/users/${user.id}`, { disabled: true })).statusCode,
    200,
  );
  assert.equal((await call(user, 'GET', '/tasks')).statusCode, 401);
  assert.equal(
    (await call(admin, 'PATCH', `/admin/users/${user.id}`, { disabled: false })).statusCode,
    200,
  );
  const renewed = await login('fixture_user');
  assert.equal((await call(renewed, 'GET', '/tasks')).json().length, 1);
});
test('permanent deletion cascades all user records and rejects stale sessions', async () => {
  await select((await task()).id);
  await draw();
  assert.equal(
    (
      await call(admin, 'DELETE', `/admin/users/${user.id}`, {
        adminPassword: 'wrong-password',
        confirmUsername: 'fixture_user',
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await call(admin, 'DELETE', `/admin/users/${user.id}`, {
        adminPassword: fixturePassword,
        confirmUsername: 'wrong_user',
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await call(admin, 'DELETE', `/admin/users/${admin.id}`, {
        adminPassword: fixturePassword,
        confirmUsername: 'fixture_admin',
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await call(admin, 'DELETE', `/admin/users/${user.id}`, {
        adminPassword: fixturePassword,
        confirmUsername: 'fixture_user',
      })
    ).statusCode,
    200,
  );
  assert.equal(await db.user.count({ where: { id: user.id } }), 0);
  assert.equal(await db.task.count(), 0);
  assert.equal(await db.day.count(), 0);
  assert.equal(await db.dailyItem.count(), 0);
  assert.equal(await db.segment.count(), 0);
  assert.equal(await db.operation.count(), 0);
  assert.equal(await db.session.count({ where: { userId: user.id } }), 0);
  assert.equal((await call(user, 'GET', '/today')).statusCode, 401);
  const audit = await db.audit.findFirstOrThrow();
  assert.equal(audit.action, 'USER_PERMANENTLY_DELETED');
  assert.equal(Object.keys(audit).length, 3);
});
