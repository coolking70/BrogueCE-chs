// One real mutation, isolated named test, always restore source byte-for-byte.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const file = 'src/engine/Movement/CreaturePlacement.ts';
const dir = 'ai_docs/reports/w-11-evidence';
const original = fs.readFileSync(file, 'utf8');
const needle = 'return ![world.player, ...world.monsters, ...(world.dormantMonsters ?? [])].some';
const mutated = original.replace(needle, 'return !([] as Creature[]).some');
if (original === mutated) throw Error('mutation did not apply');
const sha = s => createHash('sha256').update(s).digest('hex');
let result;
try {
    fs.writeFileSync(file, mutated);
    result = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', 'src/test/w_11_teleport_placement.test.ts', '-t', 'commit revalidates live occupation'], { encoding: 'utf8' });
    fs.writeFileSync(`${dir}/negative-occupancy.log`, result.stdout + result.stderr);
} finally {
    fs.writeFileSync(file, original);
}
const summary = { mutation: 'remove every occupancy check', test: 'commit revalidates live occupation', exitCode: result.status, before: sha(original), restored: sha(fs.readFileSync(file)), restoredExactly: fs.readFileSync(file, 'utf8') === original };
fs.writeFileSync(`${dir}/negative-occupancy.json`, JSON.stringify(summary, null, 2) + '\n');
console.log(summary);
if (result.status !== 1 || !summary.restoredExactly || !result.stdout.includes('expected true to be false')) process.exitCode = 1;
