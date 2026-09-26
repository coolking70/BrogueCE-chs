import fs from 'node:fs';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
const out = 'ai_docs/reports/x2e-evidence';
const original = process.argv.includes('--original');
const rows = [];
if (original) fs.writeFileSync(`${out}/itemFlavors-original.test.ts.txt`, execFileSync('git', ['show', 'HEAD:brogue-web/src/engine/Items/itemFlavors.test.ts']));
for (const [stage, bad] of original ? [['s0', false], ['effects', false], ['pool', false]] : [['pool', false], ['pool', true]]) {
    const name = `flavors-${original ? 'original' : 'ce-premise'}-${stage}${bad ? '-bad-birth' : ''}`;
    const fd = fs.openSync(`${out}/${name}.txt`, 'w');
    const result = spawnSync('npx', ['vitest', 'run', 'src/engine/Items/itemFlavors.test.ts',
        '--config', 'scripts/x2e-flavor-premises.config.ts', '--maxWorkers=1', '--reporter=default', '--reporter=json', `--outputFile=${out}/${name}.json`], {
        env: { ...process.env, X2E_FLAVOR_STAGE: stage, X2E_FLAVOR_ORIGINAL: original ? '1' : '0', X2E_FLAVOR_BAD_BIRTH: bad ? '1' : '0' },
        stdio: ['ignore', fd, fd],
    });
    fs.closeSync(fd);
    const report = JSON.parse(fs.readFileSync(`${out}/${name}.json`));
    const expectedFailures = original ? stage === 's0' ? 0 : 3 : bad ? 1 : 0;
    rows.push({ name, exit: result.status, passed: report.numPassedTests, failed: report.numFailedTests,
        failures: report.testResults.flatMap(f => f.assertionResults.filter(a => a.status === 'failed').map(a => a.fullName)) });
    assert.equal(report.numFailedTests, expectedFailures);
    assert.equal(result.status, expectedFailures ? 1 : 0);
}
fs.writeFileSync(`${out}/flavor-premises-${original ? 'before' : 'after'}.json`, JSON.stringify(rows, null, 2) + '\n');
console.log(JSON.stringify(rows, null, 2));
