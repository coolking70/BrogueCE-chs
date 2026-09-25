import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync,execFileSync} from 'node:child_process';
const dir=path.resolve('ai_docs/reports/u-05-evidence'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'u05-w25-review-'));
const sources=['src/engine/Core/Game.ts','src/engine/Items/ItemLoader.ts','src/engine/Generator/BlueprintEngine.ts'];
const test='src/test/w_25_staff_catalog.test.ts';
const original=fs.readFileSync(test,'utf8');
const start=original.indexOf("    it('machine direct/category staff requests remain");
const end=original.indexOf('\n    });',start)+8;
assert.ok(start>0&&end>start);
const replacement=`    it('machine direct/category staff requests materialize CE identity/resources through U05',()=>{
        const g:any=Object.create(Game.prototype);
        for(const id of ids){
            const before=rng.randomNumbersGenerated;
            const item=g.spawnBlueprintItem('STAFF',id,3,4,1);
            expect(item).not.toBeNull();expect(item.identityId).toBe(id);expect(item.category).toBe(ItemCategory.STAFF);
            expect([item.charges,item.maxCharges]).toEqual([item.enchantment,item.enchantment]);
            expect(item.staffRechargeRemaining).toBe(['staff_of_blinking','staff_of_obstruction'].includes(id)?1000:500);
            expect(rng.randomNumbersGenerated-before).toBe(item.enchantment); // category + CE resource tail
        }
        const before=rng.randomNumbersGenerated;
        const item=g.spawnBlueprintItem('STAFF',undefined,3,4,1);
        expect(item).not.toBeNull();expect(ids).toContain(item.identityId);
        expect(rng.randomNumbersGenerated-before).toBe(item.enchantment+1); // additionally chooseKind
    });`;
const proposed=original.slice(0,start)+replacement+original.slice(end);
try{
 fs.cpSync('src',path.join(temp,'src'),{recursive:true});
 for(const f of ['package.json','vite.config.ts'])fs.copyFileSync(f,path.join(temp,f));
 fs.mkdirSync(path.join(temp,'node_modules'));
 for(const n of fs.readdirSync('node_modules').filter(n=>!n.startsWith('.')||n==='.bin'))fs.symlinkSync(fs.realpathSync(path.join('node_modules',n)),path.join(temp,'node_modules',n));
 function run(name){const fd=fs.openSync(`${dir}/${name}.txt`,'w');const r=spawnSync('npx',['vitest','run',test,'-t','machine direct/category staff requests','--maxWorkers=1','--reporter=default','--reporter=json',`--outputFile.json=${dir}/${name}.json`],{cwd:temp,stdio:['ignore',fd,fd]});fs.closeSync(fd);const j=JSON.parse(fs.readFileSync(`${dir}/${name}.json`));return {name,status:r.status,passed:j.numPassedTests,failed:j.numFailedTests};}
 for(const f of sources)fs.writeFileSync(path.join(temp,f),execFileSync('git',['show',`HEAD:brogue-web/${f}`]));
 const control=run('w25-head-control');assert.equal(control.passed,1);assert.equal(control.status,0);
 for(const f of sources)fs.copyFileSync(f,path.join(temp,f));
 const current=run('w25-current-original');assert.equal(current.failed,1);
 fs.writeFileSync(path.join(temp,test),proposed);
 const candidate=run('w25-proposal');assert.equal(candidate.passed,1);assert.equal(candidate.status,0);
 const patch=spawnSync('diff',['-u','--label',test,'--label',test,path.resolve(test),path.join(temp,test)],{encoding:'utf8'});
 fs.writeFileSync(`${dir}/proposed-w25.patch`,patch.stdout);
 fs.writeFileSync(`${dir}/w25-counterfactual.json`,JSON.stringify({control,current,candidate,oldGuardUnchanged:fs.readFileSync(test,'utf8')===original},null,2)+'\n');
 console.log(JSON.stringify({control,current,candidate}));
}finally{fs.rmSync(temp,{recursive:true,force:true});}
