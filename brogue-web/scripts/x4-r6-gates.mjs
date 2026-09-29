import fs from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const phase = process.argv[2] ?? 'initial';
const out = 'ai_docs/reports/x4-r6-evidence', raw = 'output/x4-r6';
fs.mkdirSync(out, { recursive: true }); fs.mkdirSync(raw, { recursive: true });
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const files = dir => fs.readdirSync(dir, {withFileTypes:true}).flatMap(e => e.isDirectory() ? files(`${dir}/${e.name}`) : [`${dir}/${e.name}`]);
const fixtures = ['src/test/fixtures/generation_baseline.json', 'src/test/fixtures/deep_generation_baseline.json',
    'ai_docs/reports/u-r2-trace.json', 'ai_docs/reports/u-r3-trace.json.gz', 'ai_docs/reports/u-r4-trace.json.gz'];
const snapshot = () => Object.fromEntries([...new Set([...files('src'), ...files('scripts'),
    ...fs.readdirSync('.').filter(f => /\.(json|ts)$/.test(f)), ...fixtures])].sort().map(f => [f,hash(f)]));
const before = snapshot();
fs.writeFileSync(`${out}/${phase}-inputs-before.json`, JSON.stringify(before,null,2)+'\n');
if (phase === 'initial') {
    const changed = execFileSync('git',['diff','--name-only','HEAD','--','src'],{encoding:'utf8'}).trim().split('\n').filter(Boolean).map(f => f.replace(/^brogue-web\//,''));
    const added = execFileSync('git',['ls-files','--others','--exclude-standard','--','src'],{encoding:'utf8'}).trim().split('\n').filter(Boolean);
    fs.writeFileSync(`${out}/initial-state.json`, JSON.stringify({head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
        production:changed.filter(f=>!f.includes('/test/')&&!f.endsWith('.test.ts')), added,
        fixtures:Object.fromEntries(fixtures.map(f => [f,hash(f)]))},null,2)+'\n');
}
const commands = [ ['typecheck','npx vue-tsc -b'], ['build','npm run build'],
    ['test',`npm test -- --maxWorkers=${phase==='final'?8:4} --reporter=default --reporter=json --outputFile=${raw}/${phase}-test.json`],
    ['drift',`npm run test:drift -- --maxWorkers=1 --reporter=default --reporter=json --outputFile=${raw}/${phase}-drift.json`] ];
const results=[];
for (const [label, command] of commands) {
    const log=`${raw}/${phase}-${label}.log`,fd=fs.openSync(log,'w'),start=Date.now();
    console.log('START',phase,label,new Date().toISOString());
    const r=spawnSync('/bin/zsh',['-c',command],{stdio:['ignore',fd,fd]});fs.closeSync(fd);
    results.push({label,command,exit:r.status,error:r.error?.message,seconds:(Date.now()-start)/1000,log});
    fs.writeFileSync(`${out}/${phase}-gates.json`,JSON.stringify(results,null,2)+'\n');
    console.log('END',label,r.status);
}
const after=snapshot();fs.writeFileSync(`${out}/${phase}-inputs-after.json`,JSON.stringify(after,null,2)+'\n');
const unchanged=JSON.stringify(before)===JSON.stringify(after);
if (!unchanged) console.error('Inputs changed during gate run');
process.exitCode=results.some(r=>r.exit!==0)||!unchanged?1:0;
