import fs from 'node:fs';
import {defineConfig} from 'vitest/config';
const variant=process.env.U19C_VARIANT;
export default defineConfig({plugins:[{name:'u19c-counterfactual',enforce:'pre',load(id){
 if(variant==='no-explosion-decay'&&id.endsWith('/Map/TerrainCatalog.ts')){
  const s=fs.readFileSync(id,'utf8'),a=s.indexOf('[TerrainType.GAS_EXPLOSION]: e('),b=s.indexOf('    ),',a);
  return s.slice(0,a)+s.slice(a,b).replace('10000','0')+s.slice(b);
 }
 const match=id.match(/\/src\/engine\/(?:Core|Generator)\/(Game|BlueprintEngine|Architect)\.ts$/);if(!match)return;
 const file=match[1]!;
 if(variant==='head')return fs.readFileSync(`ai_docs/reports/u-19c-evidence/${file}-before.ts.txt`,'utf8');
 let text=fs.readFileSync(id,'utf8');
 if(variant==='bad-layer'&&file==='Game')text=text.replace('this.catchUpEnvironment(cached ?', 'if (this.depth === 9) this.grid.setTerrainLayer(52, 8, DungeonLayer.SURFACE, TerrainType.FOLIAGE); this.catchUpEnvironment(cached ?');
 if(variant==='bad-gas'&&file==='Game')text=text.replace('this.catchUpEnvironment(cached ?', 'if (this.depth === 9) this.grid.setTerrainLayer(52, 8, DungeonLayer.GAS, TerrainType.GRASS); this.catchUpEnvironment(cached ?');
 if(variant==='no-legacy-handoff'&&file==='Game')text=text.replace('mon.carriedItem = materialize(spawn.carriedItem, mon.loc);','/* no handoff */');
 if(variant==='no-rollback'&&file==='BlueprintEngine')text=text.replaceAll('abort!();','/* deliberately omit entity abort */');
 if(variant==='no-monsters'&&file==='BlueprintEngine')text=text.replace('spawn.entities = this.entities.spawn(spawn, machineNum)','spawn.entities = []');
 if(variant==='no-items'&&file==='BlueprintEngine')text=text.replace('if (theItem && this.entities) this.entities.item','if (false && theItem && this.entities) this.entities.item');
 if(variant==='no-occupancy'&&file==='BlueprintEngine')text=text.replace('this.entities.hasMonster(x, y)','false');
 if(variant==='late-minions'&&file==='Game')text=text.replace('if (collected) {\n                    mon = new Monster','if (false) {\n                    mon = new Monster');
 if(variant==='no-carrier-restore'&&file==='Game')text=text.replace('mon.carriedItem = item;','void item;');
 if(variant==='no-handoff'&&file==='BlueprintEngine')text=text.replace('this.entities?.handOff(torchBearer, torch);','void 0;');
 return text;
}}],test:{testTimeout:900000}});
