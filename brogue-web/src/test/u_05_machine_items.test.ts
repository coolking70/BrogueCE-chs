import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import { Game } from '../engine/Core/Game';
import { Item, ItemCategory as C } from '../engine/Items/Item';
import { ItemLoader } from '../engine/Items/ItemLoader';
import { generateQualifiedMachineItem, machineItemRejections } from '../engine/Items/MachineItemGeneration';
import { rng } from '../engine/Random';
import { BlueprintEngine, type FeatureDef, type MachineItemSpawn } from '../engine/Generator/BlueprintEngine';
import { Grid, TerrainType as T, DCOLS, DROWS } from '../engine/Map/Grid';
import { createHeadlessGame } from './harness';
import { serializeItem, deserializeItem } from '../engine/Core/EntitySnapshot';
import { Architect } from '../engine/Generator/Architect';

const api = Object.create(Game.prototype) as any;
const spawn = (category:string, id?:string, q?:string[], previous:Item[]=[]) => api.spawnBlueprintItem(category,id,7,8,12,q,previous) as Item|null;
const state = (i:Item) => ({category:i.category,kind:i.identityId??i.consumableId,enchantment:i.enchantment,
    charges:i.charges,maxCharges:i.maxCharges,staffRechargeRemaining:i.staffRechargeRemaining,isCursed:i.isCursed,
    runicType:i.runicType,flags:i.flags,quantity:i.quantity,identified:i.identified,cooldownRemaining:i.cooldownRemaining});
afterEach(()=>vi.restoreAllMocks());

describe('U05 request → kind → CE resource → quality',()=>{
    for(const [category,pool,method] of [
        ['STAFF',ItemLoader.genStaffs,'spawnStaff'],['WAND',ItemLoader.genWands,'spawnWand'],
        ['RING',ItemLoader.genRings,'spawnMachineRing'],['CHARM',ItemLoader.genCharms,'spawnMachineCharm'],
    ] as const) it(`${category}: every explicit kind, category order, resource lottery and no depth gate`,()=>{
        for(const entry of pool){
            rng.seedRandomGenerator(519);const initial=rng.getState();
            const explicit=spawn(category,entry.id)!;
            const after=rng.getState();
            rng.setState(initial);
            const weight=ItemLoader.CE_ITEM_GENERATION_PROBABILITIES.find(s=>C[s.category]===category)!.weight;
            rng.randRange(1,weight);
            const expected=(ItemLoader[method] as (id:string,x:number,y:number)=>Item|null).call(ItemLoader,entry.id,7,8)!;
            expect(state(explicit)).toEqual(state(expected));expect(rng.getState()).toEqual(after);
            expect(explicit.identityId).toBe(entry.id);expect(C[explicit.category]).toBe(category);
        }
        const pick=vi.spyOn(ItemLoader,'chooseKind');
        const make=vi.spyOn(ItemLoader,method);
        rng.seedRandomGenerator(13);const item=api.spawnBlueprintItem(category,undefined,7,8,1)!;
        expect(pick).toHaveBeenCalledExactlyOnceWith(pool.map(p=>p.frequency??0));
        expect(make).toHaveBeenCalledExactlyOnceWith(item.identityId,7,8);
    });
    it('mixed masks draw category once, then kind, then resources (input mask order is irrelevant)',()=>{
        for(const seed of [1,2,3,42,519]){
            rng.seedRandomGenerator(seed);const initial=rng.getState();const a=spawn('CHARM|STAFF|RING')!;const after=rng.getState();
            rng.setState(initial);const b=spawn('STAFF|RING|CHARM')!;
            expect(state(a)).toEqual(state(b));expect(rng.getState()).toEqual(after);
        }
    });
    it('ring CE 16% curse and 10% positive tail; charm 7% tail starts ready',()=>{
        vi.spyOn(rng,'randClumpedRange').mockReturnValue(2);
        const percent=vi.spyOn(rng,'randPercent').mockReturnValueOnce(true);
        const cursed=ItemLoader.spawnMachineRing('ring_of_wisdom',0,0)!;
        expect(cursed.enchantment).toBe(-2);expect(cursed.isCursed).toBe(true);expect(percent.mock.calls).toEqual([[16]]);
        percent.mockReset().mockReturnValueOnce(false).mockReturnValueOnce(true).mockReturnValueOnce(false);
        const ring=ItemLoader.spawnMachineRing('ring_of_wisdom',0,0)!;
        expect(ring.enchantment).toBe(3);expect(percent.mock.calls).toEqual([[16],[10],[10]]);
        percent.mockReset().mockReturnValueOnce(true).mockReturnValueOnce(false);
        const charm=ItemLoader.spawnMachineCharm('charm_of_health',0,0)!;
        expect(charm.enchantment).toBe(3);expect(charm.charges).toBe(0);expect(charm.cooldownRemaining).toBe(0);
        expect(charm.identified).toBe(true);expect(percent.mock.calls).toEqual([[7],[7]]);
    });
    it('replays all 67 historical null requests as real items, independently of changed natural seeds',()=>{
        const history=JSON.parse(fs.readFileSync('ai_docs/reports/u-05-evidence/historical-null-requests.json','utf8'));
        expect(history).toHaveLength(67);
        for(const row of history){
            rng.seedRandomGenerator(Number(row.seed));
            const item=api.spawnBlueprintItem(...row.args,[]) as Item;
            expect(item,JSON.stringify(row)).not.toBeNull();
            expect(row.args[0].split('|')).toContain(C[item.category]);
            expect(item.identityId).toBeTruthy();expect(item.isCursed).toBe(false);
            if(item.category===C.STAFF){expect(item.charges).toBe(item.enchantment);expect(item.maxCharges).toBe(item.enchantment);expect(item.staffRechargeRemaining).toBeGreaterThan(0);}
            if(item.category===C.WAND)expect(item.charges).toBeGreaterThan(0);
        }
    });
});

const weapon=()=>{const i=new Item('test',')',0,C.WEAPON);i.identityId='war_axe';i.strengthRequired=19;i.enchantment=1;return i;};
describe('U05 CE rejection and failsafe boundaries',()=>{
    it('matches 576 compiled original-CE predicates and all five retry boundaries',()=>{
        const golden=JSON.parse(fs.readFileSync('ai_docs/reports/u-05-evidence/ce-golden.json','utf8'));
        expect(golden.cases).toHaveLength(576);
        const categories=[C.WEAPON,C.ARMOR,C.POTION,C.SCROLL,C.STAFF,C.WAND,C.RING,C.CHARM,C.KEY];
        for(const [cat,q,profile,kind,flags,quantity,enchant,strength,rejected] of golden.cases){
            const i=Object.assign(weapon(),{category:categories[cat],identityId:kind===2?'javelin':'war_axe',isCursed:!!(flags&1),flags:flags&2?['ITEM_RUNIC']:[],quantity,enchantment:enchant,strengthRequired:strength});
            const qualifiers=['MF_REQUIRE_GOOD_RUNIC','MF_NO_THROWING_WEAPONS','MF_REQUIRE_HEAVY_WEAPON'].filter((_,n)=>q&(1<<n));
            expect(machineItemRejections(i,qualifiers,profile===7?[i]:[]).length>0,JSON.stringify({cat,q,profile})).toBe(!!rejected);
        }
        for(const row of golden.boundaries){let calls=0;
            const item=generateQualifiedMachineItem(()=>Object.assign(weapon(),{isCursed:++calls!==row.acceptAt}),[],[])!;
            expect({calls,cursed:item.isCursed}).toEqual({calls:row.calls,cursed:row.cursed});
        }
    });
    it('unconditional curse; require runic bit, throwing quantity, heavy kind/strength AND positive enchant',()=>{
        const i=weapon();i.isCursed=true;expect(machineItemRejections(i,[],[])).toEqual(['cursed']);i.isCursed=false;
        expect(machineItemRejections(i,['MF_REQUIRE_GOOD_RUNIC'],[])).toEqual(['runic']);
        i.flags=['ITEM_RUNIC'];expect(machineItemRejections(i,['MF_REQUIRE_GOOD_RUNIC'],[])).toEqual([]);
        i.quantity=2;expect(machineItemRejections(i,['MF_NO_THROWING_WEAPONS'],[])).toEqual(['throwing']);i.quantity=1;
        for(const change of [{enchantment:0},{strengthRequired:15},{identityId:'javelin'},{category:C.ARMOR}]){
            const candidate=Object.assign(weapon(),change);expect(machineItemRejections(candidate,['MF_REQUIRE_HEAVY_WEAPON'],[])).toEqual(['heavy']);
        }
        expect(machineItemRejections(i,['MF_REQUIRE_HEAVY_WEAPON'],[])).toEqual([]);
    });
    it('duplicates compare category and construction kind, never display names; all eight CE categories',()=>{
        for(const category of [C.STAFF,C.WAND,C.POTION,C.SCROLL,C.RING,C.WEAPON,C.ARMOR,C.CHARM]){
            const a=Object.assign(weapon(),{category,identityId:'same',name:'one'}),b=Object.assign(weapon(),{category,identityId:'same',name:'two'});
            expect(machineItemRejections(a,[],[b])).toEqual(['duplicate']);b.identityId='other';b.name=a.name;
            expect(machineItemRejections(a,[],[b])).toEqual([]);
        }
        const key=Object.assign(weapon(),{category:C.KEY});expect(machineItemRejections(key,[],[key])).toEqual([]);
    });
    it('1002 candidates at exhaustion; terminal invalid candidate retained; null propagates immediately',()=>{
        let count=0;const rejected=()=>{count++;const i=weapon();i.isCursed=true;return i;};
        const last=generateQualifiedMachineItem(rejected,[],[])!;expect(count).toBe(1002);expect(last.isCursed).toBe(true);
        const none=vi.fn(()=>null);expect(generateQualifiedMachineItem(none,[],[])).toBeNull();expect(none).toHaveBeenCalledTimes(1);
        count=0;const accepted=generateQualifiedMachineItem(()=>{const i=rejected();if(count===1001)i.isCursed=false;return i;},[],[])!;
        expect(count).toBe(1001);expect(accepted.isCursed).toBe(false);
    });
    it('each retry redraws the entire category/kind/resource request',()=>{
        const bad=Object.assign(weapon(),{isCursed:true}),good=weapon();
        const roll=vi.spyOn(api,'rollBlueprintItem').mockReturnValueOnce(bad).mockReturnValueOnce(good);
        expect(spawn('WEAPON|ARMOR',undefined,[])).toBe(good);
        expect(roll.mock.calls).toEqual([['WEAPON|ARMOR',undefined,7,8,12],['WEAPON|ARMOR',undefined,7,8,12]]);
    });
    it('unimplemented CE runic effects retain ITEM_RUNIC through generation',()=>{
        vi.spyOn(rng,'randPercent').mockReturnValueOnce(true).mockReturnValueOnce(false);
        vi.spyOn(rng,'randRange').mockReturnValueOnce(1).mockReturnValueOnce(10).mockReturnValueOnce(3);
        const i=ItemLoader.spawnWeapon('dagger',0,0)!;
        expect(i.flags).toContain('ITEM_RUNIC');expect(i.runicType).toBeUndefined();
        expect(machineItemRejections(i,['MF_REQUIRE_GOOD_RUNIC'],[])).toEqual([]);
    });
});

function machine(features:FeatureDef[],adoptiveItem?:MachineItemSpawn){
    const grid=new Grid(DCOLS,DROWS),cells:{x:number;y:number}[]=[];
    for(let x=4;x<44;x++)for(let y=4;y<24;y++){grid.setTerrain(x,y,T.FLOOR,'.',0);cells.push({x,y});}
    const e:any=new BlueprintEngine(grid,12);let n=0;e.findFeaturePosition=()=>({x:8+n++,y:8});
    const bp={id:'u05',category:'reward',flags:adoptiveItem?['BP_ADOPT_ITEM']:[],features};
    return {e,grid,cells,bp,apply:()=>e.applyBlueprint(bp,{cells,center:{x:20,y:15},door:null},{adoptiveItem:adoptiveItem??null})};
}
describe('U05 quality follows the one-owner transaction',()=>{
    it('earlier own and child creations enter parent duplicate scope; adopted source is not a child creation',()=>{
        const f:FeatureDef={instanceCount:[1,1],flags:['MF_GENERATE_ITEM'],itemCategory:'STAFF'};
        const {e,apply}=machine([{...f,flags:[...f.flags,'MF_OUTSOURCE_ITEM_TO_MACHINE']},f]);
        e.buildAMachine=(_id:any,_flags:any,incoming:MachineItemSpawn)=>({subMachines:[],generatedItems:[{instanceId:'child:new',category:'WAND',pos:{x:9,y:9}}],
            itemSpawns:[incoming,{instanceId:'child:new',category:'WAND',pos:{x:9,y:9}}],monsterSpawns:[]});
        const r=apply();expect(r.generatedItems[0].priorItemIds).toEqual([]);
        expect(r.generatedItems[1].priorItemIds).toEqual([r.generatedItems[0].instanceId,'child:new']);
    });
    it('all six equipment categories retain the full generated quality payload through the U01 codec',()=>{
        for(const [category,id,q] of [
            ['WEAPON','dagger',['MF_REQUIRE_GOOD_RUNIC']],['ARMOR','leather_armor',['MF_REQUIRE_GOOD_RUNIC']],
            ['STAFF','staff_of_obstruction',[]],['WAND','wand_of_domination',[]],
            ['RING','ring_of_wisdom',[]],['CHARM','charm_of_health',[]],
        ] as const){
            rng.seedRandomGenerator(17);
            const item=spawn(category,id,[...q])!;expect(item).not.toBeNull();
            const encoded=JSON.parse(JSON.stringify(serializeItem(item)));
            expect(JSON.parse(JSON.stringify(serializeItem(deserializeItem(encoded))))).toEqual(encoded);
            expect(machineItemRejections(item,q,[])).toEqual([]);
        }
    });
    it('later duplicate checks never relocate an already-owned outsourced instance',()=>{
        const g:any=createHeadlessGame(42);g.depth=12;
        const first:MachineItemSpawn={instanceId:'a',category:'STAFF',id:'staff_of_blinking',pos:{x:8,y:8},priorItemIds:[]};
        const second:MachineItemSpawn={instanceId:'b',category:'WAND',id:'wand_of_teleportation',pos:{x:10,y:8},priorItemIds:['a']};
        const child={blueprintId:'child',machineNumber:2,cells:[],center:{x:20,y:8},door:null,needsKey:false,generatedItems:[],itemSpawns:[{...first,pos:{x:20,y:8},viaAdoption:true}],monsterSpawns:[],subMachines:[]};
        const parent={...child,blueprintId:'parent',machineNumber:1,generatedItems:[first,second],itemSpawns:[second],subMachines:[child]};
        const generate=Architect.prototype.generateLevel;
        vi.spyOn(Architect.prototype,'generateLevel').mockImplementation(function(this:Architect,...args:Parameters<Architect['generateLevel']>){
            const grid=generate.apply(this,args);(this as any).machineResults=[child,parent];
            for(const x of [8,10,20])grid.setTerrain(x,8,T.FLOOR,'.',0);return grid;
        });
        g.generateDepth(false,false);
        const staff=g.items.find((i:Item)=>i.identityId==='staff_of_blinking'&&i.originDepth===12);
        expect(staff.loc).toEqual({x:20,y:8});expect(g.items.filter((i:Item)=>i.id===staff.id)).toHaveLength(1);
    });
    it('invalid web loader request propagates as an error instead of publishing a missing item',()=>{
        const f:FeatureDef={instanceCount:[1,1],flags:['MF_GENERATE_ITEM'],itemCategory:'STAFF',itemId:'missing'};
        const {apply}=machine([f]);const r=apply();const g:any=createHeadlessGame(42);g.depth=12;
        const generate=Architect.prototype.generateLevel;
        vi.spyOn(Architect.prototype,'generateLevel').mockImplementation(function(this:Architect,...args:Parameters<Architect['generateLevel']>){
            const grid=generate.apply(this,args);(this as any).machineResults=[r];grid.setTerrain(8,8,T.FLOOR,'.',0);return grid;
        });
        expect(()=>g.generateDepth(false,false)).toThrow('Cannot generate machine item: STAFF/missing');
    });
    for(const carried of [false,true])it(`${carried?'carrier':'floor'} → JSON → death/pickup → JSON retains identity/resources/quality`,()=>{
        const f:FeatureDef={instanceCount:[1,1],flags:['MF_GENERATE_ITEM',...(carried?['MF_MONSTER_TAKE_ITEM']:[])],itemCategory:'STAFF',itemId:'staff_of_blinking',monsterId:carried?'rat':undefined};
        const {apply}=machine([f]);const r=apply();
        const g:any=createHeadlessGame(42);g.depth=12;
        const generate=Architect.prototype.generateLevel;
        vi.spyOn(Architect.prototype,'generateLevel').mockImplementation(function(this:Architect,...args:Parameters<Architect['generateLevel']>){
            const grid=generate.apply(this,args);(this as any).machineResults=[r];grid.setTerrain(8,8,T.FLOOR,'.',0);return grid;
        });
        g.generateDepth(false,false);
        const owners=()=>[...g.items,...g.monsters.flatMap((m:any)=>m.carriedItem?[m.carriedItem]:[]),...g.dormantMonsters.flatMap((m:any)=>m.carriedItem?[m.carriedItem]:[]),...g.player.inventory.items];
        const item=owners().find(i=>i.identityId==='staff_of_blinking'&&i.originDepth===12)!;expect(item).toBeDefined();
        const id=item.id,before=state(item);const check=()=>{const list=owners().filter(i=>i.id===id);expect(list).toHaveLength(1);expect(state(list[0])).toEqual(before);};
        g.loadSnapshot(JSON.parse(JSON.stringify(g.toSnapshot())));check();
        if(carried){const m=g.monsters.find((m:any)=>m.carriedItem?.id===id);m.hp=0;g.removeDeadMonsters();check();}
        const floor=g.items.find((i:Item)=>i.id===id);g.player.loc={...floor.loc};g.pickUpItemAfterDisplacement();check();
        g.loadSnapshot(JSON.parse(JSON.stringify(g.toSnapshot())));check();expect(g.player.inventory.items.some((i:Item)=>i.id===id)).toBe(true);
    });
});
