import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync,execFileSync} from 'node:child_process';
const dir=path.resolve('ai_docs/reports/u-05-evidence'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'u05-w24-review-'));
const sources=['src/engine/Core/Game.ts','src/engine/Items/ItemLoader.ts','src/engine/Generator/BlueprintEngine.ts'];
const test='src/test/w_24_wand_catalog.test.ts';
const original=fs.readFileSync(test,'utf8');
const start=original.indexOf("    it('machine WAND/STAFF debt stays explicit");
const end=original.indexOf('\n    });',start)+8;
assert.ok(start>0&&end>start);
const replacement=`    it('machine WAND/STAFF requests materialize CE identity/resources through U05', () => {
        const g:any=Object.create(Game.prototype);
        for(const id of ids){
            const before=rng.randomNumbersGenerated;
            const item=g.spawnBlueprintItem('WAND',id,3,4,1);
            const [lo,hi]=WAND_INITIAL_RANGES[id]!;
            expect(item).not.toBeNull();expect(item.identityId).toBe(id);expect(item.category).toBe(ItemCategory.WAND);
            expect(item.charges).toBeGreaterThanOrEqual(lo);expect(item.charges).toBeLessThanOrEqual(hi);
            expect(item.maxCharges).toBe(item.charges);
            expect(rng.randomNumbersGenerated-before).toBe(1+(lo===hi?0:1));
        }
        for(const category of ['WAND','STAFF']){
            const before=rng.randomNumbersGenerated;
            const item=g.spawnBlueprintItem(category,undefined,3,4,1);
            expect(item).not.toBeNull();expect(ItemCategory[item.category]).toBe(category);
            const pool=category==='WAND'?ItemLoader.genWands:ItemLoader.genStaffs;
            expect(pool.map(c=>c.id)).toContain(item.identityId);
            const range=WAND_INITIAL_RANGES[item.identityId];
            expect(rng.randomNumbersGenerated-before).toBe(category==='STAFF'?item.enchantment+1:2+(range![0]===range![1]?0:1));
        }
    });`;
const proposed=original.slice(0,start)+replacement+original.slice(end);
try{
 fs.cpSync('src',path.join(temp,'src'),{recursive:true});
 for(const f of ['package.json','vite.config.ts'])fs.copyFileSync(f,path.join(temp,f));
 fs.mkdirSync(path.join(temp,'node_modules'));
 for(const n of fs.readdirSync('node_modules').filter(n=>!n.startsWith('.')||n==='.bin'))fs.symlinkSync(fs.realpathSync(path.join('node_modules',n)),path.join(temp,'node_modules',n));
 function run(name){const fd=fs.openSync(`${dir}/${name}.txt`,'w');const r=spawnSync('npx',['vitest','run',test,'-t','machine WAND/STAFF','--maxWorkers=1','--reporter=default','--reporter=json',`--outputFile.json=${dir}/${name}.json`],{cwd:temp,stdio:['ignore',fd,fd]});fs.closeSync(fd);const j=JSON.parse(fs.readFileSync(`${dir}/${name}.json`));return {name,status:r.status,passed:j.numPassedTests,failed:j.numFailedTests};}
 for(const f of sources)fs.writeFileSync(path.join(temp,f),execFileSync('git',['show',`HEAD:brogue-web/${f}`]));
 const control=run('w24-head-control');assert.equal(control.passed,1);assert.equal(control.status,0);
 for(const f of sources)fs.copyFileSync(f,path.join(temp,f));
 const current=run('w24-current-original');assert.equal(current.failed,1);
 fs.writeFileSync(path.join(temp,test),proposed);
 const candidate=run('w24-proposal');assert.equal(candidate.passed,1);assert.equal(candidate.status,0);
 const patch=spawnSync('diff',['-u','--label',test,'--label',test,path.resolve(test),path.join(temp,test)],{encoding:'utf8'});
 fs.writeFileSync(`${dir}/proposed-w24.patch`,patch.stdout);
 fs.writeFileSync(`${dir}/w24-counterfactual.json`,JSON.stringify({control,current,candidate,oldGuardUnchanged:fs.readFileSync(test,'utf8')===original},null,2)+'\n');
 console.log(JSON.stringify({control,current,candidate}));
}finally{fs.rmSync(temp,{recursive:true,force:true});}
