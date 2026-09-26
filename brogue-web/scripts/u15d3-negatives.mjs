import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const out = 'ai_docs/reports/u-15d3-evidence';
const variants = ['W_MULTIPLICITY', 'W_SLOWING', 'W_PLENTY', 'A_MULTIPLICITY', 'A_BURDEN', 'A_VULNERABILITY', 'A_IMMOLATION',
    'weapon-pool', 'armor-pool', 'weapon-threshold', 'armor-threshold', 'throwing-strip', 'curse-sign', 'no-runic-bit',
    'vorpal-depth', 'vorpal-extra-draw', 'vorpal-frequency'];
const rows = [];
for (const variant of variants) {
    const file = `${out}/negative-${variant}.json`, fd = fs.openSync(`${out}/negative-${variant}.txt`, 'w');
    const r = spawnSync('npx', ['vitest', 'run', 'src/test/u_15d3_runic_generation.test.ts', '--maxWorkers=1',
        '--config=scripts/u15d3-counterfactual.config.ts', '--reporter=json', `--outputFile=${file}`],
    { env: { ...process.env, U15D3_VARIANT: variant }, stdio: ['ignore', fd, fd] });
    fs.closeSync(fd);
    const report = JSON.parse(fs.readFileSync(file));
    rows.push({ variant, exit: r.status, failed: report.numFailedTests,
        assertions: report.testResults.flatMap(f => f.assertionResults.filter(a => a.status === 'failed').map(a => a.fullName)) });
    fs.writeFileSync(`${out}/negative-summary.json`, JSON.stringify(rows, null, 2) + '\n');
    if (r.status !== 1 || !report.numFailedTests) throw Error(`Undetected mutation: ${variant}`);
    console.log(variant, 'detected');
}
