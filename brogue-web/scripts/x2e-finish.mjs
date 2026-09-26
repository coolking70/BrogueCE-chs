// Runs only after the complete discovery pass. Unknown failures stop the chain.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const out = 'ai_docs/reports/x2e-evidence';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
while (!fs.existsSync(`${out}/regression-discovery.json`)
    || !fs.existsSync(`${out}/ur3-audit-pool.json.gz`)) await sleep(5000);
const report = JSON.parse(fs.readFileSync(`${out}/regression-discovery.json`));
const failedFiles = report.testResults.filter(f => f.status === 'failed');
const failures = failedFiles.map(f => f.name);
const resolvedTimeouts = [];
const resolvedPremises = [];
const unknown = failedFiles.filter(f => {
    if (/\/u_r[34]_trace\.test\.ts$/.test(f.name)) return false;
    if (/\/engine\/Items\/itemFlavors\.test\.ts$/.test(f.name)) {
        const before = JSON.parse(fs.readFileSync(`${out}/flavor-premises-before.json`));
        const after = JSON.parse(fs.readFileSync(`${out}/flavor-premises-after.json`));
        const names = f.assertionResults.filter(t => t.status === 'failed').map(t => t.fullName).sort();
        if (before.length !== 3 || before[0].failed !== 0 || before[1].failed !== 3 || before[2].failed !== 3
            || after.length !== 2 || after[0].passed !== 6 || after[0].failed !== 0 || after[1].failed !== 1
            || JSON.stringify(names) !== JSON.stringify([...before[2].failures].sort())) return true;
        resolvedPremises.push({ file: f.name, premise: 'CE charms are identified at birth; five unknown appearance categories',
            evidence: ['flavor-premises-before.json', 'flavor-premises-after.json'], acceptanceReview: true });
        return false;
    }
    if (!/\/w_5_arcana_instance\.test\.ts$/.test(f.name)
        || !fs.existsSync(`${out}/w5-recheck.json`)) return true;
    const repeat = JSON.parse(fs.readFileSync(`${out}/w5-recheck.json`));
    const failed = f.assertionResults.filter(t => t.status === 'failed');
    // Vitest JSON reports STACK_TRACE_ERROR for this synchronous timeout; its
    // default reporter retains the actual reason and configured 900s threshold.
    const section = fs.readFileSync(`${out}/regression-discovery.txt`, 'utf8')
        .split(' FAIL  src/test/w_5_arcana_instance.test.ts > ')[1]?.split('⎯')[0] ?? '';
    if (repeat.numFailedTests || repeat.numPassedTests !== f.assertionResults.length
        || repeat.testResults.length !== 1 || !failed.length
        || !section.includes('Error: Test timed out in 900000ms.')
        || failed.some(t => !t.failureMessages.every(m => /STACK_TRACE_ERROR|Test timed out in \d+ms/.test(m))
            || !repeat.testResults[0].assertionResults.some(r => r.fullName === t.fullName && r.status === 'passed'))) return true;
    resolvedTimeouts.push({ file: f.name, tests: failed.map(t => t.fullName), repeat: 'w5-recheck.json' });
    return false;
});
fs.writeFileSync(`${out}/discovery-summary.json`, JSON.stringify({
    files: report.testResults.length, passed: report.numPassedTests, failed: report.numFailedTests,
    failures, resolvedTimeouts, resolvedPremises, completed: true,
}, null, 2) + '\n');
if (unknown.length) {
    throw Error('Discovery has failures beyond attributed UR3/4 goldens or an unchanged passing timeout repeat; review before recapture.');
}
for (const script of ['x2e-trace-summary.mjs', 'x2e-recapture.mjs', 'x2e-final-check.mjs']) {
    const fd = fs.openSync(`${out}/${script.replace('.mjs', '')}.txt`, 'w');
    const result = spawnSync(process.execPath, [`scripts/${script}`], { stdio: ['ignore', fd, fd] });
    fs.closeSync(fd);
    if (result.status !== 0) throw Error(`${script} failed: ${result.status}`);
    console.log(`${script}: complete`);
}
