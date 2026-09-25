// Generated terrain, wiring, resident identities and item bindings are preserved.
// Place the player next to the trigger; remove unrelated active combatants.
import fs from 'node:fs';import {gunzipSync} from 'node:zlib';import assert from 'node:assert/strict';
import {createHeadlessGame} from '../src/test/harness';
import {TerrainType as T, DungeonLayer as L} from '../src/engine/Map/Grid';
const out='ai_docs/reports/u-17f-evidence',results:any[]=[];
for(const name of ['RAT_TRAP_WALL_DORMANT','STATUE_DORMANT','COFFIN_CLOSED','PORTAL','ALTAR_SWITCH_RETRACTING']){
 const snapshot=JSON.parse(gunzipSync(fs.readFileSync(`${out}/natural-${name}.json.gz`)).toString());
 const g:any=createHeadlessGame(1716,'test');assert(g.loadSnapshot(snapshot));g.animationEnabled=false;g.player.hp=g.player.maxHp=10000;g.player.statusDurations={};
 const target=g.grid.cells.flat().find((c:any)=>c.layers.includes((T as any)[name]));const machine=target.machineNumber;
 const residents=g.dormantMonsters.filter((m:any)=>m.machineHome===machine);const before=residents.map((m:any)=>({id:m.id,type:m.typeId,loc:m.loc}));
 const tiles=g.grid.cells.flat().filter((c:any)=>c.machineNumber===machine);
 let trigger=tiles.find((c:any)=>c.layers.includes(name==='PORTAL'?T.ALTAR_KEYHOLE:name==='COFFIN_CLOSED'?T.MACHINE_TRIGGER_FLOOR:name==='ALTAR_SWITCH_RETRACTING'?T.ALTAR_SWITCH_RETRACTING:T.ALTAR_SWITCH));
 trigger??=tiles.find((c:any)=>c.layers.includes(T.MACHINE_TRIGGER_FLOOR));assert(trigger,name);
 if(name==='PORTAL'){
  const key=g.items.find((i:any)=>g.keyMatchesLocation(i,trigger.x,trigger.y,trigger))??g.monsters.map((m:any)=>m.carriedItem).find((i:any)=>i&&g.keyMatchesLocation(i,trigger.x,trigger.y,trigger));assert(key,'generated portal key');
  g.items=g.items.filter((i:any)=>i!==key);for(const m of g.monsters)if(m.carriedItem===key)m.carriedItem=null;assert(g.player.inventory.addItem(key));
 }
 g.monsters=g.monsters.filter((m:any)=>m.machineHome===machine);g.bindDormantAwakener();
 const from=[[1,0],[-1,0],[0,1],[0,-1]].map(([dx,dy])=>({x:trigger.x+dx!,y:trigger.y+dy!})).find(p=>g.grid.getCell(p.x,p.y)?.isPassable&&!g.getMonsterAt(p.x,p.y));assert(from,name);g.player.loc=from;
 g.handlePlayerAction('move',{x:trigger.x-from.x,y:trigger.y-from.y},'system');
 if([T.ALTAR_SWITCH,T.ALTAR_SWITCH_RETRACTING].some(t=>trigger.layers.includes(t)))g.handlePlayerAction('pickup',undefined,'system');
 const active=tiles.map((c:any)=>({x:c.x,y:c.y,layers:c.layers.map((t:T)=>T[t])}));
 for(let i=0;i<180&&residents.some((m:any)=>m.isDormant);i++)g.handlePlayerAction('wait',undefined,'system');
 assert(residents.every((m:any)=>!m.isDormant),name);if(name==='ALTAR_SWITCH_RETRACTING')assert.equal(target.layers[L.DUNGEON],T.FLOOR_FLOODABLE);
 if(name==='COFFIN_CLOSED')assert.equal(target.layers[L.DUNGEON],T.COFFIN_OPEN);
 if(name==='PORTAL')assert(residents.length&&residents.every((m:any)=>m.isAlly));
 results.push({name,depth:g.depth,machine,trigger:{x:trigger.x,y:trigger.y},before,active,after:residents.map((m:any)=>({id:m.id,type:m.typeId,dormant:m.isDormant,loc:m.loc})),finalLayers:target.layers.map((t:T)=>T[t])});
 console.log(name,'passed');
}
fs.writeFileSync(`${out}/natural-replay.json`,JSON.stringify(results,null,2)+'\n');
