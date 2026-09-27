import fs from 'node:fs';
import assert from 'node:assert/strict';
import {gzipSync,gunzipSync} from 'node:zlib';
import {spawnSync} from 'node:child_process';
const out='ai_docs/reports/x2g-evidence';
const sources=JSON.parse(gunzipSync(fs.readFileSync(`${out}/sources-review.json.gz`)));
const f='src/engine/Core/Game.ts';
for(const [a,b] of [
 ['monster.takeDamage(monster.hp, true);','monster.takeDamage(monster.hp, true, this.grid);'],
 ['monst.takeDamage(monst.hp, true); // CE inflictLethalDamage','monst.takeDamage(monst.hp, true, this.grid); // CE inflictLethalDamage'],
 ['target.takeDamage(9999, true);','target.takeDamage(9999, true, this.grid);'],
]) {assert(sources[f].includes(a),a);sources[f]=sources[f].replaceAll(a,b);}
fs.writeFileSync(`${out}/sources-rot-lethal.json.gz`,gzipSync(JSON.stringify(sources)));
let test=fs.readFileSync(`${out}/native-review.test.ts.txt`,'utf8');
const entry="    it('zombies emit 15 volume per objective tick;";
assert(test.includes(entry));
test=test.replace(entry,`    it('CE inflictLethalDamage from quietus/slaying still emits zombie blood and bypasses shields',()=>{
        const g=scene();const weapon=ItemLoader.spawnWeapon('dagger',-1,-1)!;
        g.player.equippedWeapon=weapon;g.player.inventory.addItem(weapon);
        for(const effect of ['quietus','slaying']) {
            const z=add(g,'zombie',15,10);z.hp=80;z.applyShield(1000);
            g.grid.getCell(15,10)!.volume=0;
            (g as any).applyWeaponRunicEffect(z,0,effect);
            expect(z.hp).toBe(0);expect(z.getStatusDuration('shielded')).toBe(1000);
            expect(g.grid.getCell(15,10)!.volume).toBe(1600); // CE 12*(15+80*3/2)/100, then ×100.
            expect(g.grid.getCell(15,10)!.layers[L.GAS]).toBe(T.ROT_GAS);
        }
    });
${entry}`);
fs.writeFileSync(`${out}/repaired-x2g_native_effects.test.ts.txt`,test);
for(const script of ['x2g-capture.mjs','x2g-traces.mjs']){
 const r=spawnSync(process.execPath,[`scripts/${script}`,'rot-lethal'],{stdio:'inherit'});assert.equal(r.status,0);
}
const results=[];
for(const type of ['generation','ur2','ur3','ur4']){
 const suffix=type==='ur2'?'.json':'.json.gz';
 const read=stage=>{const b=fs.readFileSync(`${out}/${type}-${stage}${suffix}`);return JSON.parse(suffix.endsWith('.gz')?gunzipSync(b):b);};
 assert.deepEqual(read('rot-lethal'),read('review'),type);
 results.push({from:'review',to:'rot-lethal',family:'ROT_GAS lethal damage endpoints',type,unchanged:true});
}
fs.writeFileSync(`${out}/lethal-attribution.json`,JSON.stringify(results,null,2)+'\n');
