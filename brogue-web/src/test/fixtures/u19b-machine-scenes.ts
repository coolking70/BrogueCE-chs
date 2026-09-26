// Fixed-site complete catalog builds; no feature/table edits or eligibility changes.
// Relocating the observer is test setup, not a claim of puzzle reachability.
import {machineScene} from './u19a-machine-scenes';
import {resetMachineCounter,type MachineResult} from '../../engine/Generator/BlueprintEngine';
import {setMachineObservationHook} from '../../engine/Generator/MachineObservation';
import {TerrainType} from '../../engine/Map/Grid';
import type {Game} from '../../engine/Core/Game';
const flatten=(m:MachineResult):MachineResult[]=>[m,...m.subMachines.flatMap(flatten)];
export function preparePendingScene(game:Game,ce:number,seed=1,size=0){
 const g:any=game;g.startNewGame({seed:19,mode:'test'});resetMachineCounter();setMachineObservationHook(()=>{});
 try{
  const scene=machineScene(game,ce,seed,size);if(!scene)throw Error(`CE${ce} complete blueprint failed`);
  const machines=flatten(scene.result);g.populateLevel(g.depth,false,false,machines);
  // Isolate inspection from ordinary population combat; retain every actual
  // parent/child machine resident, item, terrain and mechanism.
  const homes=new Set(machines.map(m=>m.machineNumber));
  g.monsters=g.monsters.filter((m:any)=>homes.has(m.machineHome));
  const products=machines.flatMap(m=>m.observation?.products??[]);
  const items=products.filter(p=>p.kind==='item'&&p.owner==='floor'&&p.instanceId!==undefined);
  const item=items.map(p=>g.items.find((i:any)=>i.id===p.instanceId)).find(i=>i&&g.grid.getCell(i.loc.x,i.loc.y)?.isPassable);
  const target=item?{...item.loc}:products.find(p=>p.instanceId!==undefined)?.pos??scene.result.featureSpawns.find((p:any)=>p.terrain)?.pos??scene.origin;
  let observer={...target};
  if(!g.grid.getCell(observer.x,observer.y)?.isPassable||g.getMonsterAt(observer.x,observer.y)){
   const adjacent=[];
   for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)if(dx||dy){const p={x:target.x+dx,y:target.y+dy};if(g.grid.getCell(p.x,p.y)?.isPassable&&!g.getMonsterAt(p.x,p.y))adjacent.push(p);}
   observer=adjacent[0]??{...scene.origin};
  }
  g.player.loc=observer;g.updateVision();g.update();g.needsRender=true;g.onRenderRequested?.();
  return {ce,seed,size,origin:scene.origin,observer,target,requestCount:machines.reduce((n,m)=>n+m.itemSpawns.length+m.monsterSpawns.length,0),products,
   itemId:item?.id,guardianIds:ce===15?g.dormantMonsters.filter((m:any)=>m.machineHome===scene.result.machineNumber).map((m:any)=>m.id):[],
   before:{inputCount:g.recordedInputEvents.length,layers:[...g.grid.getCell(target.x,target.y).layers],terrain:TerrainType[g.grid.getCell(target.x,target.y).terrain]}};
 }finally{setMachineObservationHook(null);}
}
export function pendingSceneState(game:Game,scene:ReturnType<typeof preparePendingScene>){
 const g:any=game,c=g.grid.getCell(scene.target.x,scene.target.y);
 return {inputs:g.recordedInputEvents.length,visible:c.isVisible,layers:[...c.layers],terrain:TerrainType[c.terrain],
  floorItem:scene.itemId===undefined?null:g.items.some((i:any)=>i.id===scene.itemId),
  inventoryItem:scene.itemId===undefined?null:g.player.inventory.items.some((i:any)=>i.id===scene.itemId),
  guardianActive:scene.guardianIds.every((id:number)=>g.monsters.some((m:any)=>m.id===id)),player:{...g.player.loc}};
}
