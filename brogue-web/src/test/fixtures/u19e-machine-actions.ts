// Whole, naturally built machines. Preparation supplies adventuring prerequisites
// and isolates unrelated combat; every later action crosses the player command API.
import {TerrainType as T} from '../../engine/Map/Grid';
import {ItemLoader} from '../../engine/Items/ItemLoader';
import {Monster, type MonsterData} from '../../entities/Monster';
import monsters from '../../data/monsters.json';
import type {Game} from '../../engine/Core/Game';
import type {MachineTrace} from '../../engine/Generator/MachineObservation';
import type {Pos} from '../../types';
import {route, safe, type Action} from './u19d-machine-actions';

const dirs=[{x:0,y:-1},{x:0,y:1},{x:-1,y:0},{x:1,y:0}];
const same=(a:Pos,b:Pos)=>a.x===b.x&&a.y===b.y;
export function runAltarActions(game:Game,trace:MachineTrace,explicitEntry?:Pos){
 const g:any=game,ce=trace.ceBlueprintId!,number=trace.machineNumber;
 const cells=g.grid.cells.flat(),owned=cells.filter((c:any)=>c.machineNumber===number);
 const ofType=(t:T)=>owned.filter((c:any)=>c.layers.includes(t));
 const commands:Action[]=[],phases:any[]=[];
 const residents=()=>[...g.monsters,...g.dormantMonsters,...g.purgatory].map((m:any)=>({id:m.id,loc:{...m.loc},hp:m.hp,maxHp:m.maxHp,ally:m.isAlly,dormant:m.isDormant,marked:m.markedForSacrifice,machine:m.machineHome,purgatory:g.purgatory.includes(m)}));
 const state=(label:string)=>{const s={label,commands:commands.length,player:{...g.player.loc},hp:g.player.hp,depth:g.depth,
  inventory:g.player.inventory.items.map((i:any)=>i.id),items:g.items.map((i:any)=>({id:i.id,loc:{...i.loc},enchantment:i.enchantment,category:i.category})),
  tiles:owned.map((c:any)=>({x:c.x,y:c.y,layers:[...c.layers]})),residents:residents()};phases.push(s);return s;};
 const act=(action:string,data?:any)=>{commands.push({action,data});
  if(action==='drop')g.executeItemCommand('drop',g.player.inventory.items.find((i:any)=>i.id===data.itemId));
  else g.handlePlayerAction(action,data);
  if(g.isGameOver)throw Error('player died');
 };
 const walk=(to:Pos)=>{for(let n=0;n<300&&!same(g.player.loc,to);n++){
  const path=route(g,g.player.loc,to,true);if(!path?.length)throw Error(`CE${ce}: no route ${JSON.stringify(g.player.loc)} -> ${JSON.stringify(to)}`);
  const p=path[0]!;act('move',{x:p.x-g.player.x,y:p.y-g.player.y});
 }if(!same(g.player.loc,to))throw Error(`CE${ce}: walk did not finish`);};
 const featureOrigin=trace.features.find(f=>f.request.flags.includes('MF_BUILD_AT_ORIGIN'))?.placements[0];
 const door=explicitEntry??featureOrigin;
 const doorCell=door&&g.grid.getCell(door.x,door.y);
 let entranceKey:any;
 let keySource:any;
 if(doorCell?.layers.includes(T.LOCKED_DOOR)){
  const all=[...g.items,...g.monsters.flatMap((m:any)=>m.carriedItem?[m.carriedItem]:[]),...g.dormantMonsters.flatMap((m:any)=>m.carriedItem?[m.carriedItem]:[])];
  entranceKey=all.find((i:any)=>g.keyMatchesLocation(i,door!.x,door!.y,doorCell));
  if(!entranceKey)throw Error('missing natural vestibule key');
  keySource={id:entranceKey.id,loc:{...entranceKey.loc},keyLoc:entranceKey.keyLoc};
  // Enter with the existing bound vestibule key already acquired. Preserve its
  // identity and bindings and remove its previous ownership exactly once.
  g.items=g.items.filter((i:any)=>i!==entranceKey);
  for(const m of [...g.monsters,...g.dormantMonsters])if(m.carriedItem===entranceKey)m.carriedItem=null;
  g.player.inventory.addItem(entranceKey);
 }
 let entry=entranceKey?dirs.map(d=>({x:door!.x+d.x,y:door!.y+d.y})).find(p=>safe(g,p,true)&&g.grid.getCell(p.x,p.y)!.machineNumber!==number):door;
 if(!entry||!safe(g,entry,true))entry=cells.find((c:any)=>safe(g,c,true)&&c.machineNumber!==number&&owned.some((o:any)=>Math.abs(o.x-c.x)+Math.abs(o.y-c.y)===1));
 if(!entry)throw Error('missing entrance');
 entry={x:entry.x,y:entry.y};
 g.player.loc={...entry};g.player.hp=g.player.maxHp=10000;g.player.statusDurations={};g.animationEnabled=false;g.onConfirmRequest=()=>true;
 g.monsters=g.monsters.filter((m:any)=>m.machineHome===number);g.dormantMonsters=g.dormantMonsters.filter((m:any)=>m.machineHome===number);
 g.purgatory=[];
 let pair:any[]=[];let allyId:number|undefined;
 if(ce===6){
  pair=[ItemLoader.spawnWeapon('dagger',entry.x,entry.y,g.depth)!,ItemLoader.spawnArmor('leather_armor',entry.x,entry.y,g.depth)!];
  pair.forEach((i,n)=>{if(!i)throw Error('invalid item prerequisite');i.enchantment=n?1:5;i.identified=true;i.isCursed=false;g.player.inventory.addItem(i);});
 }
 if(ce===7){
  // A dead, directly allied goblin is the U16 prerequisite. A real wait below
  // runs normal death cleanup into purgatory; the altar uses that same object.
  const ally=new Monster(entry.x,entry.y,(monsters as MonsterData[]).find(m=>m.id==='goblin')!);
  ally.isAlly=true;ally.hp=0;ally.totalPowerCount=3;allyId=ally.id;g.monsters.push(ally);
 }
 g.bindDormantAwakener();g.updateVision();
 const initial=JSON.parse(JSON.stringify(g.toSnapshot())),before=state('entry');
 if(entranceKey){act('move',{x:door!.x-g.player.x,y:door!.y-g.player.y});state('entered');}
 let rewardId:number|undefined,loanId:number|undefined,markedId:number|undefined;
 if(ce===6){
  const altars=ofType(T.COMMUTATION_ALTAR);if(altars.length!==2)throw Error('missing commutation pair');
  walk(altars[0]);act('drop',{itemId:pair[0].id});state('first-drop');
  walk(altars[1]);act('drop',{itemId:pair[1].id});state('swapped');
  if(pair[0].enchantment!==1||pair[1].enchantment!==5)throw Error('commutation failed');
  for(const altar of altars){walk(altar);act('pickup');}walk(entry);state('recovered');
 }else if(ce===7){
  const trigger=ofType(T.MACHINE_TRIGGER_FLOOR_REPEATING)[0];if(!trigger)throw Error('missing resurrection trigger');
  act('wait');state('death-cleaned');walk(trigger);act('wait');state('resurrected');walk(entry);
 }else if([1,2,26].includes(ce)){
  const loans=trace.products.filter(p=>p.kind==='item'&&p.owner==='floor').map(p=>g.items.find((i:any)=>i.id===p.instanceId)).filter(Boolean);
  const loan=loans.find((i:any)=>route(g,entry!,i.loc,true));if(!loan||loans.length<2)throw Error(`missing library collection: ${loans.length} items, entry ${JSON.stringify(entry)}, loans ${JSON.stringify(loans.map((i:any)=>({id:i.id,loc:i.loc,safe:safe(g,i.loc,true)})))}`);
  const at={...loan.loc};loanId=loan.id;walk(at);act('pickup');state('borrowed');walk(entry);state('closed');
  // Return while carrying the original bound item; bumping its closed cage
  // opens the same machine. Then put it back and check out a different item.
  const adjacent=dirs.map(d=>({x:at.x+d.x,y:at.y+d.y})).find(p=>safe(g,p,true)&&route(g,g.player.loc,p,true));
  if(!adjacent)throw Error('library return unreachable');walk(adjacent);act('move',{x:at.x-g.player.x,y:at.y-g.player.y});state('reopened');
  act('drop',{itemId:loan.id});walk(entry);state('replaced');
  const second=loans.find((i:any)=>i.id!==loan.id&&route(g,g.player.loc,i.loc,true));if(!second)throw Error('no second loan');
  rewardId=second.id;walk(second.loc);act('pickup');walk(entry);state('second-loan');
 }else if(ce===47){
  const altar=ofType(T.SACRIFICE_ALTAR_DORMANT)[0],cage=ofType(T.SACRIFICE_CAGE_DORMANT)[0];
  const target=[...g.monsters,...g.dormantMonsters].find((m:any)=>m.markedForSacrifice&&m.machineHome===number);
  const product=trace.products.find(p=>p.kind==='item'&&p.owner==='floor');
  const reward=g.items.find((i:any)=>i.id===product?.instanceId);
  if(!altar||!cage||!target||!reward)throw Error('incomplete sacrifice machine');
  markedId=target.id;rewardId=reward.id;
  const trigger=ofType(T.MACHINE_TRIGGER_FLOOR)[0];if(!trigger)throw Error('missing sacrifice trigger');
  walk(trigger);state('activated');
  // Walk to the level's chosen statue and wake the real dormant horde leader.
  const wake=dirs.map(d=>({x:target.x+d.x,y:target.y+d.y})).find(p=>safe(g,p,true)&&route(g,g.player.loc,p,true));
  if(!wake)throw Error('marked statue unreachable');walk(wake);
  for(let n=0;n<30&&target.isDormant;n++)act('wait');state('awakened');
  // Draw the enemy back to the altar. Ordinary pursuit and objective time stay
  // enabled; the driver never relocates or directly promotes the marked monster.
  walk(altar);state('lured');
  for(let n=0;n<120&&target.hp>0;n++){
   const dx=Math.sign(altar.x-target.x),dy=Math.sign(altar.y-target.y);
   const beyond=[{x:altar.x+dx,y:altar.y+dy},...dirs.map(d=>({x:altar.x+d.x,y:altar.y+d.y}))].find(p=>safe(g,p,true)&&!same(p,target.loc)&&route(g,g.player.loc,p,true));
   if(!beyond)throw Error('no safe lure position');
   walk(beyond);act('wait');
  }
  state('sacrificed');if(target.hp>0)throw Error(`marked target did not enter altar ${JSON.stringify(target.loc)}`);
  walk(reward.loc);act('pickup');state('reward');walk(entry);
 }else throw Error(`unknown family ${ce}`);
 state('final');g.updateVision();g.update();
 return {ce,machine:number,entry,keySource,initial,before,after:phases[phases.length-1],commands,phases,pairIds:pair.map(i=>i.id),allyId,markedId,rewardId,loanId};
}
