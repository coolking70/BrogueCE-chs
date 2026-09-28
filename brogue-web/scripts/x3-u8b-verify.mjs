import fs from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const out = 'ai_docs/reports/x3-u8b-evidence';
fs.mkdirSync(out, { recursive: true });
const list = args => execFileSync('rg', args, { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
const sha = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const pattern = 'equipItem|unequip|dropItem|pickup|ITEM_PLAYER_AVOIDS|isAutoExploring|strength';
const references = list(['-l', '-g', '*.test.ts', pattern, 'src']);
const required = list(['--files', 'src', '-g', '*.test.ts']).filter(f => /\/(p1_30|u24|u_27_recording|x2a|x3_u[1-6]|x4a|fe_1_touch|i_1_interaction|u_r[234]|u_03)/.test(f));
const tests = [...new Set([...references, ...required, 'src/test/x3_u8b_items.test.ts'])].sort();
fs.writeFileSync(`${out}/test-selection.json`, JSON.stringify({pattern, references, required, tests}, null, 2) + '\n');
const inputs = [...list(['--files','src','scripts','-g','*.ts','-g','*.vue','-g','*.json']), 'package.json', 'package-lock.json', 'vite.config.ts'];
const frozen = Object.fromEntries(inputs.map(f => [f, sha(f)]));
fs.writeFileSync(`${out}/gate-inputs.json`, JSON.stringify(frozen, null, 2) + '\n');
const results = [];
for (const [name, cmd, args] of [
  ['types', 'npx', ['vue-tsc', '-b']],
  ['build', 'npm', ['run', 'build']],
  ['targeted', 'npx', ['vitest', 'run', ...tests, '--maxWorkers=1', '--no-file-parallelism', '--reporter=default', '--reporter=json', `--outputFile.json=${out}/targeted.json`]],
  ['drift', 'npm', ['run', 'test:drift', '--', '--maxWorkers=1', '--no-file-parallelism']],
]) {
  const start = new Date(), fd = fs.openSync(`${out}/${name}.txt`, 'w');
  console.log(name, 'started', start.toISOString(), name === 'targeted' ? `${tests.length} files, one worker` : '');
  const run = spawnSync(cmd, args, {stdio:['ignore', fd, fd]}); fs.closeSync(fd);
  results.push({name, command:[cmd,...args], exit:run.status, signal:run.signal, started:start.toISOString(), seconds:(Date.now()-start.getTime())/1000});
  fs.writeFileSync(`${out}/gate-results.json`, JSON.stringify(results,null,2)+'\n');
  console.log(name,'exit',run.status);
}
const changed = Object.entries(frozen).filter(([f,h])=>sha(f)!==h).map(([f])=>f);
fs.writeFileSync(`${out}/gate-integrity.json`, JSON.stringify({inputs:inputs.length,changed},null,2)+'\n');
if (changed.length || results.some(r=>r.exit!==0)) process.exitCode=1;
