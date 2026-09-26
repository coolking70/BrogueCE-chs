import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
const dir = 'ai_docs/reports/x2d-evidence';
const cases = [
    { variant: 'equipped-only', files: ['w_7_arcana_enchantment'], pattern: 'arcana alternative', expected: 0 },
    { variant: 'equipped-only', files: ['x2d_scroll_equipment'], pattern: 'accepts every valid', expected: 1 },
    { variant: 'random-runes', files: ['invented_content_pool', 'p1_37_machine_flag_i18n'], pattern: '8000|AD5c', expected: 0 },
    { variant: 'random-runes', files: ['x2d_scroll_equipment'], pattern: 'increments times|quiver roll', expected: 1 },
    { variant: 'old-uncurse-message', files: ['p1_37_machine_flag_i18n'], pattern: 'AD5a', expected: 0 },
    { variant: 'old-uncurse-message', files: ['x2d_scroll_equipment'], pattern: 'remove curse', expected: 1 },
];
const results = [];
for (const [index, spec] of cases.entries()) {
    const args = ['node_modules/vitest/vitest.mjs', 'run', '--config', 'scripts/x2d-counterfactual.config.ts', ...spec.files.map(f => `src/test/${f}.test.ts`), '-t', spec.pattern, '--reporter=json', `--outputFile=${dir}/counterfactual-${index}.json`];
    // Test names are passed as structured argv (no shell interpolation).
    const start = Date.now();
    const run = spawnSync(process.execPath, args, { env: { ...process.env, X2D_VARIANT: spec.variant }, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, windowsHide: true });
    fs.writeFileSync(`${dir}/counterfactual-${index}.txt`, `${run.stdout ?? ''}${run.stderr ?? ''}`.replaceAll('\r\n', '\n'));
    const data = fs.existsSync(`${dir}/counterfactual-${index}.json`) ? JSON.parse(fs.readFileSync(`${dir}/counterfactual-${index}.json`, 'utf8')) : null;
    const row = { ...spec, exit: run.status, seconds: (Date.now() - start) / 1000, passed: data?.numPassedTests, failed: data?.numFailedTests,
        failures: data?.testResults.flatMap(f => f.assertionResults.filter(t => t.status === 'failed').map(t => ({ name: t.fullName, message: t.failureMessages }))) };
    results.push(row); console.log(JSON.stringify(row));
}
fs.writeFileSync(`${dir}/counterfactual-summary.json`, JSON.stringify(results, null, 2) + '\n');
if (results.some(r => r.exit !== r.expected)) process.exitCode = 1;
