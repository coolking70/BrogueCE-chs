import fs from 'node:fs';
import i18next from 'i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateItemDetail } from '../engine/UI/DetailGenerator';
import { Game } from '../engine/Core/Game';
import { Grid, DungeonLayer, TerrainType as T, DCOLS, DROWS } from '../engine/Map/Grid';
import { EnvironmentManager } from '../engine/Environment/Gas';
import { FOVSys } from '../engine/Lighting/FOV';
import { LightMap } from '../engine/Lighting/LightMap';
import { ItemLoader } from '../engine/Items/ItemLoader';
import { enchantArcana } from '../engine/Items/ArcanaEnchantment';
import { staffChargeDuration, tickStaffRecharge, rechargeStaffFully, restoreStaffRecharge } from '../engine/Items/ArcanaRecharge';
import { ItemCategory } from '../engine/Items/Item';
import { getBoltForItem, BOLT_EFFECT_CE_EFFECT } from '../engine/Combat/Bolt';
import { CEBoltType, CE_BOLT_CATALOG } from '../engine/Combat/BoltCatalog';
import { rng } from '../engine/Random';
import { Monster, MonsterState, type MonsterData } from '../entities/Monster';
import monsters from '../data/monsters.json';
import { createHeadlessGame } from './harness';
const ids = 'lightning fire poison tunneling blinking entrancement obstruction discord conjuration healing haste protection'.split(' ').map(s=>'staff_of_'+s);
const added = ids.slice(3,6), weights = [15,15,10,10,11,6,10,10,8,5,5,5];
const oldIds = 'fire lightning poison healing haste conjuration light'.split(' ').map(s=>'staff_of_'+s);
beforeEach(() => { if (!i18next.isInitialized) i18next.init({ lng: 'en', resources: {}, initImmediate: false }); rng.seedRandomGenerator(2525); ItemLoader.initConsumables(); });
afterEach(() => vi.restoreAllMocks());
function scene(id = 'rat') {
    const g = createHeadlessGame(2525, 'test');
    g.grid = new Grid(DCOLS, DROWS);
    for (let x = 0; x < DCOLS; x++) for (let y = 0; y < DROWS; y++) {
        g.grid.setTerrain(x,y, x > 0 && x < DCOLS - 1 && y > 0 && y < DROWS - 1 ? T.FLOOR : T.WALL);
        Object.assign(g.grid.getCell(x,y)!, { isVisible: true, hasMemory: true, isDiscovered: true });
    }
    g.player.loc = { x: 4, y: 5 }; g.player.hp = g.player.maxHp = 100;
    g.monsters = []; g.items = []; g.dormantMonsters = []; g.player.inventory.items = [];
    g.player.equippedWeapon = g.player.equippedArmor = g.player.ringLeft = g.player.ringRight = null;
    g.environment = new EnvironmentManager(g.grid); g.fov = new FOVSys(g.grid); g.lightMap = new LightMap(g.grid);
    const m = new Monster(9, 5, (monsters as MonsterData[]).find(d => d.id === id)!);
    m.state = MonsterState.HUNTING; m.ticksUntilTurn = 100000; g.monsters.push(m);
    return { g, m };
}

describe('W-25 staff catalog', () => {
    it('parses all twelve CE rows including non-contiguous wood slots, range, polarity, value and power', () => {
        const body = fs.readFileSync('../BrogueCE-master/src/brogue/Globals.c','utf8').split('itemTable staffTable[NUMBER_STAFF_KINDS] = {')[1]!.split('\n};')[0]!;
        const rows = [...body.matchAll(/\{"([^"]+)",\s*itemWoods\[(\d+)\], "",\s*(\d+),\s*(\d+),\s*0,\s*BOLT_(\w+),\s*\{(\d+),(\d+),(\d+)\}, false, false, (-?1),/g)];
        expect(rows).toHaveLength(12);
        expect(ItemLoader.genStaffs.map(s=>s.id)).toEqual(ids);
        expect(ItemLoader.staffs.map(s=>s.id)).toEqual([...ids,'staff_of_light']);
        expect(ItemLoader.genStaffs.reduce((s,c)=>s+c.frequency!,0)).toBe(110);
        expect(rows.map(r=>Number(r[2]))).toEqual([0,1,3,4,5,6,7,8,9,10,11,12]);
        const ceIds = rows.map(r=>'staff_of_'+(r[1]==='firebolt'?'fire':r[1]));
        expect(ceIds.filter(id=>ids.includes(id))).toEqual(ids);
        rows.forEach((r,i)=>{
            const id = ceIds[i]!, cfg = ItemLoader.staffs.find(s=>s.id===id);
            expect(r.slice(6,9).map(Number)).toEqual([2,4,1]); // metadata, NOT the actual uncapped E lottery
            expect(cfg).toBeDefined(); if (!cfg) throw Error('CE staff missing from final W-26 catalog');
            expect([cfg.flavorIndex,cfg.frequency,cfg.marketValue,ItemLoader.kindPolarity(id)]).toEqual([r[2],r[3],r[4],r[9]].map(Number));
            const bolt=getBoltForItem(id)!; expect(bolt.ceType).toBe(CEBoltType[r[5] as keyof typeof CEBoltType]);
            expect(BOLT_EFFECT_CE_EFFECT[bolt.effect]).toBe(CE_BOLT_CATALOG[bolt.ceType!].effect);
            expect(ItemLoader.arcanaFlavorMap.get(id)).toBe((ItemLoader as any).staffFlavorSlots[Number(r[2])]);
        });
        expect(ItemLoader.staffs.find(s=>s.id==='staff_of_light')!.excludeFromGeneration).toBe(true);
        expect(ItemLoader.spawnStaff('staff_of_light',0,0)).not.toBeNull();
    });
    it('all 110 tickets follow the CE row intervals through the real kind selector', () => {
        const g:any=Object.create(Game.prototype), draw=vi.spyOn(rng,'randRange');
        const expected=ids.flatMap((id,i)=>Array(weights[i]).fill(id));
        for(let ticket=1;ticket<=110;ticket++) {
            draw.mockReturnValueOnce(ticket);
            expect(g.chooseKindFromPool(ids,weights,new Map())).toBe(expected[ticket-1]);
        }
        expect(draw.mock.calls).toEqual(Array.from({length:110},()=>[1,110]));
    });
    it('64 seeds × 1000 real kind/instance draws: 12 kinds, weighted frequency, uncapped E, per-item exact RNG', () => {
        const g:any=Object.create(Game.prototype), counts=ids.map(()=>0), charges=ids.map(()=>({} as Record<number,number>));let calls=0,sumE=0;
        for(let seed=1;seed<=64;seed++) {
            rng.seedRandomGenerator(seed*7919);
            for(let n=0;n<1000;n++) {
                const before=rng.randomNumbersGenerated;
                const id=g.chooseKindFromPool(ItemLoader.genStaffs.map(s=>s.id),ItemLoader.genStaffs.map(s=>s.frequency),new Map());
                const item=g.spawnKindById(ItemCategory.STAFF,id,{x:3,y:4},1), i=ids.indexOf(id), e=item.enchantment;
                expect(i).toBeGreaterThanOrEqual(0);counts[i]!++;charges[i]![e]=(charges[i]![e]??0)+1;
                expect([item.charges,item.maxCharges,item.arcanaInstanceVersion]).toEqual([e,e,1]);
                expect(item.staffRechargeRemaining).toBe(['staff_of_blinking','staff_of_obstruction'].includes(id)?1000:500);
                expect(rng.randomNumbersGenerated-before).toBe(e);sumE+=e;
            }
            calls+=rng.randomNumbersGenerated;
        }
        ids.forEach((id,i)=>{
            const p=weights[i]!/110;expect(Math.abs(counts[i]!-64000*p),id).toBeLessThan(6*Math.sqrt(64000*p*(1-p)));
            for(const [e,q] of [[2,.5],[3,.425],[4,.0675],[5,.00675],[6,.00075]]) {
                const observed=Object.entries(charges[i]!).filter(([k])=>e===6?Number(k)>=6:Number(k)===e).reduce((a,[,n])=>a+n,0);
                expect(Math.abs(observed-counts[i]!*q!),id+' E'+e).toBeLessThanOrEqual(6*Math.sqrt(counts[i]!*q!*(1-q!)));
            }
        });
        expect(calls).toBe(sumE);
        if(process.env.W26_EVIDENCE)fs.writeFileSync('ai_docs/reports/w-26-evidence/distribution.json',JSON.stringify({seeds:64,samples:64000,calls,kinds:ids.map((id,i)=>({id,weight:weights[i],count:counts[i],charges:charges[i]}))},null,2)+'\n');
    });
    it.each(ids)('%s: unknown appearance, polarity, discovery and full identification', id=>{
        const item=ItemLoader.spawnStaff(id,-1,-1)!;const p=['staff_of_healing','staff_of_haste','staff_of_protection'].includes(id)?-1:1;
        expect(item.displayName).not.toContain(item.name);expect(ItemLoader.itemMagicPolarity(item)).toBe(p);
        expect(ItemLoader.magicCharDiscoverySuffix(item)).toBe(p);ItemLoader.detectMagicOnItem(item);
        expect(ItemLoader.identifiedItems.has(id)).toBe(false);ItemLoader.identifyInstance(item);
        expect(item.displayName).toContain(item.name);item.charges=0;
        expect(ItemLoader.itemMagicPolarity(item)).toBe(p); // Staff magic persists when depleted.
    });
    it.each(added)('%s: real selection, cancel, confirmation, resource/time/autoID and actual effect', id=>{
        const {g,m}=scene();const item=ItemLoader.spawnStaff(id,-1,-1)!;
        Object.assign(item,{enchantment:3,maxCharges:3,charges:3});g.player.inventory.addItem(item);
        if(id==='staff_of_tunneling'){g.monsters=[];for(let x=6;x<=9;x++)g.grid.setTerrain(x,5,T.WALL);}
        if(id==='staff_of_blinking')g.monsters=[];
        const before=[item.charges,g.stats.turns,rng.randomNumbersGenerated];
        g.useArcanaItem(item);expect(g.pendingArcana?.item).toBe(item);g.setArcanaTarget(20,5);g.getArcanaPreview();g.cancelArcanaSelection();
        expect([item.charges,g.stats.turns,rng.randomNumbersGenerated]).toEqual(before);
        g.useArcanaItem(item);g.setArcanaTarget(20,5);const result=g.confirmArcanaTarget();
        expect(result?.outcome?.autoID).toBe(true);expect(item.charges).toBe(2);expect(g.stats.turns).toBe(before[1]!+1);expect(ItemLoader.identifiedItems.has(id)).toBe(true);
        if(id==='staff_of_blinking'){expect(g.player.loc).toEqual({x:12,y:5});expect(item.staffRechargeRemaining).toBe(990);}
        if(id==='staff_of_tunneling'){for(let x=6;x<=8;x++)expect(g.grid.getCell(x,5)!.layers[DungeonLayer.DUNGEON]).toBe(T.FLOOR);expect(g.grid.getCell(9,5)!.terrain).toBe(T.WALL);}
        if(id==='staff_of_entrancement'){expect(m.getStatusDuration('entranced')).toBe(8);expect(m.loc).toEqual({x:9,y:5});}
    });
    it('new positive kinds participate in elimination; known blink details expose distance only with capacity known',()=>{
        for (const last of added) {
            ItemLoader.identifiedItems.clear(); ItemLoader.magicPolarityRevealed.clear();
            ids.filter(id=>id!==last && ItemLoader.kindPolarity(id)===1).forEach(id=>ItemLoader.identifiedItems.add(id));
            ItemLoader.tryIdentifyLastItemKindsAllPolarityCategories();expect(ItemLoader.identifiedItems.has(last)).toBe(false);
            ItemLoader.magicPolarityRevealed.add(last);ItemLoader.tryIdentifyLastItemKindsAllPolarityCategories();expect(ItemLoader.identifiedItems.has(last)).toBe(true);
        }
        ItemLoader.identifiedItems.clear();const item=ItemLoader.spawnStaff('staff_of_blinking',0,0)!;item.enchantment=3;
        const text=()=>JSON.stringify(generateItemDetail(item,12));expect(text()).not.toContain('最多瞬移');expect(text()).not.toContain('一半');
        ItemLoader.identify('staff_of_blinking');expect(text()).toContain('一半');expect(text()).not.toContain('最多瞬移');
        // Capacity alone does not reveal actual enchantment; identify the instance first.
        item.maxChargesKnown=true;item.identified=true;expect(text()).toContain('最多瞬移 8 格（附魔后 10 格）');
    });
    it('known blink/tunnel aim at cells, entrancement targets eligible enemies; unknown kinds retain generic candidates',()=>{
        const {g,m}=scene();
        for(const id of added){
            const item=ItemLoader.spawnStaff(id,-1,-1)!;expect(g.getArcanaCandidates(item)).toContain(m);
            ItemLoader.identify(id);expect(g.getArcanaCandidates(item)).toEqual(id==='staff_of_entrancement'?[m]:[]);
        }
    });
    it('machine direct/category staff requests remain the explicit pre-existing null boundary, with zero RNG',()=>{
        const g:any=Object.create(Game.prototype),before=JSON.stringify(rng);
        for(const id of ids)expect(g.spawnBlueprintItem('STAFF',id,3,4,1)).toBeNull();
        expect(g.spawnBlueprintItem('STAFF',undefined,3,4,1)).toBeNull();expect(JSON.stringify(rng)).toBe(before);
    });
});

describe('W-25 blink resources and selection',()=>{
    it.each(['staff_of_blinking','staff_of_obstruction'])('%s: initial/reset/natural/enchantment CE exceptions',id=>{
        const item=ItemLoader.spawnStaff('staff_of_fire',-1,-1)!;Object.assign(item,{identityId:id,enchantment:3,maxCharges:3,charges:0,staffRechargeRemaining:undefined});
        const before=JSON.stringify(rng);expect(restoreStaffRecharge(undefined,id)).toBe(1000);expect(staffChargeDuration(item,id)).toBe(3333);
        rechargeStaffFully(item,id);expect([item.charges,item.staffRechargeRemaining]).toEqual([3,3333]);
        expect(enchantArcana(item)).toBe(true);expect([item.enchantment,item.charges,item.staffRechargeRemaining]).toEqual([4,4,125]);
        expect(JSON.stringify(rng)).toBe(before);
        item.charges=0;item.staffRechargeRemaining=10;const roll=vi.spyOn(rng,'randClumpedRange').mockReturnValue(2000);
        tickStaffRecharge(item,0,rng,id);expect(item.charges).toBe(1);expect(roll).toHaveBeenCalledExactlyOnceWith(833,4166,3);
        expect(item.staffRechargeRemaining).toBe(2000);
    });
    it.each([2,3,8])('E%s: known-capacity preview and actual travel; remote cursor allowed, cancel zero consumption',e=>{
        const {g}=scene();g.monsters=[];const item=ItemLoader.spawnStaff('staff_of_blinking',-1,-1)!;
        Object.assign(item,{enchantment:e,maxCharges:e,charges:e});g.player.inventory.addItem(item);ItemLoader.identify('staff_of_blinking');
        g.useArcanaItem(item);g.setArcanaTarget(30,5);const before=JSON.stringify(rng);
        expect(g.getArcanaPreview()?.maxDistance).toBeNull();const unknownLength=g.getArcanaPreview()!.path.length;
        item.maxChargesKnown=true;expect(g.getArcanaPreview()?.maxDistance).toBe(2+2*e);expect(g.getArcanaPreview()!.path).toHaveLength(2+2*e);
        expect(unknownLength).toBeGreaterThan(2+2*e);expect(g.pendingArcana!.cursor.x).toBe(30);expect(JSON.stringify(rng)).toBe(before);
        g.confirmArcanaTarget();expect(g.player.loc.x).toBe(6+2*e);
    });
    it('known lethal landing refuses before charge/time/RNG; fire immunity permits existing effect',()=>{
        const {g}=scene();g.monsters=[];const item=ItemLoader.spawnStaff('staff_of_blinking',-1,-1)!;
        Object.assign(item,{enchantment:2,maxCharges:2,charges:2});ItemLoader.identifyInstance(item);g.player.inventory.addItem(item);g.grid.setTerrain(10,5,T.LAVA);
        const before=[item.charges,g.stats.turns,rng.randomNumbersGenerated];g.useArcanaItem(item);g.setArcanaTarget(25,5);
        expect(g.getArcanaPreview()?.risk).toBe('certain');expect(g.confirmArcanaTarget()).toBeNull();expect(g.pendingArcana).toBeNull();
        expect([item.charges,g.stats.turns,rng.randomNumbersGenerated]).toEqual(before);
        g.player.setStatusDuration('immune_fire',20);g.useArcanaItem(item);g.setArcanaTarget(25,5);expect(g.confirmArcanaTarget()).not.toBeNull();expect(g.player.loc.x).toBe(10);
    });
    it('real blink scroll resets 10000/E; absent timer uses 1000 and full timer freezes',()=>{
        const {g}=scene();const item=ItemLoader.spawnStaff('staff_of_blinking',-1,-1)!;Object.assign(item,{enchantment:3,maxCharges:3,charges:0});g.player.inventory.addItem(item);
        const before=JSON.stringify(rng);(g as any).rechargeStaffsAndCharms();expect([item.charges,item.staffRechargeRemaining]).toEqual([3,3333]);
        expect(JSON.stringify(rng)).toBe(before);(g as any).tickArcanaResources();expect(item.staffRechargeRemaining).toBe(3333);
    });
    it('known kind/unknown range prompts; rejecting cancels, hidden kind never reveals lava risk or E',()=>{
        const {g}=scene();g.monsters=[];const item=ItemLoader.spawnStaff('staff_of_blinking',-1,-1)!;
        g.player.inventory.addItem(item);g.grid.setTerrain(10,5,T.LAVA);g.useArcanaItem(item);g.setArcanaTarget(25,5);
        expect(g.getArcanaPreview()).toEqual({maxDistance:null,risk:'none',path:[]});ItemLoader.identify('staff_of_blinking');
        expect(g.getArcanaPreview()?.risk).toBe('possible');g.onConfirmRequest=vi.fn(()=>false);const before=[item.charges,g.stats.turns,rng.randomNumbersGenerated];
        expect(g.confirmArcanaTarget()).toBeNull();expect(g.onConfirmRequest).toHaveBeenCalledOnce();expect([item.charges,g.stats.turns,rng.randomNumbersGenerated]).toEqual(before);
    });
});

describe('W-25 staff appearance/save migration',()=>{
    it('real old seven-row mapping, empty charges/calls/known sets and timer survive load without spawn',()=>{
        const {g}=scene(),current=ItemLoader.staffs;let legacy:Record<string,string>,saved:ReturnType<Game['toSnapshot']>;
        try{
            // Old configs had no explicit wood indices. Light also used ordinary index 6.
            ItemLoader.staffs=oldIds.map(id=>({...current.find(s=>s.id===id)!,flavorIndex:oldIds.indexOf(id)}));
            rng.seedRandomGenerator(g.currentSeed);ItemLoader.initConsumables();legacy=Object.fromEntries(ItemLoader.arcanaFlavorMap);
            const item=ItemLoader.spawnStaff('staff_of_fire',-1,-1)!;item.charges=0;item.staffRechargeRemaining=1234;g.player.inventory.addItem(item);
            ItemLoader.identify('staff_of_fire');ItemLoader.callKind('staff_of_haste','old haste');ItemLoader.magicPolarityRevealed.add('staff_of_poison');
            saved=JSON.parse(JSON.stringify(g.toSnapshot()));delete saved.staffFlavors;
        }finally{ItemLoader.staffs=current;}
        const spawn=vi.spyOn(ItemLoader,'spawnStaff');expect(g.loadSnapshot(saved)).toBe(true);expect(spawn).not.toHaveBeenCalled();
        for(const id of oldIds)expect(ItemLoader.arcanaFlavorMap.get(id)).toBe(legacy[id]);
        for(const id of added)expect(ItemLoader.identifiedItems.has(id)).toBe(false);
        expect([g.player.inventory.items[0]!.charges,g.player.inventory.items[0]!.staffRechargeRemaining]).toEqual([0,1234]);
        expect(ItemLoader.callTitles.get('staff_of_haste')).toBe('old haste');expect(ItemLoader.isPolarityRevealed('staff_of_poison')).toBe(true);
        expect(new Set(current.map(s=>ItemLoader.arcanaFlavorMap.get(s.id))).size).toBe(13);
        const upgraded=JSON.parse(JSON.stringify(g.toSnapshot()));g.loadSnapshot(upgraded);expect(g.toSnapshot().staffFlavors).toEqual(upgraded.staffFlavors);
    });
    it('new maps, partial maps and current blink timer are deterministic',()=>{
        const {g}=scene();g.player.inventory.addItem(ItemLoader.spawnStaff('staff_of_blinking',-1,-1)!);
        const saved=JSON.parse(JSON.stringify(g.toSnapshot()));
        expect(g.loadSnapshot(saved)).toBe(true);expect(g.toSnapshot().staffFlavors).toEqual(saved.staffFlavors);expect(g.player.inventory.items[0]!.staffRechargeRemaining).toBe(1000);
        const before=JSON.stringify(rng);ItemLoader.restoreStaffFlavors({staff_of_blinking:saved.staffFlavors.staff_of_blinking});
        expect(new Set(ItemLoader.staffs.map(s=>ItemLoader.arcanaFlavorMap.get(s.id))).size).toBe(13);expect(JSON.stringify(rng)).toBe(before);
    });
});
