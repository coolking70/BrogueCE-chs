import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const out = 'ai_docs/reports/x2j-evidence';
const cases = {
    theft: 'steals category', equipped: 'excludes every', quantity: 'steals category',
    waypointRng: 'remembering a waypoint', accuracy: 'second attackHit', mode: 'steals category', recovery: 'thief keeps fleeing',
    memory: 'save/reload during flight', targetCache: 'target-owned map', safetyCache: 'safe terrain and ally maps',
    boltMode: 'PERM_FLEEING survives', throwMode: 'PERM_FLEEING survives', awareness: 'T5 ', scent: 'T5 |T6 ',
};
const results = [];
for (const [name, filter] of Object.entries(cases)) {
    if (process.argv.length > 2 && !process.argv.slice(2).includes(name)) continue;
    const test = ['awareness', 'scent'].includes(name) ? 'p4_8_scent_map' : 'x2j_monster_ai';
    const log = fs.openSync(`${out}/negative-${name}.txt`, 'w');
    const result = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', `src/test/${test}.test.ts`,
        '--config', 'scripts/x2j-negative.config.ts', '--maxWorkers=1', '-t', filter,
        '--reporter=json', `--outputFile=${out}/negative-${name}.json`], {
        env: { ...process.env, X2J_FAULT: name }, stdio: ['ignore', log, log],
    });
    fs.closeSync(log);
    const report = JSON.parse(fs.readFileSync(`${out}/negative-${name}.json`, 'utf8'));
    const row = { name, filter, exit: result.status, failed: report.numFailedTests,
        passed: report.numPassedTests, assertions: report.testResults.flatMap(t => t.assertionResults)
            .filter(a => a.status === 'failed').map(a => ({ name: a.fullName, message: a.failureMessages[0] })) };
    results.push(row); console.log(name, row.failed);
    if (!row.failed) throw new Error(`Mutation survived: ${name}`);
}
fs.writeFileSync(`${out}/negative-summary.json`, JSON.stringify(results, null, 2) + '\n');
