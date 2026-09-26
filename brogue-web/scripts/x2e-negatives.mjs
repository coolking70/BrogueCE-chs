import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const out = 'ai_docs/reports/x2e-evidence';
const cases = [
    ['duration', '624 compiled'], ['fixedpoint', '624 compiled'], ['short', '624 compiled'],
    ['seizure', 'overwrites levitation'], ['shattering', 'shatters through walls'],
    ['lifespan', 'summons a grounded'], ['placement', 'summons a grounded'],
    ['binding', 'summons a grounded'], ['expiration', 'summons a grounded'],
    ['teleport', 'terrain-aware teleport'], ['recharge', 'recharges every staff'],
    ['negation', 'negates self'], ['cooldown', 'overwrites levitation'],
    ['enchant', 'retains birth range'], ['pool', 'matches all twelve CE'],
];
const results = [];
for (const [variant, title] of cases) {
    const json = `${out}/negative-${variant}.json`, fd = fs.openSync(`${out}/negative-${variant}.txt`, 'w');
    const run = spawnSync('npx', ['vitest', 'run', '--config', 'scripts/x2e-counterfactual.config.ts',
        'src/test/x2e_charms.test.ts', '-t', title, '--maxWorkers=1', '--reporter=json', `--outputFile=${json}`],
        { env: { ...process.env, X2E_VARIANT: variant }, stdio: ['ignore', fd, fd] });
    fs.closeSync(fd);
    const report = JSON.parse(fs.readFileSync(json));
    const failures = report.testResults.flatMap(f => f.assertionResults.filter(a => a.status === 'failed')
        .map(a => ({ test: a.fullName, messages: a.failureMessages })));
    results.push({ variant, title, exit: run.status, failures });
    fs.writeFileSync(`${out}/negatives.json`, JSON.stringify(results, null, 2) + '\n');
    if (run.status !== 1 || !failures.length) throw Error(`Counterfactual not detected: ${variant}`);
    console.log(`${variant}: detected`);
}
