import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'brogue-web/ai_docs/reports/x-2-evidence');
fs.mkdirSync(out, { recursive: true });
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
const files = git('ls-files', '-z').split('\0').filter(Boolean);
const hashes = Object.fromEntries(files.map(f => [f, crypto.createHash('sha256').update(fs.readFileSync(path.join(root, f))).digest('hex')]));
const phase = process.argv[2] ?? 'before';
const data = { timestamp: new Date().toISOString(), head: git('rev-parse', 'HEAD').trim(), status: git('status', '--short'), count: files.length, hashes };
fs.writeFileSync(path.join(out, `tracked-${phase}.json`), JSON.stringify(data, null, 2) + '\n');
if (phase === 'after') {
  const before = JSON.parse(fs.readFileSync(path.join(out, 'tracked-before.json'), 'utf8'));
  const changed = Object.keys(before.hashes).filter(f => before.hashes[f] !== hashes[f]);
  const comparison = { count: files.length, changed, headUnchanged: before.head === data.head, diff: git('diff', '--stat'), cachedDiff: git('diff', '--cached', '--stat'), status: data.status };
  fs.writeFileSync(path.join(out, 'tracked-comparison.json'), JSON.stringify(comparison, null, 2) + '\n');
  console.log(JSON.stringify(comparison));
} else console.log(JSON.stringify({ head: data.head, count: files.length, status: data.status }));
