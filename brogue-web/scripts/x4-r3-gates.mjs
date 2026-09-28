import fs from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const phase = process.argv[2] ?? 'initial';
const out = 'ai_docs/reports/x4-r3-evidence', raw = 'output/x4-r3';
fs.mkdirSync(out, { recursive: true }); fs.mkdirSync(raw, { recursive: true });
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const inputs = dir => fs.readdirSync(dir, {withFileTypes:true}).flatMap(entry => {
    const path = `${dir}/${entry.name}`;
    return entry.isDirectory() ? inputs(path) : [path];
});
const frozenInputs = phase === 'initial' ? [] : [...inputs('src'), ...inputs('scripts'),
    'package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json',
    ...JSON.parse(fs.readFileSync(`${out}/recapture.json`)).records.map(row => row.file)].sort();
const snapshot = () => Object.fromEntries(frozenInputs.map(file => [file, hash(file)]));
const frozenBefore = snapshot();
if (phase !== 'initial') fs.writeFileSync(`${out}/${phase}-inputs-before.json`, JSON.stringify(frozenBefore,null,2)+'\n');
if (phase === 'initial') {
    if (fs.existsSync(`${out}/initial-state.json`)) throw Error('Initial evidence already exists');
    const production = ['src/data/consumables.json', 'src/data/monsters.json', 'src/engine/Items/ItemLoader.ts',
        'src/entities/Monster.ts', 'src/locales/zh_CN.json'];
    const added = ['src/engine/Combat/CreatureFeatures.ts', 'src/engine/Items/IncendiaryDart.ts', 'src/engine/Items/AggravationScroll.ts'];
    const fixtures = ['src/test/fixtures/generation_baseline.json','src/test/fixtures/deep_generation_baseline.json',
        'ai_docs/reports/u-r2-trace.json','ai_docs/reports/u-r3-trace.json.gz','ai_docs/reports/u-r4-trace.json.gz'];
    fs.writeFileSync(`${out}/initial-state.json`, JSON.stringify({head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
        game:hash('src/engine/Core/Game.ts'), production, added, sources:Object.fromEntries([...production,...added].map(f=>[f,hash(f)])),
        fixtures:Object.fromEntries(fixtures.map(f=>[f,hash(f)]))},null,2)+'\n');
}
const commands = [
    ['typecheck', 'npx vue-tsc -b'],
    ['build', 'npm run build'],
    ['test', `npm test -- --maxWorkers=8 --reporter=default --reporter=json --outputFile=${raw}/${phase}-test.json`],
    ['drift', `npm run test:drift -- --maxWorkers=1 --reporter=default --reporter=json --outputFile=${raw}/${phase}-drift.json`],
];
const results=[];
for (const [label,command] of commands) {
    const log=`${raw}/${phase}-${label}.log`, fd=fs.openSync(log,'w'), start=Date.now();
    console.log('START',phase,label,new Date().toISOString());
    const r=spawnSync('cmd.exe',['/d','/s','/c',command],{stdio:['ignore',fd,fd],windowsHide:true});
    fs.closeSync(fd); fs.writeFileSync(log,fs.readFileSync(log,'utf8').replace(/\r\n/g,'\n'));
    results.push({label,command,exit:r.status,error:r.error?.message,seconds:(Date.now()-start)/1000,log});
    fs.writeFileSync(`${out}/${phase}-gates.json`,JSON.stringify(results,null,2)+'\n');
    console.log('END',label,r.status);
}
const frozenAfter = snapshot();
if (phase !== 'initial') fs.writeFileSync(`${out}/${phase}-inputs-after.json`, JSON.stringify(frozenAfter,null,2)+'\n');
const inputsUnchanged = JSON.stringify(frozenBefore) === JSON.stringify(frozenAfter);
if (!inputsUnchanged) console.error('Inputs changed during the full gate run');
process.exitCode=results.some(r=>r.exit!==0) || !inputsUnchanged ?1:0;
