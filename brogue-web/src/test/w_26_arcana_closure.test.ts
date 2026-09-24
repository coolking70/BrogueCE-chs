import fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Game } from '../engine/Core/Game';
import { Grid, DungeonLayer as L, TerrainType as T, DCOLS, DROWS } from '../engine/Map/Grid';
import { EnvironmentManager } from '../engine/Environment/Gas';
import { FOVSys } from '../engine/Lighting/FOV';
import { LightMap } from '../engine/Lighting/LightMap';
import { ItemLoader } from '../engine/Items/ItemLoader';
import { enchantArcana } from '../engine/Items/ArcanaEnchantment';
import { staffChargeDuration, restoreStaffRecharge } from '../engine/Items/ArcanaRecharge';
import { getBoltForItem } from '../engine/Combat/Bolt';
import { Monster, MonsterState, type MonsterData } from '../entities/Monster';
import { rng } from '../engine/Random';
import monsters from '../data/monsters.json';
import { createHeadlessGame } from './harness';

const staffs = 'lightning fire poison tunneling blinking entrancement obstruction discord conjuration healing haste protection'.split(' ').map(s=>'staff_of_'+s);
const wands = 'teleportation slowness polymorphism negation domination beckoning plenty invisibility empowerment'.split(' ').map(s=>'wand_of_'+s);
const ids = [...wands,...staffs];
const added = ['staff_of_obstruction','staff_of_discord','staff_of_protection'];
const allies = ['wand_of_plenty','wand_of_invisibility','wand_of_empowerment','staff_of_healing','staff_of_haste','staff_of_protection'];
const cells = ['staff_of_tunneling','staff_of_blinking','staff_of_obstruction'];
const make = (id:string) => (id.startsWith('staff')?ItemLoader.spawnStaff:ItemLoader.spawnWand).call(ItemLoader,id,-1,-1)!;
const audit: unknown[] = [];
beforeEach(()=>{rng.seedRandomGenerator(2626);ItemLoader.initConsumables();});
afterEach(()=>vi.restoreAllMocks());
function scene() {
    const g = createHeadlessGame(2626,'test');
    g.grid = new Grid(DCOLS,DROWS);
    for(let x=0;x<DCOLS;x++)for(let y=0;y<DROWS;y++){
        g.grid.setTerrain(x,y,x>0&&x<DCOLS-1&&y>0&&y<DROWS-1?T.FLOOR:T.WALL);
        Object.assign(g.grid.getCell(x,y)!,{isVisible:true,hasMemory:true,isDiscovered:true});
    }
    g.player.loc={x:4,y:5};g.player.hp=g.player.maxHp=100;
    g.monsters=[];g.items=[];g.dormantMonsters=[];g.player.inventory.items=[];
    g.player.equippedWeapon=g.player.equippedArmor=g.player.ringLeft=g.player.ringRight=null;
    g.environment=new EnvironmentManager(g.grid);g.fov=new FOVSys(g.grid);g.lightMap=new LightMap(g.grid);
    const m = new Monster(9,5,(monsters as MonsterData[]).find(d=>d.id==='rat')!);
    m.hp=m.maxHp=100;m.state=MonsterState.HUNTING;m.ticksUntilTurn=100000;g.monsters=[m];
    return {g,m};
}

describe('W-26 all 21 real useArcana entries',()=>{
    it.each(ids)('%s: unknown selection/cancel, one commit, real effect, outcome-based identification',id=>{
        const {g,m}=scene(),item=make(id),staff=id.startsWith('staff');
        if(staff)Object.assign(item,{enchantment:3,maxCharges:3,charges:3});
        g.player.inventory.addItem(item);
        if(allies.includes(id))m.isAlly=true;
        if(id==='staff_of_healing')m.hp=50;
        if(id==='wand_of_domination')m.hp=1;
        if(id==='wand_of_plenty')m.hp=51;
        if(id==='wand_of_negation'){m.setStatusDuration('hasted',20);m.abilityFlags.add('MA_CAUSES_WEAKNESS');}
        if(id==='wand_of_teleportation')for(let y=1;y<DROWS-1;y++)g.grid.setTerrain(25,y,T.WALL);
        if(id==='staff_of_blinking'||id==='staff_of_tunneling'||id==='staff_of_conjuration')g.monsters=[];
        if(id==='staff_of_tunneling')for(let x=6;x<=9;x++)g.grid.setTerrain(x,5,T.WALL);
        if(id==='staff_of_conjuration')g.grid.setTerrain(15,5,T.WALL);
        const before={charges:item.charges!,turns:g.stats.turns,rng:JSON.stringify(rng),hp:m.hp,loc:{...m.loc},type:m.typeId};
        expect(ItemLoader.identifiedItems.has(id)).toBe(false);
        g.useArcanaItem(item);expect(g.pendingArcana?.item).toBe(item);
        g.setArcanaTarget(20,5);g.getArcanaCandidates(item);g.getArcanaPreview();g.cancelArcanaSelection();
        expect([item.charges,g.stats.turns,JSON.stringify(rng)]).toEqual([before.charges,before.turns,before.rng]);
        g.useArcanaItem(item);g.setArcanaTarget(20,5);const result=g.confirmArcanaTarget();
        expect(result).not.toBeNull();expect(g.pendingArcana).toBeNull();
        expect(item.charges).toBe(before.charges-1);expect(g.stats.turns).toBe(before.turns+1);
        const autoID=id==='wand_of_teleportation'?false:id==='wand_of_polymorphism'?!m.hasStatus('invisible'):true;
        expect(result!.outcome?.autoID).toBe(autoID);expect(ItemLoader.identifiedItems.has(id)).toBe(autoID);
        if(!staff)expect(item.timesUsed).toBe(1);
        switch(id){
            case 'wand_of_teleportation':expect(m.loc).not.toEqual(before.loc);expect(g.grid.getCell(m.x,m.y)!.isPassable).toBe(true);break;
            case 'wand_of_slowness':expect(m.getStatusDuration('slowed')).toBe(49);break;
            case 'wand_of_polymorphism':expect(m.typeId).not.toBe(before.type);expect(g.monsters).toContain(m);break;
            case 'wand_of_negation':expect(m.wasNegated).toBe(true);expect(m.getStatusDuration('hasted')).toBe(0);break;
            case 'wand_of_domination':expect(m.isAlly&&m.dominated).toBe(true);break;
            case 'wand_of_beckoning':expect(m.loc).toEqual({x:5,y:5});break;
            case 'wand_of_plenty':expect(g.monsters).toHaveLength(2);expect(g.monsters.map(x=>x.hp)).toEqual([26,26]);break;
            case 'wand_of_invisibility':expect(m.getStatusDuration('invisible')).toBe(149);break;
            case 'wand_of_empowerment':expect([m.hp,m.maxHp,m.newPowerCount,m.totalPowerCount]).toEqual([112,112,1,1]);break;
            case 'staff_of_lightning':case 'staff_of_fire':expect(m.hp).toBeLessThan(before.hp);break;
            case 'staff_of_poison':expect(m.poisonAmount).toBe(1);expect(m.getStatusDuration('poisoned')).toBeGreaterThan(0);expect(m.hp).toBe(99);break;
            case 'staff_of_tunneling':for(let x=6;x<=8;x++)expect(g.grid.getCell(x,5)!.layers[L.DUNGEON]).toBe(T.FLOOR);expect(g.grid.getCell(9,5)!.terrain).toBe(T.WALL);break;
            case 'staff_of_blinking':expect(g.player.loc).toEqual({x:12,y:5});break;
            case 'staff_of_entrancement':expect(m.getStatusDuration('entranced')).toBe(8);break;
            case 'staff_of_obstruction':expect(result!.landingPos).toEqual({x:8,y:5});expect(g.grid.getCell(8,5)!.layers[L.SURFACE]).toBe(T.FORCEFIELD);expect(g.grid.getCell(8,5)!.isPassable).toBe(false);expect(m.hp).toBe(before.hp);break;
            case 'staff_of_discord':expect(m.getStatusDuration('discordant')).toBe(11);expect(m.hasStatus('confused')).toBe(false);break;
            case 'staff_of_conjuration':expect(g.monsters).toHaveLength(4);expect(g.monsters.every(x=>x.typeId==='spectral_blade'&&x.isAlly&&x.boundToPlayer)).toBe(true);break;
            case 'staff_of_healing':expect(m.hp).toBe(80);break;
            case 'staff_of_haste':expect(m.getStatusDuration('hasted')).toBe(13);break;
            case 'staff_of_protection':expect([m.getStatusDuration('shielded'),m.maxShield]).toEqual([172,181]);m.takeDamage(5);expect(m.hp).toBe(100);expect(m.getStatusDuration('shielded')).toBe(122);expect(g.player.hasStatus('telepathy')).toBe(false);break;
        }
        const committed=[item.charges,g.stats.turns,JSON.stringify(rng)];expect(g.confirmArcanaTarget()).toBeNull();expect([item.charges,g.stats.turns,JSON.stringify(rng)]).toEqual(committed);
        audit.push({id,ceType:getBoltForItem(id)!.ceType,autoID,charges:item.charges,turnDelta:g.stats.turns-before.turns,hp:m.hp,loc:m.loc,statuses:m.statusDurations,entities:g.monsters.length});
        if(process.env.W26_EVIDENCE)fs.writeFileSync('ai_docs/reports/w-26-evidence/entry-audit.json',JSON.stringify(audit,null,2)+'\n');
    });
    it.each(ids)('%s: known target direction, unknown polarity fallback and manual cells',id=>{
        const {g,m}=scene(),item=make(id);
        m.hp=1;m.setStatusDuration('hasted',20);
        const ally=new Monster(8,7,(monsters as MonsterData[]).find(d=>d.id==='rat')!);ally.isAlly=true;ally.hp=1;g.monsters.push(ally);
        const before=JSON.stringify(rng);
        expect(g.getArcanaCandidates(item)).toEqual([m]);
        ItemLoader.detectMagicOnItem(item);expect(g.getArcanaCandidates(item)).toEqual(allies.includes(id)?[ally]:[m]);
        ItemLoader.identify(id);expect(g.getArcanaCandidates(item)).toEqual(cells.includes(id)?[]:allies.includes(id)?[ally]:[m]);
        g.player.inventory.addItem(item);g.useArcanaItem(item);expect(g.pendingArcana?.cursor).toEqual(cells.includes(id)?g.player.loc:allies.includes(id)?ally.loc:m.loc);
        expect(g.setArcanaTarget(20,8)).toBe(true);g.cancelArcanaSelection();expect(JSON.stringify(rng)).toBe(before);
    });
});

describe('W-26 new staff integration',()=>{
    it('obstruction actual identity: initial1000, inventory natural timer/clump, full freeze, scroll10000/E, enchant500/E',()=>{
        const {g}=scene(),item=make('staff_of_obstruction');g.player.inventory.addItem(item);
        expect(item.staffRechargeRemaining).toBe(1000);Object.assign(item,{enchantment:3,maxCharges:3,charges:0});
        expect(staffChargeDuration(item,'staff_of_obstruction')).toBe(3333);
        const before=JSON.stringify(rng);(g as any).tickArcanaResources();expect(item.staffRechargeRemaining).toBe(990);expect(JSON.stringify(rng)).toBe(before);
        item.staffRechargeRemaining=10;const roll=vi.spyOn(rng,'randClumpedRange').mockReturnValue(3333);
        (g as any).tickArcanaResources();expect(roll).toHaveBeenCalledExactlyOnceWith(1111,5555,3);expect([item.charges,item.staffRechargeRemaining]).toEqual([1,3333]);roll.mockRestore();
        const reset=JSON.stringify(rng);(g as any).rechargeStaffsAndCharms();expect([item.charges,item.staffRechargeRemaining]).toEqual([3,3333]);
        (g as any).tickArcanaResources();expect(item.staffRechargeRemaining).toBe(3333);
        expect(enchantArcana(item)).toBe(true);expect([item.enchantment,item.charges,item.staffRechargeRemaining]).toEqual([4,4,125]);expect(JSON.stringify(rng)).toBe(reset);
        expect(restoreStaffRecharge(undefined,'staff_of_obstruction')).toBe(1000);
    });
    it('obstruction has no blink risk confirmation; discord/protection reject inanimate automatic candidates',()=>{
        const {g,m}=scene(),obstruction=make('staff_of_obstruction');g.player.inventory.addItem(obstruction);ItemLoader.identifyInstance(obstruction);
        g.onConfirmRequest=vi.fn(()=>false);g.grid.setTerrain(8,5,T.LAVA);g.useArcanaItem(obstruction);g.setArcanaTarget(20,5);
        expect(g.getArcanaPreview()).toBeNull();expect(g.confirmArcanaTarget()).not.toBeNull();expect(g.onConfirmRequest).not.toHaveBeenCalled();
        for(const id of ['staff_of_discord','staff_of_protection']){
            const s=scene(),item=make(id);s.m.isAlly=id==='staff_of_protection';s.m.behaviorFlags.add('MONST_INANIMATE');ItemLoader.identify(id);expect(s.g.getArcanaCandidates(item)).toEqual([]);
        }
        expect(m.hp).toBe(100);
    });
    it.each(added)('%s participates in its CE polarity elimination group without revealing other kinds',id=>{
        ItemLoader.genStaffs.filter(s=>s.id!==id&&ItemLoader.kindPolarity(s.id)===ItemLoader.kindPolarity(id)).forEach(s=>ItemLoader.identify(s.id));
        ItemLoader.tryIdentifyLastItemKindsAllPolarityCategories();expect(ItemLoader.identifiedItems.has(id)).toBe(false);
        ItemLoader.magicPolarityRevealed.add(id);ItemLoader.tryIdentifyLastItemKindsAllPolarityCategories();expect(ItemLoader.identifiedItems.has(id)).toBe(true);
    });
    it('W-25 saved flavors/calls/empty staff survive real load; fill three missing slots without RNG',()=>{
        const {g}=scene(),current=ItemLoader.staffs;
        let saved:ReturnType<Game['toSnapshot']>;
        try{
            ItemLoader.staffs=current.filter(s=>!added.includes(s.id));rng.seedRandomGenerator(g.currentSeed);ItemLoader.initConsumables();
            const item=make('staff_of_blinking');item.charges=0;item.staffRechargeRemaining=1234;g.player.inventory.addItem(item);
            ItemLoader.identify('staff_of_blinking');ItemLoader.callKind('staff_of_haste','old haste');ItemLoader.magicPolarityRevealed.add('staff_of_poison');
            saved=JSON.parse(JSON.stringify(g.toSnapshot()));
        }finally{ItemLoader.staffs=current;}
        const spawn=vi.spyOn(ItemLoader,'spawnStaff');expect(g.loadSnapshot(saved)).toBe(true);expect(spawn).not.toHaveBeenCalled();
        for(const [id,flavor]of Object.entries(saved.staffFlavors!))expect(ItemLoader.arcanaFlavorMap.get(id)).toBe(flavor);
        expect([g.player.inventory.items[0]!.charges,g.player.inventory.items[0]!.staffRechargeRemaining]).toEqual([0,1234]);
        expect(ItemLoader.callTitles.get('staff_of_haste')).toBe('old haste');expect(ItemLoader.isPolarityRevealed('staff_of_poison')).toBe(true);
        for(const id of added)expect(ItemLoader.identifiedItems.has(id)).toBe(false);
        const before=JSON.stringify(rng);ItemLoader.restoreStaffFlavors(saved.staffFlavors);expect(JSON.stringify(rng)).toBe(before);
        expect(new Set(current.map(s=>ItemLoader.arcanaFlavorMap.get(s.id))).size).toBe(13);
        const upgraded=JSON.parse(JSON.stringify(g.toSnapshot()));expect(g.loadSnapshot(upgraded)).toBe(true);expect(g.toSnapshot().staffFlavors).toEqual(upgraded.staffFlavors);
    });
    it('new identities round-trip independently; old missing E/capacity/timer deterministic fallback',()=>{
        const {g}=scene();for(const id of added){const item=make(id);Object.assign(item,{enchantment:8,maxCharges:8,charges:0,staffRechargeRemaining:1234,maxChargesKnown:true});g.player.inventory.addItem(item);}
        const saved=JSON.parse(JSON.stringify(g.toSnapshot()));expect(g.loadSnapshot(saved)).toBe(true);expect(g.toSnapshot().staffFlavors).toEqual(saved.staffFlavors);
        expect(g.player.inventory.items.map(i=>[i.enchantment,i.maxCharges,i.charges,i.staffRechargeRemaining,i.maxChargesKnown])).toEqual(added.map(()=>[8,8,0,1234,true]));
        const before=JSON.stringify(rng);
        for(const s of saved.player.inventory){delete s.arcanaInstanceVersion;delete s.maxCharges;delete s.staffRechargeRemaining;s.enchantment=0;const item=(g as any).deserializeItem(s);expect([item.enchantment,item.maxCharges,item.charges,item.staffRechargeRemaining]).toEqual([2,2,0,s.identityId==='staff_of_obstruction'?1000:500]);}
        expect(JSON.stringify(rng)).toBe(before);
    });
});
