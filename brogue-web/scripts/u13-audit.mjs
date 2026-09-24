import fs from 'node:fs';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const dir='ai_docs/reports/u-13-evidence';
const read=f=>fs.readFileSync(f,'utf8');
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const head=f=>execFileSync('git',['show',`HEAD:brogue-web/${f}`],{encoding:'utf8'});
const ce=read('../BrogueCE-master/src/brogue/Globals.c');
const range=ds=>{
    const d=ds.match(/^(\d+)d(\d+)(?:\+(\d+))?$/);
    if(d)return [+d[1]+ +(d[3]??0),+d[1]* +d[2]+ +(d[3]??0)];
    throw Error(ds);
};
const rows=[...ce.slice(ce.indexOf('creatureType monsterCatalog')).matchAll(/\{0,\s*"([^"]+)"[^\n]*?\{(\d+),\s*(\d+),\s*(\d+)\}/g)].slice(0,68);
const monsters=JSON.parse(read('src/data/monsters.json'));
assert.equal(monsters.length,67);
const sources=monsters.map((m,i)=>{
    const [,name,...numbers]=rows[i+1], r=numbers.map(Number);
    assert.equal(m.name.toLowerCase(),name.toLowerCase());
    assert.deepEqual([...range(m.damage),m.clumping],r);
    return {id:m.id,ceName:name,range:r};
});
const weaponText=ce.split('itemTable weaponTable')[1].split('itemTable armorTable')[0];
const weapons=Object.fromEntries([...weaponText.matchAll(/\{"([^"]+)"[^\n]*?\{(\d+),\s*(\d+),\s*(\d+)\}/g)].map(([,name,...r])=>[name.replaceAll(' ','_'),r.map(Number)]));
const weaponRows=JSON.parse(read('src/data/weapons.json'));
for(const [id,r] of Object.entries(weapons)){
    const w=weaponRows.find(w=>w.id===id);assert(w,id);assert.deepEqual([...range(w.damage),w.clumping],r);
}
for(const f of ['src/data/monsters.json','src/data/weapons.json']) {
    // Same catalog entries/order/weights/old statistics; only the new clump
    // metadata and javelin's explanatory source string may differ.
    const strip=a=>a.map(({clumping,source,...rest})=>rest);
    assert.deepEqual(strip(JSON.parse(head(f))),strip(JSON.parse(read(f))),f);
}
const tracked=execFileSync('git',['ls-files','src','scripts'],{encoding:'utf8'}).trim().split('\n');
const protectedFiles=tracked.filter(f=>f.includes('/fixtures/')||f.startsWith('src/engine/Generator/')||f.startsWith('src/engine/Map/'));
protectedFiles.push('src/engine/Random.ts','src/engine/Core/Game.ts','src/entities/Creature.ts','src/entities/Player.ts','package.json','package-lock.json');
const hashes=Object.fromEntries(protectedFiles.map(f=>{
    const old=sha(head(f)),now=sha(read(f));assert.equal(now,old,f);return [f,now];
}));
fs.writeFileSync(`${dir}/catalog-ranges.json`,JSON.stringify({monsters:sources,weapons},null,2)+'\n');
fs.writeFileSync(`${dir}/boundary.json`,JSON.stringify({monsters:monsters.length,weapons:Object.keys(weapons).length,
    nonUniformMonsters:monsters.filter(m=>m.clumping>1).length,zeroRangeMonsters:monsters.filter(m=>m.clumping===0).length,
    protectedHashes:hashes},null,2)+'\n');
console.log(JSON.stringify({monsters:monsters.length,weapons:Object.keys(weapons).length,unchangedProtectedFiles:protectedFiles.length}));
