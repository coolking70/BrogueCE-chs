import fs from 'node:fs';import {createHeadlessGame} from '../src/test/harness';import {Game} from '../src/engine/Core/Game';import {Grid,TerrainType as T} from '../src/engine/Map/Grid';
let observedSeed=0,active=false;const writes=new Map<string,any[]>(),rows:any[]=[],original=Grid.prototype.setTerrainLayer;
Grid.prototype.setTerrainLayer=function(...args){const [x,y,layer,tile]=args,before=this.getCell(x,y)?.layers.slice();const r=original.apply(this,args);const key=`${x},${y}`,v=writes.get(key)??[];v.push({layer,tile:T[tile],before,after:this.getCell(x,y)?.layers.slice(),stack:new Error().stack?.split('\n').slice(2,6)});writes.set(key,v.slice(-8));return r;};
const catchUp=(Game.prototype as any).catchUpEnvironment;
(Game.prototype as any).catchUpEnvironment=function(...args:any[]){
 if(!active)return catchUp.apply(this,args);const groups=new Map<string,any[]>();for(const c of this.grid.cells.flat())if(c.layers.filter((t:T)=>t!==T.NOTHING).length>=2){const key=c.layers.map((t:T)=>T[t]).join('/'),v=groups.get(key)??[];v.push({x:c.x,y:c.y,machine:c.machineNumber,writes:writes.get(`${c.x},${c.y}`)});groups.set(key,v);}
 rows.push({seed:observedSeed,depth:this.depth,combinations:[...groups].map(([layers,cells])=>({layers,count:cells.length,samples:cells.slice(0,2)}))});return catchUp.apply(this,args);
};
for(const seed of [424242,777]){active=false;observedSeed=seed;const g:any=createHeadlessGame(seed);active=true;writes.clear();g.startNewGame({seed});g.depth=9;writes.clear();g.generateDepth(false,false);}
fs.writeFileSync('ai_docs/reports/u-19f-evidence/layer-writer-trace.json',JSON.stringify(rows,null,2)+'\n');
