import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { Writable } from 'node:stream';

const db = new PrismaClient();
async function ask(prompt: string, hidden = false) {
  const output = hidden
    ? new Writable({
        write(_chunk, _encoding, callback) {
          callback();
        },
      })
    : stdout;
  if (hidden) stdout.write(prompt);
  const reader = createInterface({ input: stdin, output, terminal: Boolean(stdin.isTTY) });
  try {
    return await reader.question(hidden ? '' : prompt);
  } finally {
    reader.close();
    if (hidden) stdout.write('\n');
  }
}
try {
  const username = (
    process.env.ADMIN_USERNAME ?? (await ask('管理员用户名（3～32位字母、数字或下划线）：'))
  )
    .trim()
    .toLowerCase();
  const password =
    process.env.ADMIN_PASSWORD ?? (await ask('管理员密码（至少12位，输入隐藏）：', true));
  if (!/^[a-z0-9_]{3,32}$/.test(username) || password.length < 12 || password.length > 128)
    throw new Error('用户名或密码格式不正确');
  const passwordHash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(7362449)`;
    if (await tx.user.count({ where: { role: 'ADMIN' } }))
      throw new Error('管理员已存在，不会创建或覆盖已有管理员');
    await tx.user.create({ data: { username, passwordHash, role: 'ADMIN' } });
  });
  console.log('管理员已创建。请通过网站生成邀请码。');
} catch (error) {
  console.error(error instanceof Error ? error.message : '创建失败');
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
