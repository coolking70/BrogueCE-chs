import {afterEach, describe, expect, it, vi} from 'vitest';
import fs from 'node:fs';
import {ItemLoader} from '../engine/Items/ItemLoader';
import {Item, ItemCategory as C} from '../engine/Items/Item';
import {rng} from '../engine/Random';
import {Player} from '../entities/Player';
import {Monster, MonsterState, type MonsterData} from '../entities/Monster';
import monsters from '../data/monsters.json';
import {CombatSystem} from '../engine/Combat/Combat';
import {ringBonus, ringLightMultiplier} from '../engine/Items/RingBonuses';
import {rechargeItemsIncrementally, tickStaffRecharge} from '../engine/Items/ArcanaRecharge';
import {charmRechargeDelay} from '../engine/Items/CharmModel';
import {minersLightBaseRadiusFixpt, updateMinersLightRadius} from '../engine/Map/LightCatalog';
import {generateItemDetail} from '../engine/UI/DetailGenerator';
import {serializeItem, deserializeItem} from '../engine/Core/EntitySnapshot';
import {createHeadlessGame} from './harness';
import {TerrainType as T} from '../engine/Map/Grid';
import {logger} from '../engine/Systems/Logger';
const golden=JSON.parse(fs.readFileSync('ai_docs/reports/u-15b2-evidence/ce-golden.json','utf8'));
afterEach(()=>vi.restoreAllMocks());
function ring(kind:string,e:number,identified=true){
    return Object.assign(new Item(kind,'=',0,C.RING),{identityId:'ring_of_'+kind,enchantment:e,identified,timesEnchanted:0,charges:1500});
}
function staff(e=3,charges=0,remaining=500,id='staff_of_lightning'){
    return Object.assign(new Item('staff','\\',0,C.STAFF),{identityId:id,enchantment:e,maxCharges:e,charges,staffRechargeRemaining:remaining});
}
function charm(remaining=20){
    return Object.assign(new Item('charm','*',0,C.CHARM),{identityId:'charm_of_health',enchantment:1,cooldownRemaining:remaining});
}
function fighter(e=2,identified=true){
    const p=new Player(5,5);p.ringLeft=ring('reaping',e,identified);
    const s=staff(),c=charm();p.inventory.items=[p.ringLeft,s,c];
    p.equippedWeapon=Object.assign(new Item('test blade',')',0,C.WEAPON),{damage:'10d1',enchantment:0,strengthRequired:12});
    const m=new Monster(6,5,(monsters as MonsterData[]).find(m=>m.id==='rat')!);
    m.hp=m.maxHp=4;m.state=MonsterState.HUNTING;m.applyShield(1000);
    return {p,m,s,c};
}

describe('U15b2 ordinary and machine birth / full CE ringTable',()=>{
    it('matches all eight CE ringTable names, order, frequency and unfiltered kind draw',()=>{
        const ce=fs.readFileSync('../BrogueCE-master/src/brogue/Globals.c','utf8').split('itemTable ringTable[NUMBER_RING_KINDS] = {')[1]!.split('\n};')[0]!;
        const rows=[...ce.matchAll(/\{"(\w+)",\s+itemGems\[\d+\], "",\s+(\d+)/g)].map(m=>['ring_of_'+m[1],Number(m[2])]);
        expect(rows).toHaveLength(8);
        expect(ItemLoader.rings.map(r=>[r.id,r.frequency])).toEqual(rows);
        expect(ItemLoader.genRings.map(r=>[r.id,r.frequency])).toEqual(rows);
        const roll=vi.spyOn(rng,'randRange');
        for(let n=1;n<=8;n++){roll.mockReturnValueOnce(n);expect(ItemLoader.chooseKind(rows.map(r=>r[1] as number))).toBe(n-1);}
        expect(roll.mock.calls).toEqual(Array.from({length:8},()=>[1,8]));
    });
    it('ordinary birth draws 1..3 once, then 16% curse OR an uncapped 10% tail',()=>{
        const clump=vi.spyOn(rng,'randClumpedRange').mockReturnValue(3);
        const pct=vi.spyOn(rng,'randPercent').mockReturnValueOnce(true);
        const cursed=ItemLoader.spawnRing('ring_of_light',7,8)!;
        expect([cursed.enchantment,cursed.isCursed,cursed.charges,cursed.timesEnchanted,cursed.identified]).toEqual([-3,true,1500,0,false]);
        expect(clump.mock.calls).toEqual([[1,3,1]]);expect(pct.mock.calls).toEqual([[16]]);
        pct.mockReset().mockReturnValueOnce(false);
        for(let n=0;n<20;n++)pct.mockReturnValueOnce(true);pct.mockReturnValueOnce(false);
        const positive=ItemLoader.spawnRing('ring_of_reaping',7,8)!;
        expect([positive.enchantment,positive.isCursed]).toEqual([23,false]);
        expect(pct.mock.calls).toEqual([[16],...Array.from({length:21},()=>[10])]);
        expect(positive.loc).toEqual({x:7,y:8});
    });
    it('ordinary and machine paths give the same resource fields and exact RNG state for 80 seeds',()=>{
        for(let seed=1;seed<=80;seed++)for(const {id} of ItemLoader.genRings){
            rng.seedRandomGenerator(seed);const start=rng.getState(),a=ItemLoader.spawnRing(id,1,2)!,end=rng.getState();
            rng.setState(start);const b=ItemLoader.spawnMachineRing(id,1,2)!;
            const resource=(i:Item)=>[i.identityId,i.enchantment,i.isCursed,i.charges,i.identified,i.timesEnchanted];
            expect(resource(b)).toEqual(resource(a));expect(rng.getState()).toEqual(end);
        }
        const before=rng.getState();expect(ItemLoader.spawnRing('missing',0,0)).toBeNull();expect(rng.getState()).toEqual(before);
    });
    it('birth E, curse, familiarity and known state survive the U01 codec without rerolling',()=>{
        rng.seedRandomGenerator(42);
        for(const {id} of ItemLoader.rings){
            const a=ItemLoader.spawnRing(id,2,3)!;a.timesEnchanted=2;a.charges=704;
            const snapshot=serializeItem(a),before=rng.getState(),b=deserializeItem(JSON.parse(JSON.stringify(snapshot)));
            expect(serializeItem(b)).toEqual(snapshot);expect(rng.getState()).toEqual(before);
        }
    });
});

describe('U15b2 light equipment -> CE fixed point -> visibility',()=>{
    it('sums effective E and skips zero, with independent unknown positive caps',()=>{
        expect(ringLightMultiplier([])).toBe(1);
        const a=ring('light',4,false),b=ring('light',-2,false);
        expect(ringLightMultiplier([a])).toBe(2);expect(ringLightMultiplier([a,b])).toBe(-1);
        a.timesEnchanted=1;expect(ringLightMultiplier([a,b])).toBe(1);
        a.identified=true;expect(ringLightMultiplier([a,b])).toBe(3);
        expect(ringLightMultiplier([ring('light',-3)])).toBe(-3);
    });
    it('matches 144 compiled original CE light cases including darkness and water truncation',()=>{
        for(const [base,lm,dark,water,radius,fade] of golden.light){
            expect(updateMinersLightRadius(base,{lightMultiplier:lm,darknessStatus:dark,darknessMax:20,inWater:water}),JSON.stringify([base,lm,dark,water]))
                .toEqual({radiusHundredths:radius,radialFadeToPercent:fade});
        }
    });
    it('refreshes actual Game light on equip/unequip, kind-only identification and load',()=>{
        const g=createHeadlessGame(1532,'test'),api=g as any;g.depth=26;api.generateDepth(false,false);g.monsters=[];
        for(let x=2;x<50;x++)for(let y=2;y<29;y++)g.grid.setTerrain(x,y,T.FLOOR);
        g.player.loc={x:20,y:15};api.updateVision();const before=api.minersLight;
        const a=ring('light',3,false);g.player.inventory.addItem(a);g.equipItem(a);
        expect(ItemLoader.identifiedItems.has(a.identityId!)).toBe(true);expect(a.identified).toBe(false);
        expect(generateItemDetail(a,12).sections.flatMap(s=>s.lines.map(l=>l.text)).join(' ')).toContain('看得更远');
        expect(api.minersLight).toEqual(updateMinersLightRadius(minersLightBaseRadiusFixpt(26),{lightMultiplier:2}));
        expect(api.minersLight.radiusHundredths).toBeGreaterThan(before.radiusHundredths);
        // Mineral light never enters the monster-facing light snapshot.
        const stealth=api.calculateStealthRange();g.unequipItem(a);expect(api.calculateStealthRange()).toBe(stealth);
        expect(api.minersLight).toEqual(before);
        g.equipItem(a);const snapshot=g.toSnapshot();expect(g.loadSnapshot(snapshot)).toBe(true);api.updateVision();
        expect(g.player.ringLeft?.enchantment).toBe(3);expect(api.minersLight.radiusHundredths).toBeGreaterThan(before.radiusHundredths);
    });
});

describe('U15b2 reaping melee -> shared staff/charm resource units',()=>{
    it('matches 1944 original CE staff cases: negative/zero/positive, capacity and signed-short overflow',()=>{
        for(const [kind,wis,mul,charges,timer,after,remaining,calls,lo,hi] of golden.recharge){
            const id=['staff_of_lightning','staff_of_blinking','staff_of_obstruction'][kind]!;
            const a=staff(3,charges,timer,id),roll=vi.fn((l:number,h:number,_c:number)=>Math.trunc((l+h)/2));
            tickStaffRecharge(a,wis,{randClumpedRange:roll},id,mul);
            expect([a.charges,a.staffRechargeRemaining,roll.mock.calls.length],JSON.stringify([kind,wis,mul,charges,timer])).toEqual([after,remaining,calls]);
            if(calls)expect(roll.mock.calls[roll.mock.calls.length - 1]).toEqual([lo,hi,3]);
        }
    });
    it.each([2,-2])('E=%i caps by target HP before shield and charges with wisdom in the same hit',e=>{
        const {p,m,s,c}=fighter(e);p.ringRight=ring('wisdom',1);
        const roll=vi.spyOn(rng,'randRange').mockImplementation((l,h)=>e>0?h:l);
        vi.spyOn(rng,'randPercent').mockReturnValue(true);
        const result=CombatSystem.attack(p,m);
        expect(result.hit).toBe(true);expect(m.hp).toBe(4); // fully shielded
        expect(roll.mock.calls).toContainEqual(e>0?[0,8]:[-8,0]);
        // Empty staffs cannot drain. Cooling charms can, and ignore wisdom.
        expect(s.staffRechargeRemaining).toBe(e>0?404:500);
        expect(c.cooldownRemaining).toBe(e>0?12:28);
    });
    it('unknown positive E, both slots, zero roll and exact one substantive draw',()=>{
        const {p,m,s,c}=fighter(7,false);p.ringRight=ring('reaping',2,false);p.ringLeft!.timesEnchanted=1;
        expect(ringBonus(p.rings(),'ring_of_reaping')).toBe(3);
        vi.spyOn(rng,'randPercent').mockReturnValue(true);
        const roll=vi.spyOn(rng,'randRange').mockReturnValue(0);
        CombatSystem.attack(p,m);expect(roll.mock.calls).toEqual([[0,12]]);
        expect([s.staffRechargeRemaining,c.cooldownRemaining]).toEqual([500,20]);
    });
    it('a miss, inanimate/invulnerable victim, no bonus or zero damage has no extra substantive draw',()=>{
        for(const mode of ['miss','inanimate','invulnerable','no-ring','zero-damage']){
            const {p,m,s,c}=fighter();
            if(mode==='inanimate')m.behaviorFlags.add('MONST_INANIMATE');
            if(mode==='invulnerable')m.behaviorFlags.add('MONST_INVULNERABLE');
            if(mode==='no-ring')p.ringLeft=null;
            // Zero-damage contact uses the armor adjustment hook, after weapon endpoint clamping.
            vi.spyOn(rng,'randPercent').mockReturnValue(mode!=='miss');
            const before=rng.getState();CombatSystem.attack(p,m,mode==='zero-damage'?{beforeDamage:()=>0}:undefined);
            expect(rng.getState(),mode).toEqual(before);expect([s.staffRechargeRemaining,c.cooldownRemaining]).toEqual([500,20]);vi.restoreAllMocks();
        }
    });
    it('throws and direct damage transference do not reap; landed melee does use one draw',()=>{
        const {p,m,s,c}=fighter();vi.spyOn(rng,'randPercent').mockReturnValue(true);
        CombatSystem.resolveThrownWeapon(p,m,p.equippedWeapon!);
        CombatSystem.transferMonsterHealth(p,m,3);
        expect([s.staffRechargeRemaining,c.cooldownRemaining]).toEqual([500,20]);
        const before=rng.randomNumbersGenerated;CombatSystem.attack(p,m);expect(rng.randomNumbersGenerated-before).toBe(1);
    });
    it('drains charged/full staffs, clamps cooling charms, leaves ready charms and wands alone',()=>{
        const a=staff(3,3,2700),c=charm(20),ready=charm(0),wand=Object.assign(staff(),{category:C.WAND,charges:2});
        const random={randClumpedRange:vi.fn(()=>1666)};
        rechargeItemsIncrementally([a,c,ready,wand],0,random,-1000);
        expect(a.charges).toBe(0);expect(a.staffRechargeRemaining).toBeGreaterThan(0);expect(random.randClumpedRange).not.toHaveBeenCalled();
        expect(c.cooldownRemaining).toBe(1020);expect(ready.cooldownRemaining).toBe(0);expect(wand.charges).toBe(2);
        rechargeItemsIncrementally([c],27,random,-1000);expect(c.cooldownRemaining).toBe(charmRechargeDelay('charm_of_health',1));
        expect(rechargeItemsIncrementally([c],-10,random,9999)).toEqual([c]);expect(c.cooldownRemaining).toBe(0);
    });
    it('ready notification and known/unknown detail do not reveal unknown E',()=>{
        createHeadlessGame(15,'test');const {p,m,c}=fighter();c.cooldownRemaining=1;
        vi.spyOn(rng,'randPercent').mockReturnValue(true);vi.spyOn(rng,'randRange').mockImplementation((_l,h)=>h);
        CombatSystem.attack(p,m);expect(c.cooldownRemaining).toBe(0);expect(JSON.stringify(logger.getState())).toContain('recharged');
        const r=ring('reaping',7,false);ItemLoader.identifiedItems.add(r.identityId!);
        const text=(i:Item)=>generateItemDetail(i,12).sections.flatMap(s=>s.lines.map(l=>l.text)).join('\n');
        expect(text(r)).not.toContain('0–7');expect(text(r)).toContain('1500');
        r.identified=true;expect(text(r)).toContain('0–7');expect(text(r)).toContain('0–8');expect(text(r)).toContain('附魔等级 +7');
        r.enchantment=-2;expect(text(r)).toContain('消耗');expect(text(r)).toContain('0–1');
        const light=ring('light',3);ItemLoader.identifiedItems.add(light.identityId!);
        expect(text(light)).toContain('附魔等级 +3');light.identified=false;expect(text(light)).not.toContain('附魔等级');
    });
});
