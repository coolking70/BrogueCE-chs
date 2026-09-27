import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';

const root = process.cwd();
const out = 'ai_docs/reports/x2n-evidence';
fs.mkdirSync(out, { recursive: true });
const write = (name, value) => fs.writeFileSync(`${out}/${name}.json`, JSON.stringify(value, null, 2) + '\n');
const read = name => JSON.parse(fs.readFileSync(`${out}/${name}.json`, 'utf8'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const git = args => execFileSync('git', args, { maxBuffer: 64 * 1024 * 1024 });
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory()
    ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]);
const inputs = () => [...walk('src'), ...walk('public'), ...walk('scripts'),
    'package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json']
    .sort().map(file => ({ file, sha256: sha(fs.readFileSync(file)) }));

function closure() {
    const tests = walk('src').filter(f => f.endsWith('.test.ts'));
    const R = tests.filter(f => /p1_30|u24_|u_26[ab]|u_27_|p1_24|generation_baseline|snapshotQuantity/.test(f)
        || /Endgame|HighScores|gameOver|triggerGameOver|exportRecording|loadReplay|Inventory/.test(fs.readFileSync(f, 'utf8')));
    // Include every filesystem-reading test, including reads in imported local helpers.
    function readsFiles(file, seen = new Set()) {
        if (seen.has(file)) return false;
        seen.add(file);
        const text = fs.readFileSync(file, 'utf8');
        if (/readFile|readdir|node:fs|['"]fs(?:\/promises)?['"]/.test(text)) return true;
        for (const match of text.matchAll(/(?:from\s*|import\s*\()\s*['"](\.[^'"]+)['"]/g)) {
            const base = path.resolve(path.dirname(file), match[1]);
            const imported = [base, `${base}.ts`, `${base}/index.ts`].find(f => fs.existsSync(f) && fs.statSync(f).isFile());
            if (imported && /\.(ts|vue)$/.test(imported) && readsFiles(imported, seen)) return true;
        }
        return false;
    }
    const S = tests.filter(f => readsFiles(f));
    return { R, S, union: [...new Set([...R, ...S])].sort() };
}

async function run(name, args) {
    const started = new Date().toISOString();
    const npmCli = path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
    let output = '';
    const child = spawn(process.execPath, [npmCli, ...args], { cwd: root, windowsHide: true });
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    const exitCode = await new Promise((resolve, reject) => {
        child.on('error', reject);
        child.on('close', resolve);
    });
    fs.writeFileSync(`${out}/${name}.txt`, output.replace(/\r\n/g, '\n'));
    const result = { command: `npm ${args.join(' ')}`, started, finished: new Date().toISOString(), exitCode };
    write(`${name}-run`, result);
    console.log(JSON.stringify(result));
    return exitCode;
}

if (process.argv[2] === 'run') {
    write('frozen-inputs', { at: new Date().toISOString(), head: git(['rev-parse', 'HEAD']).toString().trim(), files: inputs() });
    write('rs-closure', closure());
    let failed = 0;
    for (const [name, args] of [
        ['build', ['run', 'build']],
        ['drift', ['run', 'test:drift', '--', '--maxWorkers=1', '--reporter=json', `--outputFile=${out}/drift.json`]],
        ['full', ['test', '--', '--maxWorkers=2', '--reporter=json', `--outputFile=${out}/full.json`]]
    ]) failed |= (await run(name, args)) !== 0 ? 1 : 0;
    process.exitCode = failed;
} else if (process.argv[2] === 'audit') {
    const frozen = read('frozen-inputs');
    const current = inputs();
    const inputChanges = current.filter(row => frozen.files.find(f => f.file === row.file)?.sha256 !== row.sha256);
    // Preserve the original freeze record. Only this report/audit tool's scope inventory was
    // corrected during the run; production, tests and build inputs must remain byte-identical.
    const verificationToolChanges = inputChanges.filter(row => row.file === 'scripts/x2n-verify.mjs')
        .map(row => ({ ...row, frozenSha256: frozen.files.find(f => f.file === row.file)?.sha256 }));
    const executionInputChanges = inputChanges.filter(row => row.file !== 'scripts/x2n-verify.mjs');
    const missingInputs = frozen.files.filter(row => !current.some(f => f.file === row.file));
    const head = git(['rev-parse', 'HEAD']).toString().trim();
    const protectedFiles = git(['ls-files', 'src/test/fixtures', 'src/test/generation_baseline.test.ts',
        'src/test/u_26a_deep_baseline.test.ts', 'ai_docs/reports/u-r2-trace.json',
        'ai_docs/reports/u-r3-trace.json.gz', 'ai_docs/reports/u-r4-trace.json.gz', 'package.json', 'vite.config.ts'])
        .toString().trim().split('\n').map(file => ({ file, sha256: sha(fs.readFileSync(file)),
            headSha256: sha(git(['show', `HEAD:brogue-web/${file}`])) }));
    const full = read('full'), drift = read('drift');
    const summary = r => ({ files: r.testResults.length, passed: r.numPassedTests, failed: r.numFailedTests,
        pending: r.numPendingTests, todo: r.numTodoTests, success: r.success });
    const results = [...full.testResults, ...drift.testResults];
    write('rs-closure', closure());
    const rs = read('rs-closure').union.map(file => {
        const result = results.find(r => r.name.replaceAll('\\', '/').endsWith(`/${file}`));
        return { file, status: result?.status ?? 'missing',
            assertions: result?.assertionResults.reduce((counts, a) => ({ ...counts, [a.status]: (counts[a.status] ?? 0) + 1 }), {}) };
    });
    const skipped = r => r.testResults.flatMap(f => f.assertionResults.filter(a => ['pending', 'todo', 'skipped'].includes(a.status))
        .map(a => ({ file: path.basename(f.name), name: a.fullName, status: a.status }))).sort((a, b) => a.name.localeCompare(b.name));
    const prior = JSON.parse(fs.readFileSync('ai_docs/reports/x2m-evidence/final-rerun.json', 'utf8'));
    const skippedUnchanged = JSON.stringify(skipped(full)) === JSON.stringify(skipped(prior));
    const modified = git(['diff', '--name-only']).toString().trim().split('\n');
    const textFiles = [...modified.filter(f => f.startsWith('brogue-web/')).map(f => f.slice(11)),
        'src/test/x2n_lumenstone_description.test.ts', 'scripts/x2n-verify.mjs', 'scripts/x2n-browser.mjs',
        ...walk(out).filter(f => /\.(json|txt|md)$/.test(f))];
    const crlf = textFiles.filter(f => fs.existsSync(f) && fs.readFileSync(f).includes(Buffer.from('\r\n')));
    write('baseline-integrity', protectedFiles);
    write('rs-results', rs);
    const result = { at: new Date().toISOString(), head, unchangedHead: head === frozen.head,
        inputChanges, verificationToolChanges, executionInputChanges, missingInputs,
        protectedUnchanged: protectedFiles.every(f => f.sha256 === f.headSha256),
        full: summary(full), drift: summary(drift), buildExitCode: read('build-run').exitCode,
        rsFiles: rs.length, rsPassed: rs.every(f => f.status === 'passed'), skippedUnchanged, skipped: skipped(full), crlf };
    write('verification-summary', result);
    console.log(JSON.stringify(result, null, 2));
    if (executionInputChanges.length || missingInputs.length || !result.unchangedHead || !result.protectedUnchanged
        || !full.success || !drift.success || result.buildExitCode || !result.rsPassed || !skippedUnchanged || crlf.length) process.exitCode = 1;
} else throw new Error('Usage: node scripts/x2n-verify.mjs run|audit');
