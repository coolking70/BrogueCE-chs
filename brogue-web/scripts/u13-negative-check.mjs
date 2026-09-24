// Counterfactual proof in a disposable copy: restore ONLY the extra auto-hit
// randPercent(100). Production and guards in the worktree remain untouched.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const dir='ai_docs/reports/u-13-evidence', tmp=fs.mkdtempSync(path.join(os.tmpdir(),'u13-counterfactual-'));
try {
    fs.cpSync('src',`${tmp}/src`,{recursive:true});
    for(const f of ['package.json','vite.config.ts','tsconfig.json','tsconfig.app.json','tsconfig.node.json'])fs.copyFileSync(f,`${tmp}/${f}`);
    fs.symlinkSync(fs.realpathSync('node_modules'),`${tmp}/node_modules`);
    fs.mkdirSync(`${tmp}/${dir}`,{recursive:true});
    fs.copyFileSync(`${dir}/ce-combat.json`,`${tmp}/${dir}/ce-combat.json`);
    const file=`${tmp}/src/engine/Combat/Combat.ts`,original=fs.readFileSync(file,'utf8');
    const broken=original.replace('if (!autoHit && !rng.randPercent(defender.seized && attacker.seizing',
        'if (!rng.randPercent(autoHit ? 100 : defender.seized && attacker.seizing');
    assert.notEqual(broken,original);fs.writeFileSync(file,broken);
    const runs=[
        ['old-guards',['src/test/b_1a_identification.test.ts','src/test/u_06_monster_damage.test.ts','-t','接线：真实近战击杀|retains accuracy miss']],
        ['new-contract',['src/test/u_13_combat_math.test.ts','-t','has no hit die|miss/immune skip damage dice']],
    ];
    const outcomes=[];
    for(const [name,files] of runs){
        const r=spawnSync('npx',['vitest','run',...files,'--maxWorkers=2','--reporter=default'],{cwd:tmp,encoding:'utf8'});
        fs.writeFileSync(`${dir}/counterfactual-${name}.txt`,r.stdout+r.stderr);outcomes.push({name,status:r.status});
    }
    assert.equal(outcomes[0].status,0);assert.equal(outcomes[1].status,1);
    fs.writeFileSync(file,original);
    const formulasFile=`${tmp}/src/engine/Combat/CombatFormulas.ts`,formulas=fs.readFileSync(formulasFile,'utf8');
    const wrongDefense=formulas.replace('defenseFraction(Math.max(0, Math.trunc(defenderDefense)))','defenseFraction(Math.trunc(defenderDefense))');
    assert.notEqual(wrongDefense,formulas);fs.writeFileSync(formulasFile,wrongDefense);
    for(const [name,files] of [
        ['negative-defense-old-guards',['src/test/ui_2_protection.test.ts']],
        ['negative-defense-new-contract',['src/test/u_13_combat_math.test.ts','-t','1215 hit probabilities']],
    ]) {
        const r=spawnSync('npx',['vitest','run',...files,'--maxWorkers=2','--reporter=default'],{cwd:tmp,encoding:'utf8'});
        fs.writeFileSync(`${dir}/counterfactual-${name}.txt`,r.stdout+r.stderr);outcomes.push({name,status:r.status});
    }
    assert.equal(outcomes[2].status,0);assert.equal(outcomes[3].status,1);
    fs.writeFileSync(`${dir}/counterfactual.json`,JSON.stringify({changes:['restore extra auto-hit randPercent(100) only','remove CE negative-defense clamp only'],outcomes},null,2)+'\n');
    console.log(JSON.stringify(outcomes));
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
