// Read-only ownership/RNG trace. Baseline capture is a separate, gated action.
import fs from 'node:fs';
import { createHeadlessGame, terrainFingerprint } from '../src/test/harness';
import { Game } from '../src/engine/Core/Game';
import { ItemLoader } from '../src/engine/Items/ItemLoader';
import { ItemCategory } from '../src/engine/Items/Item';
import { rng } from '../src/engine/Random';
const base = JSON.parse(fs.readFileSync('ai_docs/reports/u-05-evidence/baseline-before.json','utf8'));
const proto = Game.prototype as any;
const populate = proto.populateLevel, spawnItem = proto.spawnBlueprintItem;
let rows: any[] = [], events: any[] = [], machines: any[] = [], materialized: any[] = [], records: any[] = [];
let recursion = 0;
let candidates:any[]=[];
const state=(i:any)=>i?({category:ItemCategory[i.category],kind:i.identityId??i.consumableId,quantity:i.quantity,strengthRequired:i.strengthRequired,enchantment:i.enchantment,
    charges:i.charges,maxCharges:i.maxCharges,staffRechargeRemaining:i.staffRechargeRemaining,flags:i.flags,isCursed:i.isCursed,runicType:i.runicType,
    identified:i.identified,cooldownRemaining:i.cooldownRemaining}):null;
for(const method of ['spawnStaff','spawnWand','spawnMachineRing','spawnMachineCharm','spawnWeapon','spawnArmor','spawnPotion','spawnScroll','spawnKey']) {
 const original=(ItemLoader as any)[method]; if(!original)continue;
 (ItemLoader as any)[method]=function(...args:any[]){const before=rng.randomNumbersGenerated;const item=original.apply(this,args);
  if(recursion)candidates.push({method,requestedKind:args[0],before,after:rng.randomNumbersGenerated,resource:state(item)});return item;};
}
proto.spawnBlueprintItem = function (...args: any[]) {
    const top = recursion++ === 0, before = rng.randomNumbersGenerated; if(top)candidates=[];
    try {
        const item = spawnItem.apply(this,args);
        if (top) {
            events.push({ args:args.slice(0,6), previous:args[6]?.map(state), before, after:rng.randomNumbersGenerated, candidates:[...candidates], item:state(item) });
            records.push({args,item});
            if (item) materialized.push(item);
        }
        return item;
    } finally { recursion--; }
};
proto.populateLevel = function (...args: any[]) {
    // Signature (depth, isGoingUp, isFirstLevel, machineResults); hook records all reward and autoGen machines.
    machines = args.find(Array.isArray) ?? [];
    events = []; materialized = []; records = [];
    const before = rng.randomNumbersGenerated;
    const result = populate.apply(this,args);
    const all = [...this.items,...this.monsters.flatMap((m:any)=>m.carriedItem?[m.carriedItem]:[]),...this.dormantMonsters.flatMap((m:any)=>m.carriedItem?[m.carriedItem]:[]),...this.player.inventory.items];
    const commands = machines.flatMap((m:any)=>[...m.itemSpawns.map((s:any)=>({s,pos:s.pos,owner:'floor',machine:m.blueprintId,number:m.machineNumber})),...m.monsterSpawns.flatMap((n:any)=>n.carriedItem?[{s:n.carriedItem,pos:n.pos,owner:'monster',machine:m.blueprintId,number:m.machineNumber}]:[])]);
    const ids=commands.map((x:any)=>x.s.instanceId).filter(Boolean);
    const created=machines.flatMap((m:any)=>m.generatedItems??[]);
    const problems:any[]=[];
    // Every command in these natural samples must reach the unchanged item loader.
    // Null results remain explicit U05 materialization debt, never live entities.
    if(commands.length!==records.length) problems.push({kind:'unconsumed-command',commands:commands.length,calls:records.length});
    const unused=[...records];
    for(const {s,pos,owner,number} of commands){
        const index=unused.findIndex(({args,item})=>args[0]===s.category&&args[1]===s.id&&(item?item.loc.x===pos.x&&item.loc.y===pos.y:args[2]===pos.x&&args[3]===pos.y));
        if(index<0){problems.push({kind:'missing-materialization',instance:s.instanceId});continue;}
        const {item}=unused.splice(index,1)[0];if(!item){problems.push({kind:'null-materialization',request:s.category});continue;}
        const hasOwner=owner==='floor'?this.items.includes(item):[...this.monsters,...this.dormantMonsters].some(m=>m.carriedItem===item&&m.machineHome===number);
        if(!hasOwner)problems.push({kind:'wrong-owner',instance:s.instanceId,owner});
        if(item.originDepth!==this.depth||JSON.stringify(item.keyLoc??[])!==JSON.stringify(s.keyLoc??[]))problems.push({kind:'lost-binding',instance:s.instanceId});
    }
    for(const item of materialized) if(all.filter(x=>x===item).length!==1) problems.push({kind:'entity-owner',id:item.id});
    if(new Set(all.map(x=>x.id)).size!==all.length) problems.push({kind:'duplicate-entity-id'});
    if(new Set(ids).size!==ids.length) problems.push({kind:'duplicate-command-id'});
    for(const item of created) if(commands.filter((x:any)=>x.s.instanceId===item.instanceId).length!==1) problems.push({kind:'creation-owner',id:item.instanceId});
    // Independent acceptance oracle: deliberately not the production predicate.
    for(const e of events){
        if(!e.item)continue;
        if(!e.args[0].split('|').includes(e.item.category))problems.push({kind:'wrong-category',event:e});
        if(e.args[5]===undefined)continue; // staged historical implementation has no Q yet
        const rejected=(i:any)=>i.isCursed
            || (e.args[5].includes('MF_REQUIRE_GOOD_RUNIC')&&!i.runicType&&!i.flags?.includes('ITEM_RUNIC'))
            || (e.args[5].includes('MF_NO_THROWING_WEAPONS')&&i.category==='WEAPON'&&i.quantity>1)
            || (e.args[5].includes('MF_REQUIRE_HEAVY_WEAPON')&&!(i.category==='WEAPON'&&!['dart','incendiary_dart','javelin'].includes(i.kind)&&i.strengthRequired>15&&i.enchantment>0))
            || (['STAFF','WAND','POTION','SCROLL','RING','WEAPON','ARMOR','CHARM'].includes(i.category)&&(e.previous??[]).some((p:any)=>p.category===i.category&&p.kind===i.kind));
        if(e.candidates.length>1002)problems.push({kind:'retry-overflow',event:e});
        if(e.candidates.length<1002&&rejected(e.item))problems.push({kind:'unqualified-item',event:e});
        if(e.candidates.slice(0,-1).some((c:any)=>!rejected(c.resource)))problems.push({kind:'unnecessary-reroll',event:e});
        const last=e.candidates.at(-1)?.resource;
        if(JSON.stringify(last)!==JSON.stringify(e.item))problems.push({kind:'lost-resources',event:e});
    }
    rows.push({depth:this.depth,before,after:rng.randomNumbersGenerated,events,
        machines:machines.map((m:any)=>({blueprint:m.blueprintId,number:m.machineNumber,created:(m.generatedItems??[]).length,
            floor:m.itemSpawns.map((s:any)=>({instance:s.instanceId,category:s.category,pos:s.pos,adopted:s.viaAdoption,qualifiers:s.itemQualifiers,prior:s.priorItemIds})),
            carried:m.monsterSpawns.filter((n:any)=>n.carriedItem).map((n:any)=>({instance:n.carriedItem.instanceId,category:n.carriedItem.category,qualifiers:n.carriedItem.itemQualifiers,prior:n.carriedItem.priorItemIds,pos:n.pos,horde:n.hordeFlags,monster:n.monsterId}))})),
        counts:{created:created.length,commands:commands.length,materialized:materialized.length,floor:this.items.length,carried:all.length-this.items.length-this.player.inventory.items.length},problems});
    return result;
};
const seeds = [...new Set([...base.seeds,1,2,3,42,777,20260924])];
const levels:Record<string,any[]>={}, traces:Record<string,any[]>={};
for(const seed of seeds){
    rows=[];const g:any=createHeadlessGame(seed); rows=rows.slice(-1);
    levels[seed]=[];
    for(let depth=1;depth<=26;depth++){
        if(depth>1){g.depth=depth;g.generateDepth(false,false);}
        levels[seed]!.push({fp:terrainFingerprint(g.grid),n:g.monsters.length,species:[...new Set(g.monsters.map((m:any)=>m.name))].sort().join(','),items:g.items.length});
    }
    traces[seed]=rows.slice();
}
fs.writeFileSync(process.argv[2]!,JSON.stringify({seeds,levels,traces},null,2)+'\n');
console.log(JSON.stringify({seeds:seeds.length,layers:seeds.length*26,problems:Object.entries(traces).flatMap(([seed,r])=>r.flatMap(l=>l.problems.map((p:any)=>({seed,depth:l.depth,...p}))))}));
