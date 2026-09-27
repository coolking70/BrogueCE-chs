import fs from 'node:fs';
import assert from 'node:assert/strict';
import {gzipSync,gunzipSync} from 'node:zlib';
import {spawnSync} from 'node:child_process';
const out='ai_docs/reports/x2g-evidence';
const sources=JSON.parse(gunzipSync(fs.readFileSync(`${out}/sources-rot-lethal.json.gz`)));
function replace(f,a,b){assert(sources[f].includes(a),a);sources[f]=sources[f].replace(a,b);}
replace('src/engine/Combat/BoltTrajectory.ts','const creature = hidden ? undefined : occupant;',
 'const creature = hidden || isSubmerged(occupant) ? undefined : occupant; // CE Items.c:4221');
replace('src/engine/Combat/MonsterBlink.ts',"import { hiddenBySubmersion }", "import { hiddenBySubmersion, isSubmerged }");
replace('src/engine/Combat/MonsterBlink.ts','if ((occupant && !hidden) || (flags(g, p)',
 'if ((occupant && !hidden && !isSubmerged(occupant)) || (flags(g, p)');
const game='src/engine/Core/Game.ts';
replace(game,`        if (!caster || !landing || !this.canDisplaceCreature(caster, landing)) return false;
        if (caster instanceof Monster) caster.submerged = false;`, `        if (!caster || !landing || caster.hp <= 0
            || (caster.x === landing.x && caster.y === landing.y)) return false;
        const occupant = this.getMonsterAt(landing.x, landing.y);
        if (occupant && occupant !== caster && occupant.submerged) {
            // CE Items.c:5516-5535: blink displaces a submerged occupant first.
            if (!canPlaceCreature({ grid: this.grid, player: this.player, monsters: this.monsters.filter(m => m !== occupant), dormantMonsters: this.dormantMonsters }, caster, landing)) return false;
            const origin = { ...caster.loc };
            caster.loc = { x: -1, y: -1 }; // CE temporarily removes the caster from occupancy.
            let home: Pos | null = null;
            try {
                // CE Monsters.c:3927-3954: shuffle columns, then rows, once;
                // first acceptable cell in expanding Manhattan distance.
                const columns = Array.from({ length: this.grid.width }, (_, i) => i);
                const rows = Array.from({ length: this.grid.height }, (_, i) => i);
                rng.shuffleList(columns); rng.shuffleList(rows);
                search: for (let distance = 1; distance < Math.max(this.grid.width, this.grid.height); distance++) {
                    for (const x of columns) for (const y of rows) {
                        const d = Math.abs(x - occupant.x) + Math.abs(y - occupant.y);
                        if (d > 0 && d <= distance && !this.getMonsterAt(x, y)
                            && !(this.player.x === x && this.player.y === y)
                            && !monsterBlinkAvoids(this, occupant, { x, y })) {
                            home = { x, y }; break search;
                        }
                    }
                }
            } finally { caster.loc = origin; }
            if (home) occupant.loc = home; // CE relocation has no terrain-entry callback.
            else {
                // CE administrative death: no blood, death DF, loot or passenger.
                occupant.hp = 0; occupant.deathProcessed = true; occupant.deathEffectTriggered = true;
                occupant.carriedItem = null; occupant.carriedMonster = null;
                this.demoteMonsterFromLeadership(occupant);
            }
        }
        if (!this.canDisplaceCreature(caster, landing)) return false;
        if (caster instanceof Monster) caster.submerged = false;`);
replace(game,`        if (!target.hasStatus('levitating')) {
            if (cell.layers.includes(TerrainType.TRAP))`, `        // CE Time.c:241-245: even a surfaced aquatic creature does not press
        // a plate in terrain where its form can submerge.
        if (!target.hasStatus('levitating') && !isSubmerged(target)
            && !(target instanceof Monster && target.hasBehavior('MONST_SUBMERGES')
                && (cellTerrainMechFlags(this.grid, x, y) & TM_ALLOWS_SUBMERGING))) {
            if (cell.layers.includes(TerrainType.TRAP))`);
fs.writeFileSync(`${out}/sources-submerged-complete.json.gz`,gzipSync(JSON.stringify(sources)));
let test=fs.readFileSync(`${out}/repaired-x2g_native_effects.test.ts.txt`,'utf8');
test=test.replace("import { traceBolt }", "import { monsterBlinkImpact } from '../engine/Combat/MonsterBlink';\nimport { boltLine, traceBolt }");
test+=`
describe('X2g submerged interaction edge cases',()=>{
    it('submerged creatures never alter bolt tuning or blink impact, even for underwater observers',()=>{
        const g=scene();g.grid.setTerrain(10,10,T.WATER_DEEP);
        const m=add(g,'eel',13,11);g.grid.setTerrain(13,11,T.WATER_DEEP);m.submerged=true;
        const bolt=getBoltForItem('staff_of_lightning')!;
        for(let x=16;x<26;x++)for(let y=8;y<19;y++) {
            const aim={x,y},empty={caster:g.player,creatureAt:()=>undefined};
            expect(boltLine(g.grid,g.player.loc,aim,bolt,{caster:g.player,creatureAt:p=>g.getMonsterAt(p.x,p.y)}))
                .toEqual(boltLine(g.grid,g.player.loc,aim,bolt,empty));
        }
        const caster=add(g,'imp',10,10);g.player.loc={x:30,y:20};m.loc={x:11,y:10};g.grid.setTerrain(11,10,T.WATER_DEEP);
        const submergedImpact=monsterBlinkImpact(g,caster,{x:25,y:10});m.hp=0;
        expect(submergedImpact).toEqual(monsterBlinkImpact(g,caster,{x:25,y:10}));
        m.hp=80;m.submerged=false;expect(monsterBlinkImpact(g,caster,{x:25,y:10})).toEqual(caster.loc);
    });
    it('blink lands on submerged occupants after CE shuffled Manhattan relocation; no home is silent administrative death',()=>{
        const g=scene();const m=add(g,'eel',15,10);g.grid.setTerrain(15,10,T.WATER_DEEP);g.grid.setTerrain(16,10,T.WATER_DEEP);m.submerged=true;
        const shuffle=vi.spyOn(rng,'shuffleList');
        expect((g as any).finishBlink({caster:g.player,landingPos:{x:15,y:10}})).toBe(true);
        expect(g.player.loc).toEqual({x:15,y:10});expect(m.loc).toEqual({x:16,y:10});expect(m.submerged).toBe(true);
        expect(shuffle.mock.calls.map(c=>c[0].length)).toEqual([g.grid.width,g.grid.height]);
        const h=scene();const trapped=add(h,'eel',15,10);h.grid.setTerrain(15,10,T.WATER_DEEP);trapped.submerged=true;
        trapped.mutate(mutations.find(m=>m.id==='infested')!);trapped.carriedItem=ItemLoader.spawnWeapon('dagger',-1,-1)!;
        expect((h as any).finishBlink({caster:h.player,landingPos:{x:15,y:10}})).toBe(true);
        expect(trapped.hp).toBe(0);expect(trapped.deathProcessed).toBe(true);expect(trapped.carriedItem).toBeNull();
        (h as any).triggerDeathFeatures(trapped);expect(h.grid.getCell(15,10)!.layers[L.SURFACE]).toBe(T.NOTHING);expect(h.items).toHaveLength(0);
    });
    it('submerged and surfaced aquatic creatures on submergible terrain do not press either legacy or CE plates',()=>{
        const g=scene();const m=add(g,'eel',15,10);g.grid.setTerrain(15,10,T.WATER_DEEP);
        const legacy=vi.spyOn(g as any,'triggerTrap');const pressure=vi.spyOn(g as any,'triggerPressurePlate');
        for(const submerged of [false,true])for(const tile of [T.TRAP,T.PRESSURE_PLATE,T.GAS_TRAP_POISON]) {
            m.submerged=submerged;g.grid.setTerrainLayer(15,10,L.DUNGEON,tile);
            (g as any).applyDisplacementTileEntry(m);
            expect(g.grid.getCell(15,10)!.layers[L.GAS]).toBe(T.NOTHING);
        }
        expect(legacy).not.toHaveBeenCalled();expect(pressure).not.toHaveBeenCalled();
        g.grid.setTerrainLayer(15,10,L.LIQUID,T.NOTHING);m.submerged=false;
        g.grid.setTerrainLayer(15,10,L.DUNGEON,T.GAS_TRAP_POISON);(g as any).applyDisplacementTileEntry(m);
        expect(g.grid.getCell(15,10)!.layers[L.GAS]).toBe(T.POISON_GAS);
    });
});
`;
fs.writeFileSync(`${out}/repaired-x2g-final.test.ts.txt`,test);
if(process.argv.includes('--prepare-only'))process.exit(0);
for(const script of ['x2g-capture.mjs','x2g-traces.mjs']){
 const r=spawnSync(process.execPath,[`scripts/${script}`,'submerged-complete'],{stdio:'inherit'});assert.equal(r.status,0);
}
const results=[];
for(const type of ['generation','ur2','ur3','ur4']){
 const suffix=type==='ur2'?'.json':'.json.gz';
 const read=stage=>{const b=fs.readFileSync(`${out}/${type}-${stage}${suffix}`);return JSON.parse(suffix.endsWith('.gz')?gunzipSync(b):b);};
 assert.deepEqual(read('submerged-complete'),read('rot-lethal'),type);
 results.push({from:'rot-lethal',to:'submerged-complete',family:'submerged aiming/blink/plate edge cases',type,unchanged:true});
}
fs.writeFileSync(`${out}/subm-final-attribution.json`,JSON.stringify(results,null,2)+'\n');
