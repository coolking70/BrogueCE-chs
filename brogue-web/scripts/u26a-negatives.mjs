import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const out = 'ai_docs/reports/u-26a-evidence';
const cases = [
    ['doors26', 'D26 and D39'], ['profile40', 'matches the CE'], ['quota', 'matches the CE'],
    ['origin', 'GEM birth'], ['gem-rng', 'GEM birth'], ['ordinary', 'food has priority'],
    ['merge-depths', 'same-depth stacks'], ['gem-slots', 'same-depth stacks'],
    ['drop-single', 'a real drop command'], ['water-single', 'a real wait in deep water'],
    ['portal', 'D40 portal rejects'], ['food-quota', 'seed 777:'], ['metered', 'seed 777:'],
];
const rows = [];
for (const [variant, title] of cases) {
    const json = `${out}/negative-${variant}.json`, fd = fs.openSync(`${out}/negative-${variant}.txt`, 'w');
    const r = spawnSync('npx', ['vitest', 'run', '--config', 'scripts/u26a-counterfactual.config.ts',
        'src/test/u_26a_deep_levels.test.ts', '-t', title, '--maxWorkers=1', '--reporter=json', `--outputFile=${json}`],
        { env: { ...process.env, U26A_VARIANT: variant }, stdio: ['ignore', fd, fd] });
    fs.closeSync(fd);
    const result = JSON.parse(fs.readFileSync(json));
    const failed = result.testResults.flatMap(f => f.assertionResults.filter(a => a.status === 'failed').map(a => ({ test: a.title, errors: a.failureMessages })));
    rows.push({ variant, title, exit: r.status, failed });
    fs.writeFileSync(`${out}/negatives.json`, JSON.stringify(rows, null, 2) + '\n');
    console.log(variant, failed.length ? 'DETECTED' : 'MISSED');
    if (r.status !== 1 || !failed.length) throw Error(`Invalid counterfactual ${variant}`);
}
