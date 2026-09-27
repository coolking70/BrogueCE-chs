import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const repo = path.dirname(root);
const evidence = path.join(root, 'ai_docs/reports/x-2-evidence');
const reportPath = path.join(root, 'ai_docs/reports/x-2-survey.report.md');
const report = fs.readFileSync(reportPath, 'utf8');
const git = (...args) => execFileSync('git', args, {cwd:repo, encoding:'utf8'});
const untracked = git('ls-files', '--others', '--exclude-standard', '-z').split('\0').filter(Boolean);
const allowed = f => f === 'brogue-web/ai_docs/reports/x-2-survey.report.md'
    || f.startsWith('brogue-web/ai_docs/reports/x-2-evidence/')
    || f.startsWith('brogue-web/scripts/x2-survey-');
const badPaths = untracked.filter(f => !allowed(f));
const crlf = untracked.filter(f => fs.readFileSync(path.join(repo,f)).includes(Buffer.from('\r\n')));
const missingIds = [];
for (const [prefix, count] of [['K',42],['N',10],['XB',3],['XN',3]]) {
    for (let i=1; i<=count; i++) {
        const id=prefix+String(i).padStart(2,'0');
        if (!report.includes(id)) missingIds.push(id);
    }
}
const missingReports = 'abcdefghijklmno'.split('').filter(c=>!report.includes(`x2${c}.report.md`));
// The checker itself writes delivery-check below; allow that link before creation.
const missingLinks = [...report.matchAll(/\]\(([^)]+)\)/g)].map(m=>m[1]).filter(link=>
    !link.startsWith('http') && !link.startsWith('#') && link !== 'x-2-evidence/delivery-check.json'
    && !fs.existsSync(path.resolve(path.dirname(reportPath), link.split('#')[0])));
const aliases = {G:'src/engine/Core/Game.ts',M:'src/entities/Monster.ts',GC:'src/engine/Core/GenerationCoordinator.ts'};
const prefixes = {'E/':'src/engine/','T/':'src/test/','C/':'../BrogueCE-master/src/brogue/','V/':'../BrogueCE-master/src/variants/'};
const references = [];
for (const token of report.matchAll(/`([^`\n]+)`/g)) {
    for (const match of token[1].matchAll(/\b(GC|G|M):(\d[\d,–-]*)|(?<![A-Za-z0-9_./:-])((?:E\/|T\/|C\/|V\/|src\/)[A-Za-z0-9_./-]+)(?::(\d[\d,–-]*))?/g)) {
        let file = match[1] ? aliases[match[1]] : match[3];
        if (file.endsWith('/')) continue;
        const lines = (match[2] ?? match[4] ?? '').match(/\d+/g)?.map(Number) ?? [];
        const prefix = Object.keys(prefixes).find(p=>file.startsWith(p));
        const isTest = prefix === 'T/';
        if (prefix) file = prefixes[prefix] + file.slice(prefix.length);
        if (!/\.(?:ts|vue|c|h|json)$/.test(file)) {
            file = file.replace(/\.[A-Za-z][A-Za-z0-9]*$/, '');
            file += isTest ? '.test.ts' : '.ts';
        }
        const full = path.resolve(root,file);
        const exists=fs.existsSync(full);
        const lineCount=exists ? fs.readFileSync(full,'utf8').split('\n').length : 0;
        references.push({file,lines,exists,lineCount,valid:exists && lines.every(n=>n>0&&n<=lineCount)});
    }
}
const result=JSON.parse(fs.readFileSync(path.join(evidence,'targeted-results.json'),'utf8'));
const tests={files:result.testResults.length,total:result.numTotalTests,passed:result.numPassedTests,
    failed:result.numFailedTests,pending:result.numPendingTests,success:result.success};
const tracked=JSON.parse(fs.readFileSync(path.join(evidence,'tracked-comparison.json'),'utf8'));
const integrity=tracked.changed.length===0 && tracked.headUnchanged && !tracked.diff && !tracked.cachedDiff;
const invalidReferences=references.filter(r=>!r.valid);
const checks={timestamp:new Date().toISOString(),untrackedCount:untracked.length,badPaths,crlf,missingIds,
    missingReports,missingLinks,referenceCount:references.length,invalidReferences,tests,trackedIntegrity:integrity};
checks.passed=!badPaths.length&&!crlf.length&&!missingIds.length&&!missingReports.length&&!missingLinks.length
    &&!invalidReferences.length&&tests.success&&integrity;
fs.writeFileSync(path.join(evidence,'delivery-check.json'),JSON.stringify(checks,null,2)+'\n');
console.log(JSON.stringify(checks,null,2));
if(!checks.passed) process.exitCode=1;
