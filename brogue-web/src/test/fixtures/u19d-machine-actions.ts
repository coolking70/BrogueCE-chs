// Complete-machine action driver shared by deterministic tests and browser replay.
// Only setup relocates the observer to the entrance and isolates unrelated combat;
// every subsequent displacement, discovery and payoff uses the public commands.
import {TerrainType as T, type Cell} from '../../engine/Map/Grid';
import {cellTerrainFlags} from '../../engine/Map/DungeonFeature';
import {T_PATHING_BLOCKER,T_IS_DF_TRAP} from '../../engine/Map/TerrainCatalog';
import {ItemCategory} from '../../engine/Items/Item';
import type {Game} from '../../engine/Core/Game';
import type {MachineTrace} from '../../engine/Generator/MachineObservation';
import type {Pos} from '../../types';
export type Action={action:string;data?:any};
const dirs=[{x:0,y:-1},{x:0,y:1},{x:-1,y:0},{x:1,y:0}];
const same=(a:Pos,b:Pos)=>a.x===b.x&&a.y===b.y;
export function safe(g:any,p:Pos,allowTrap=false){const c=g.grid.getCell(p.x,p.y);return c&&!(cellTerrainFlags(g.grid,p.x,p.y)&(allowTrap ? T_PATHING_BLOCKER & ~T_IS_DF_TRAP : T_PATHING_BLOCKER))&&!c.layers.includes(T.TRAP_DOOR_HIDDEN)&&(allowTrap||![T.GAS_TRAP_PARALYSIS,T.GAS_TRAP_PARALYSIS_HIDDEN,T.MACHINE_TRIGGER_FLOOR].some(t=>c.layers.includes(t)));}
export function route(g:any,from:Pos,to:Pos,allowTrap=false):Pos[]|null{
 const q=[from],seen=new Map<string,Pos|null>([[`${from.x},${from.y}`,null]]);
 for(let i=0;i<q.length;i++){const p=q[i]!;if(same(p,to)){const r:Pos[]=[];let c:Pos|null=p;while(c&&!same(c,from)){r.unshift(c);c=seen.get(`${c.x},${c.y}`)!;}return r;}
  for(const d of dirs){const n={x:p.x+d.x,y:p.y+d.y},k=`${n.x},${n.y}`;if(!seen.has(k)&&safe(g,n,allowTrap)){seen.set(k,p);q.push(n);}}
 }return null;
}
export function runMachineActions(game:Game,trace:MachineTrace,explicitEntry?:Pos){
 const g:any=game,ce=trace.ceBlueprintId!,number=trace.machineNumber;
 const cells:Cell[]=g.grid.cells.flat(),owned=cells.filter(c=>c.machineNumber===number);
 const find=(...types:T[])=>owned.find(c=>types.some(t=>c.layers.includes(t)));
 const commands:Action[]=[],phases:any[]=[];
 const state=(label:string)=>{const s={label,player:{...g.player.loc},hp:g.player.hp,paralyzed:g.player.getStatusDuration('paralyzed'),depth:g.depth,
  tiles:owned.map(c=>({x:c.x,y:c.y,layers:[...c.layers],volume:c.volume})),inventory:g.player.inventory.items.map((i:any)=>i.id),
  residents:[...g.monsters,...g.dormantMonsters].filter((m:any)=>m.machineHome===number).map((m:any)=>({id:m.id,dormant:m.isDormant,hp:m.hp})),commands:commands.length};phases.push(s);return s;};
 const act=(action:string,data?:any)=>{commands.push({action,data});g.handlePlayerAction(action,data);if(g.isGameOver)throw Error('player died');};
 const walk=(to:Pos,allowTrap=false)=>{for(let retry=0;retry<300&&!same(g.player.loc,to);retry++){
  if(g.player.hasStatus('paralyzed')){act('wait');continue;}const path=route(g,g.player.loc,to,allowTrap);if(!path?.length)throw Error(`CE${ce}: no route ${JSON.stringify(g.player.loc)} -> ${JSON.stringify(to)}`);
  const p=path[0]!;act('move',{x:p.x-g.player.x,y:p.y-g.player.y});
 }if(!same(g.player.loc,to))throw Error('walk did not finish');};
 const neighbors=(p:Pos)=>dirs.map(d=>({x:p.x+d.x,y:p.y+d.y})).filter(p=>safe(g,p));
 const lever=[18,36,38,40].includes(ce)?find(T.WALL_LEVER_HIDDEN,T.WALL_LEVER):undefined,gate=find(T.PORTCULLIS_CLOSED,T.WORM_TUNNEL_OUTER_WALL),plate=find(T.PRESSURE_PLATE);
 const rewardProduct=trace.products.find(p=>p.kind==='item'&&p.owner==='floor');
 let reward=rewardProduct?g.items.find((i:any)=>i.id===rewardProduct.instanceId):undefined;
 let entry=explicitEntry;
 if(!entry&&gate){entry=neighbors(gate).find(p=>lever?neighbors(lever).some(n=>route(g,p,n)):plate?cells.some(c=>safe(g,c)&&Math.max(Math.abs(c.x-plate.x),Math.abs(c.y-plate.y))<=5&&route(g,p,c)):true);}
 if(!entry){const origin=trace.features.find(f=>f.request.flags.includes('MF_BUILD_AT_ORIGIN'))?.placements[0];entry=origin&&safe(g,origin)?origin:cells.filter(c=>safe(g,c)&&c.machineNumber===number)[0];}
 if(!entry)entry=cells.find(c=>safe(g,c)&&owned.some(o=>Math.abs(o.x-c.x)+Math.abs(o.y-c.y)===1));
 if(!entry)throw Error('no entrance');
 g.player.loc={x:entry.x,y:entry.y};g.player.hp=g.player.maxHp=10000;g.player.statusDurations={};g.animationEnabled=false;g.onConfirmRequest=()=>true;
 // Preserve all machine residents. Freeze their AI during mechanism inspection:
 // waking and identity changes still run, unrelated combat does not obscure them.
 g.monsters=g.monsters.filter((m:any)=>m.machineHome===number);
 for(const m of [...g.monsters,...g.dormantMonsters])m.ticksUntilTurn=1000000;
 g.bindDormantAwakener();g.updateVision();
 if(ce===28&&(!plate||!find(T.ALTAR_CAGE_RETRACTABLE)))throw Error('CE28 is already triggered or missing');
 const initial=JSON.parse(JSON.stringify(g.toSnapshot()));const before=state('entry');
 if(lever){
  const inaccessible=ce===18?g.items.filter((i:any)=>!route(g,entry!,i.loc)):[];
  const adjacent=neighbors(lever).find(p=>route(g,g.player.loc,p));if(!adjacent)throw Error('lever unreachable from entrance');walk(adjacent);
  for(let n=0;n<8&&lever.layers.includes(T.WALL_LEVER_HIDDEN);n++)act('search');state('searched');
  act('move',{x:lever.x-g.player.x,y:lever.y-g.player.y});state('pulled');
  if(reward&&[36,38].includes(ce))for(let n=0;n<200&&!route(g,g.player.loc,reward.loc);n++)act('wait');
  state('passage-ready');
  if(ce===18){reward=inaccessible.find((i:any)=>i.category===ItemCategory.KEY&&route(g,g.player.loc,i.loc))??inaccessible.find((i:any)=>route(g,g.player.loc,i.loc));}
  if(reward){walk(reward.loc);act('pickup');state('reward');walk(entry);}
  else if(gate)walk(gate);
 }else if(plate){
  const inaccessible=ce===22?g.items.filter((i:any)=>!route(g,entry!,i.loc)):[];
  const from=cells.filter(c=>safe(g,c)&&route(g,g.player.loc,c)&&Math.max(Math.abs(c.x-plate.x),Math.abs(c.y-plate.y))<=5).sort((a,b)=>Math.abs(a.x-plate.x)+Math.abs(a.y-plate.y)-Math.abs(b.x-plate.x)-Math.abs(b.y-plate.y))[0];
  if(!from)throw Error('no throwing position');walk(from);
  const item=g.player.inventory.items.find((i:any)=>i.category===ItemCategory.WEAPON&&!i.isCursed);if(!item)throw Error('no starting weapon');
  const data={itemId:item.id,x:plate.x,y:plate.y};commands.push({action:'throw',data});g.executeItemCommand('throw',item,undefined,()=>g.throwItemAt(item,plate.x,plate.y));state('thrown');
  if(ce===22)reward=inaccessible.find((i:any)=>i.category===ItemCategory.KEY&&route(g,g.player.loc,i.loc))??inaccessible.find((i:any)=>route(g,g.player.loc,i.loc));
  if(reward){walk(reward.loc);act('pickup');state('reward');walk(entry);}else if(gate)walk(gate);
 }else if([67,68].includes(ce)){
  const trap=find(T.GAS_TRAP_PARALYSIS,T.GAS_TRAP_PARALYSIS_HIDDEN)!;if(!trap)throw Error('no paralysis plate');
  walk(trap,true);state('triggered');
  // Stay in the cloud long enough to observe the actual player status, then
  // request movement until the transient cloud dissipates and movement resumes.
  for(let n=0;n<40&&!g.player.hasStatus('paralyzed');n++)act('wait');state('paralyzed');
  act('move',{x:1,y:0});state('blocked-move');
  const escape=cells.filter(c=>safe(g,c)&&!c.machineNumber&&route(g,g.player.loc,c,true)).sort((a,b)=>Math.abs(a.x-trap.x)+Math.abs(a.y-trap.y)-Math.abs(b.x-trap.x)-Math.abs(b.y-trap.y))[0];
  if(!escape)throw Error('no escape');walk(escape,true);state('escaped');
 }else if([21,69].includes(ce)){
  const trigger=find(T.MACHINE_TRIGGER_FLOOR)!;if(!trigger)throw Error('no statue trigger');walk(trigger,true);state('triggered');
  for(let n=0;n<100&&g.dormantMonsters.some((m:any)=>m.machineHome===number);n++)act('wait');state('awakened');
 }else if(ce===23){
  const door=trace.features.find(f=>f.request.flags.includes('MF_BUILD_AT_ORIGIN')&&f.placements.length)?.placements[0];
  if(!door)throw Error('no pit-field entrance');
  const adjacent=neighbors(door).find(p=>route(g,g.player.loc,p));if(adjacent)walk(adjacent);
  for(let n=0;n<5;n++)act('search');state('searched');walk(door);state('crossed');
 }else if(reward){
  walk(reward.loc);act('pickup');state('reward');
  if(ce===40){
   const exitLever=find(T.WALL_LEVER_HIDDEN,T.WALL_LEVER)!;if(!exitLever)throw Error('no created exit lever');
   const adjacent=neighbors(exitLever).find(p=>route(g,g.player.loc,p));if(!adjacent)throw Error('exit lever unreachable');walk(adjacent);
   for(let n=0;n<8&&exitLever.layers.includes(T.WALL_LEVER_HIDDEN);n++)act('search');state('searched');
   act('move',{x:exitLever.x-g.player.x,y:exitLever.y-g.player.y});state('pulled');
  }
  for(let n=0;n<100&&g.dormantMonsters.some((m:any)=>m.machineHome===number);n++)act('wait');state('awakened');
  walk(entry);state('returned');
 }else throw Error(`unsupported scene CE${ce}`);
 state('final');g.updateVision();g.update();g.needsRender=true;g.onRenderRequested?.();
 return {ce,machine:number,entry:{x:entry.x,y:entry.y},rewardId:reward?.id,initial,commands,phases,before,after:phases[phases.length-1]};
}
