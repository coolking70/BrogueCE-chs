import fs from 'node:fs';
import {createHeadlessGame} from '../src/test/harness';
import {TerrainType as T} from '../src/engine/Map/Grid';
import {BlueprintEngine, type BlueprintDef} from '../src/engine/Generator/BlueprintEngine';
import data from '../src/data/blueprints.json';
import {rng} from '../src/engine/Random';
const results=[];
for(const id of [6,7])for(const seed of [1715,20260926,777,1,2,3]){
 const g:any=createHeadlessGame(1715,'test');g.items=[];g.monsters=[];g.dormantMonsters=[];
 for(let x=0;x<g.grid.width;x++)for(let y=0;y<g.grid.height;y++)g.grid.setTerrain(x,y,T.GRANITE);
 const cells=[];for(let x=6;x<=17;x++)for(let y=6;y<=10;y++){g.grid.setTerrain(x,y,T.FLOOR);cells.push({x,y});}g.grid.setTerrain(5,8,T.FLOOR);
 const bp=(data as BlueprintDef[]).find(b=>b.ceBlueprintId===id)!;rng.seedRandomGenerator(seed);
 const engine:any=new BlueprintEngine(g.grid,16);const result=engine.applyBlueprint(bp,{cells,center:{x:11,y:8},door:{x:6,y:8}});
 results.push({id,seed,result:result?.featureSpawns??null,tiles:g.grid.cells.flat().filter((c:any)=>c.layers.includes(T.PIPE_GLOWING)).map((c:any)=>[c.x,c.y])});
 if(result){fs.writeFileSync(`ai_docs/reports/u-17e-evidence/room-${id}.json`,JSON.stringify(g.toSnapshot()));break;}
}
fs.writeFileSync('ai_docs/reports/u-17e-evidence/room-probe.json',JSON.stringify(results,null,2));console.log(results);
