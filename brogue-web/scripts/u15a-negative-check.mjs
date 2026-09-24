// Counterfactual: the new contract must reject the pre-U15a implementation.
// Run before the final freeze, with no browser session using the dev server.
import fs from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const file = 'src/engine/Core/Game.ts', dir = 'ai_docs/reports/u-15a-evidence';
const original = fs.readFileSync(file), hash = b => crypto.createHash('sha256').update(b).digest('hex');
let outcome;
try {
    fs.writeFileSync(file, execFileSync('git', ['show', 'HEAD:brogue-web/src/engine/Core/Game.ts']));
    const fd = fs.openSync(`${dir}/negative-original.txt`, 'w');
    const result = spawnSync('npx', ['vitest', 'run', 'src/test/u_15a_shattering.test.ts', '--maxWorkers=1',
        '--reporter=default', '--reporter=json', `--outputFile.json=${dir}/negative-original.json`], { stdio: ['ignore', fd, fd] });
    fs.closeSync(fd);
    outcome = { status: result.status, signal: result.signal };
} finally {
    fs.writeFileSync(file, original);
    const restored = hash(fs.readFileSync(file)) === hash(original);
    fs.writeFileSync(`${dir}/negative-check.json`, JSON.stringify({ ...outcome, restored, restoredSha256: hash(original) }, null, 2) + '\n');
    assert.equal(restored, true);
}
assert.equal(outcome.status, 1);
const result = JSON.parse(fs.readFileSync(`${dir}/negative-original.json`, 'utf8'));
assert.ok(result.numFailedTests > 0);
console.log(JSON.stringify({ rejected: true, failed: result.numFailedTests, passed: result.numPassedTests }));
