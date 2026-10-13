import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);
const forbidden =
  /(^|\/)(\.env(?:\..*)?|backups|data|node_modules|qa|test-results|playwright-report)(\/|$)|\.(?:pem|key|dump|sql)$/;
const examples = new Set(['.env.example', '.env.production.example']);
const allowedSource = (file) =>
  examples.has(file) || /^prisma\/migrations\/[^/]+\/migration\.sql$/.test(file);
const patterns = [
  /-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/,
  /(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})/,
  /sk-(?:proj-)?[A-Za-z0-9_-]{30,}/,
];
let failed = false;
for (const file of files) {
  if (forbidden.test(file) && !allowedSource(file)) {
    console.error(`Forbidden tracked file: ${file}`);
    failed = true;
  }
  if (file === 'scripts/check-secrets.mjs') continue;
  const content = readFileSync(file, 'utf8');
  if (patterns.some((p) => p.test(content))) {
    console.error(`Possible secret in: ${file}`);
    failed = true;
  }
}
// Scan patch history without printing matched secret contents.
let history = '';
try {
  execFileSync('git', ['rev-parse', '--verify', 'HEAD'], { stdio: 'ignore' });
  history = execFileSync('git', ['log', '-p', '--all', '--format='], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  const historicalFiles = execFileSync('git', ['log', '--all', '--name-only', '--format='], {
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean);
  for (const file of new Set(historicalFiles)) {
    if (forbidden.test(file) && !allowedSource(file)) {
      console.error(`Forbidden file in history: ${file}`);
      failed = true;
    }
  }
} catch {
  /* A fresh repository has no commit history yet. */
}
if (patterns.some((p) => p.test(history))) {
  console.error('Possible secret in Git history');
  failed = true;
}
if (failed) process.exit(1);
console.log(`Checked ${files.length} tracked files and Git history. No detected secrets.`);
