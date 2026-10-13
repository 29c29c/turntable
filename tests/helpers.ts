import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';

export function testDatabaseUrl() {
  const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url || !new URL(url).pathname.endsWith('_test'))
    throw new Error(
      'Tests require a dedicated database with a name ending in _test. Set TEST_DATABASE_URL.',
    );
  return url;
}
export const makeTestDb = () => new PrismaClient({ datasourceUrl: testDatabaseUrl() });
export async function clearTestDb(db: PrismaClient) {
  testDatabaseUrl();
  await db.$executeRawUnsafe('TRUNCATE "User", "Invite", "Audit" CASCADE');
}
export const fixturePassword = 'test-fixture-only-password-2026';
export async function seedUser(db: PrismaClient, username = 'fixture_user', role = 'USER') {
  return db.user.create({
    data: {
      username,
      role,
      passwordHash: await argon2.hash(fixturePassword, {
        type: argon2.argon2id,
        memoryCost: 19456,
        timeCost: 2,
        parallelism: 1,
      }),
    },
  });
}
