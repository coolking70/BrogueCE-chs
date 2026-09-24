import fs from 'node:fs';import {createHeadlessGame}from'../src/test/harness';import { Game } from '../src/engine/Core/Game';
import { BlueprintEngine } from '../src/engine/Generator/BlueprintEngine';
import{Grid,TerrainType as C}from'../src/engine/Map/Grid';
const rows=[],writes:unknown[]=[];let depth=0,activeSeed=0;
const machinePath: unknown[]=[];
const apply=(BlueprintEngine.prototype as any).applyBlueprint;
(BlueprintEngine.prototype as any).applyBlueprint=function(bp: any,...args: any[]){machinePath.push({id:bp.id,ce:bp.ceBlueprintId});try{return apply.call(this,bp,...args);}finally{machinePath.pop();}};
const targets=new Set(['424242/9/74/21','777/1/24/7','777/1/26/2','777/1/26/4','777/1/28/2','777/9/5/13','777/9/5/16','777/9/5/17']);
const start=Game.prototype.startNewGame;Game.prototype.startNewGame=function(options){activeSeed=Number(options?.seed??0);depth=1;return start.call(this,options);};
for(const method of ['setTerrain','setTerrainLayer']as const){const original=Grid.prototype[method];(Grid.prototype as any)[method]=function(...args:any[]){
 if(targets.has(`${activeSeed}/${depth}/${args[0]}/${args[1]}`))writes.push({seed:activeSeed,depth,machinePath:[...machinePath],method,args,before:this.getCell(args[0],args[1])?.layers.slice(),stack:new Error().stack?.split('\n').slice(2,8)});
 return (original as any).apply(this,args);
};}
for(const seed of [424242,777]){depth=0;const g:any=createHeadlessGame(seed);for(const d of [1,9]){depth=d;if(d>1){g.depth=d;g.generateDepth(false,false);}const combos=new Map<string,unknown>();for(let x=0;x<g.grid.width;x++)for(let y=0;y<g.grid.height;y++){const c=g.grid.getCell(x,y),key=c.layers.join(',');if(c.layers.filter((t:number)=>t!==C.NOTHING).length>1&&!combos.has(key))combos.set(key,{x,y,layers:c.layers.map((t:number)=>C[t]),machine:c.machineNumber});}rows.push({seed,depth:d,combos:[...combos.values()]});}}
fs.writeFileSync('ai_docs/reports/u-02b-evidence/terrain-trace.json',JSON.stringify({rows,writes},null,2)+'\n');
