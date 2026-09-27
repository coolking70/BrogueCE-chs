// Read-only reverse dependency and delivery checks; never captures golden traces.
import ts from 'typescript';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const repo = resolve(root, '..'), out = resolve(root, 'ai_docs/reports/x3b-evidence');
const norm = p => relative(root, p).replaceAll('\\', '/');
const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? walk(resolve(dir, e.name)) : [resolve(dir, e.name)]);
const sources = walk(resolve(root, 'src')).filter(p => /\.(?:ts|vue)$/.test(p));
const reverse = new Map(), readers = [];
for (const path of sources) {
    const source = readFileSync(path, 'utf8');
    if (path.endsWith('.test.ts') && /\breadFile(?:Sync)?\b/.test(source)) readers.push(norm(path));
    for (const imported of ts.preProcessFile(source, true, true).importedFiles) {
        if (!imported.fileName.startsWith('.')) continue;
        const base = resolve(dirname(path), imported.fileName);
        const dependency = [base, `${base}.ts`, `${base}.vue`, resolve(base, 'index.ts')].find(p => existsSync(p) && /\.(?:ts|vue)$/.test(p));
        if (!dependency) continue;
        if (!reverse.has(dependency)) reverse.set(dependency, []);
        reverse.get(dependency).push(path);
    }
}
const changed = ['src/engine/Core/Game.ts', 'src/engine/UI/DetailGenerator.ts'];
const reached = new Set(changed.map(p => resolve(root, p))), queue = [...reached];
for (let n = 0; n < queue.length; n++) for (const p of reverse.get(queue[n]) ?? []) {
    if (!reached.has(p)) { reached.add(p); queue.push(p); }
}
const named = JSON.parse(readFileSync(resolve(out, 'rs-closure.json'), 'utf8')).R;
const R = [...new Set([...named, ...[...reached].filter(p => p.endsWith('.test.ts')).map(norm)])].sort();
const S = readers.sort(), union = [...new Set([...R, ...S])].sort();
const closure = { method: 'R: transitive reverse TypeScript import graph from both changed modules plus named semantic guards; S: all test readFile/readFileSync consumers, conservatively including fixture readers.', changed, productionConsumers: [...reached].filter(p => !p.endsWith('.test.ts')).map(norm).sort(), R, S, union };
writeFileSync(resolve(out, 'rs-closure.json'), JSON.stringify(closure, null, 2) + '\n');

const git = args => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
const tracked = git(['diff', '--name-only', '-z']).split('\0').filter(Boolean);
const added = git(['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(p => p.startsWith('brogue-web/') && p);
const textFiles = [...tracked, ...added].filter(p => /\.(?:ts|mjs|md|json|txt)$/.test(p));
const crlf = textFiles.filter(p => readFileSync(resolve(repo, p)).includes(Buffer.from('\r\n')));
const hash = p => createHash('sha256').update(readFileSync(resolve(root, p))).digest('hex');
const before = JSON.parse(readFileSync(resolve(out, 'baseline-before.json'), 'utf8'));
const baselineChanges = Object.keys(before).filter(p => hash(p) !== before[p]);
const delivery = {
    head: git(['rev-parse', 'HEAD']).trim(), trackedChanges: tracked,
    staged: git(['diff', '--cached', '--name-only']).trim(), crlf,
    diffCheck: git(['diff', '--check']).trim(), protectedFiles: Object.keys(before).length, baselineChanges,
    sourceHashes: Object.fromEntries([...changed, 'src/test/x3b_display_recording.test.ts', 'src/test/x3b_item_details.test.ts'].map(p => [p, hash(p)])),
};
if (existsSync(resolve(out, 'full.json')) && existsSync(resolve(out, 'drift.json'))) {
    const results = ['full.json', 'drift.json'].flatMap(f => JSON.parse(readFileSync(resolve(out, f), 'utf8')).testResults);
    const byName = new Map(results.map(f => [norm(f.name), f]));
    const rows = union.map(file => {
        const result = byName.get(file);
        return { file, status: result?.status ?? 'missing', assertions: result?.assertionResults.map(a => ({ name: a.fullName, status: a.status })) ?? [] };
    });
    writeFileSync(resolve(out, 'rs-results.json'), JSON.stringify(rows, null, 2) + '\n');
    delivery.closure = { R: R.length, S: S.length, union: union.length,
        missing: rows.filter(r => r.status === 'missing').map(r => r.file),
        failed: rows.filter(r => r.status !== 'passed').map(r => r.file),
        assertions: rows.flatMap(r => r.assertions).reduce((counts, a) => { counts[a.status] = (counts[a.status] ?? 0) + 1; return counts; }, {}) };
}
writeFileSync(resolve(out, 'delivery-check.json'), JSON.stringify(delivery, null, 2) + '\n');
console.log(JSON.stringify({ ...delivery, sourceHashes: undefined, productionConsumers: closure.productionConsumers.length }, null, 2));
if (crlf.length || baselineChanges.length || delivery.staged || delivery.diffCheck || delivery.closure?.failed.length) process.exitCode = 1;
