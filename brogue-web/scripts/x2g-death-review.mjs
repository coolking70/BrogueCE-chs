import fs from 'node:fs';
import assert from 'node:assert/strict';
import {gzipSync,gunzipSync} from 'node:zlib';
import {spawnSync} from 'node:child_process';
const out='ai_docs/reports/x2g-evidence';
const sources=JSON.parse(gunzipSync(fs.readFileSync(`${out}/sources-submerged-complete.json.gz`)));
const game='src/engine/Core/Game.ts';
function replace(a,b){assert(sources[game].includes(a),a);sources[game]=sources[game].replace(a,b);}
replace(`                m.interruptCorpseAbsorption(damage);
                m.takeDamage(damage, false, this.grid);
                if (m.hp <= 0) (m as unknown as { die(): void }).die();`,
 `                m.takeDamage(damage, false, this.grid);`);
replace(`            if (entity instanceof Monster) entity.interruptCorpseAbsorption(damage);
            if (entity instanceof Monster) entity.takeDamage(damage, true, this.grid);`,
 `            if (entity instanceof Monster) entity.takeDamage(damage, true, this.grid);`);
replace(`                (entity as unknown as { die(): void }).die();
            }
        }
    }

    // =========================================================================
    // F-2c`, `            }
        }
    }

    // =========================================================================
    // F-2c`);
replace(`            (monst as unknown as { die(): void }).die();
        } else if (visible)`, `        } else if (visible)`);
replace(`                    if (entity instanceof Monster) entity.interruptCorpseAbsorption(Math.max(1, Math.floor(entity.maxHp / 15)));
                    if (entity instanceof Monster) entity.takeDamage`, `                    if (entity instanceof Monster) entity.takeDamage`);
replace(`                    if (entity.hp <= 0 && entity !== this.player) entity.die();
                }
            }

            // Gas`, `                }
            }

            // Gas`);
fs.writeFileSync(`${out}/sources-final.json.gz`,gzipSync(JSON.stringify(sources)));
let test=fs.readFileSync(`${out}/repaired-x2g-final.test.ts.txt`,'utf8');
test+=`
describe('X2g damage ownership regression',()=>{
    it('lethal rot blood from burning, explosion and gradual terrain has exactly one death callback',()=>{
        for(const source of ['burning','explosion','terrain']) {
            const g=scene();const m=add(g,'zombie',15,10);m.hp=1;
            const death=vi.spyOn(m as any,'die');
            if(source==='burning') { (m.statusDurations as any).burning=3;(g as any).resolveBurningDamage(m); }
            else if(source==='explosion') {g.grid.setTerrain(15,10,T.GAS_EXPLOSION);(g as any).resolveExplosionDamage(m);}
            else {g.grid.setTerrainLayer(15,10,L.SURFACE,T.ANCIENT_SPIRIT_VINES);(g as any).applyEnvironmentalEffects();}
            expect(m.hp,source).toBe(0);expect(death,source).toHaveBeenCalledTimes(1);
            expect(g.grid.getCell(15,10)!.layers[L.GAS],source).toBe(T.ROT_GAS);
        }
    });
});
`;
fs.writeFileSync(`${out}/repaired-x2g-delivery.test.ts.txt`,test);
if(process.argv.includes('--prepare-only'))process.exit(0);
for(const script of ['x2g-capture.mjs','x2g-traces.mjs']){
 const r=spawnSync(process.execPath,[`scripts/${script}`,'final'],{stdio:'inherit'});assert.equal(r.status,0);
}
const results=[];
for(const type of ['generation','ur2','ur3','ur4']){
 const suffix=type==='ur2'?'.json':'.json.gz';
 const read=stage=>{const b=fs.readFileSync(`${out}/${type}-${stage}${suffix}`);return JSON.parse(suffix.endsWith('.gz')?gunzipSync(b):b);};
 assert.deepEqual(read('final'),read('submerged-complete'),type);
 results.push({from:'submerged-complete',to:'final',family:'ROT_GAS damage death ownership',type,unchanged:true});
}
fs.writeFileSync(`${out}/death-final-attribution.json`,JSON.stringify(results,null,2)+'\n');
