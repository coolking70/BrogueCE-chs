import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18next from 'i18next';
import zhCN from '../locales/zh_CN.json';
import species from '../data/monsters.json';
import { Monster, MonsterState, type MonsterData } from '../entities/Monster';
import { createHeadlessGame } from './harness';
import { TerrainType as T, DungeonLayer as L } from '../engine/Map/Grid';
import { ItemLoader as Items } from '../engine/Items/ItemLoader';
import { ItemCategory as C } from '../engine/Items/Item';
import { rng } from '../engine/Random';
import { logger } from '../engine/Systems/Logger';
import { catalogFeature, spawnDungeonFeature } from '../engine/Map/DungeonFeature';
import { DF, DUNGEON_FEATURE_CATALOG } from '../engine/Map/DungeonFeatureCatalog';
import * as features from '../engine/Combat/CreatureFeatures';
import * as darts from '../engine/Items/IncendiaryDart';
import { CombatSystem } from '../engine/Combat/Combat';
import { BoltEffect } from '../engine/Combat/Bolt';
import { projectileReflects } from '../engine/Combat/BoltReflection';
import { createItemDetailContext } from '../engine/UI/ItemDetailContext';
import { generateItemDetail, generateMonsterDetail } from '../engine/UI/DetailGenerator';
import { getTerrainDescription, tileFlavor } from '../engine/UI/TerrainTextCatalog';
import { sidebarEntityRows, sidebarTerrainName } from '../engine/UI/MonsterSidebar';
import { getMonsterAbsorbStatus, formatMonsterSummonMessage } from '../engine/UI/MonsterTextCatalog';
import { enchantedEquipment } from '../engine/Items/ItemEffectFormulas';
import { enchantChosenItem } from '../engine/Items/ItemUseCoordinator';

const json = <T>(value: T): T => JSON.parse(JSON.stringify(value));
type Game = ReturnType<typeof createHeadlessGame>;
const text = (value: unknown) => JSON.stringify(value);
function differences(a: any,b: any,path='$',out: any[]=[]): any[] {
    if (Object.is(a,b)||path==='$.savedAt') return out;
    if (a&&b&&typeof a==='object'&&typeof b==='object') {
        for(const k of new Set([...Object.keys(a),...Object.keys(b)]))differences(a[k],b[k],path+'.'+k,out);
    } else if(out.length<20)out.push({path,a,b});
    return out;
}
function room(seed = 46006) {
    const g = createHeadlessGame(seed, 'test');
    g.animationEnabled = false; g.monsters = []; g.dormantMonsters = []; g.purgatory = []; g.items = [];
    g.player.inventory.items = []; g.player.equippedWeapon = null; g.player.equippedArmor = null;
    g.player.loc = {x:10,y:10}; g.player.hp = g.player.maxHp = 100; g.player.regenCarry = -100;
    for (let x=0;x<g.grid.width;x++) for (let y=0;y<g.grid.height;y++) {
        const c=g.grid.getCell(x,y)!;
        c.layers = [x===0||y===0||x===g.grid.width-1||y===g.grid.height-1?T.WALL:T.FLOOR,T.NOTHING,T.NOTHING,T.NOTHING];
        c.refreshTerrainProperties(); c.volume=0; c.machineNumber=0; c.hasDormantMonster=false;
    }
    (g as any).updateVision(); logger.reset(); g.disturbed=true;
    return g;
}
function mob(g: Game, id: string, x=11,y=10) {
    const m = new Monster(x,y,species.find(row=>row.id===id)! as MonsterData);
    m.ticksUntilTurn=100000; g.monsters.push(m); return m;
}
function allCells(g: Game) {
    return Array.from({length:g.grid.width},(_,x)=>Array.from({length:g.grid.height},(_,y)=>g.grid.getCell(x,y)!)).flat();
}
beforeEach(async()=>{ await i18next.init({lng:'zh_CN',resources:{zh_CN:{translation:zhCN}},initImmediate:false}); });
afterEach(()=>vi.restoreAllMocks());

describe('X4-R6 real rule entry points',()=>{
    it('naturally generated bloodwort bursts by a player move, heals by CE integer division, and resumes identically after JSON load',()=>{
        const g=createHeadlessGame(424242); g.animationEnabled=false;
        const pod=allCells(g).find(c=>c.layers.includes(T.BLOODFLOWER_POD)
            && [[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy])=>g.grid.getCell(c.x+dx!,c.y+dy!)?.isPassable))!;
        expect(pod).toBeDefined();
        const near=[[1,0],[-1,0],[0,1],[0,-1]].map(([dx,dy])=>g.grid.getCell(pod.x+dx!,pod.y+dy!))
            .find(c=>c?.isPassable && !c.isBurning)!;
        // Only initial actor conditions are controlled; natural map/DF remain intact.
        g.player.loc={x:near.x,y:near.y}; g.player.maxHp=44; g.player.hp=10; g.player.regenCarry=-100;
        for(const m of g.monsters)m.ticksUntilTurn=100000;
        (g as any).updateVision();
        g.executeCommand('move',{x:pod.x-near.x,y:pod.y-near.y});
        expect(g.player.loc).toEqual({x:near.x,y:near.y});
        expect(pod.layers).not.toContain(T.BLOODFLOWER_POD);
        expect(allCells(g).some(c=>c.layers.includes(T.HEALING_CLOUD)&&c.volume>0)).toBe(true);
        const hp=g.player.hp;
        g.executeCommand('move',{x:pod.x-near.x,y:pod.y-near.y});
        expect(g.player.loc).toEqual({x:pod.x,y:pod.y});
        expect(g.player.hp-hp).toBe(2); // trunc(44/15), not a percentage approximation.
        expect(logger.messages.some(m=>m.text==='你感觉好多了。')).toBe(true);
        const saved=json(g.toSnapshot()), random=rng.getState();
        expect(g.loadSnapshot(saved)).toBe(true); expect(rng.getState()).toEqual(random);
        expect(differences(json(g.toSnapshot()),saved)).toEqual([]);
        g.executeCommand('wait');const continued=json(g.toSnapshot());
        expect(g.loadSnapshot(saved)).toBe(true);g.executeCommand('wait');
        expect(differences(json(g.toSnapshot()),continued)).toEqual([]);
    });

    it('heals only gradual exposure, with full/inanimate/submerged gates and no levitation/respiration/fire-immunity exemption',()=>{
        const g=room(),m=mob(g,'naga');m.hp=1;m.maxHp=44;
        for(const actor of [g.player,m])g.grid.setTerrainLayer(actor.x,actor.y,L.GAS,T.HEALING_CLOUD);
        g.player.hp=10;g.player.maxHp=44;
        (g as any).applyEnvironmentalEffects(g.player);expect(g.player.hp).toBe(10);
        const armor=Items.spawnArmor('leather_armor',-1,-1)!;armor.runicType='respiration';g.player.equippedArmor=armor;
        g.player.applyStatus('levitating',10);g.player.applyStatus('immune_fire',10);
        (g as any).applyEnvironmentalEffects();expect(g.player.hp).toBe(12);expect(m.hp).toBe(3);
        g.grid.setTerrainLayer(m.x,m.y,L.LIQUID,T.WATER_DEEP);m.submerged=true;
        (g as any).applyEnvironmentalEffects();expect(m.hp).toBe(3);
        m.submerged=false;m.behaviorFlags.add('MONST_INANIMATE');
        (g as any).applyEnvironmentalEffects();expect(m.hp).toBe(3);
        g.player.hp=43;(g as any).applyEnvironmentalEffects();expect(g.player.hp).toBe(44);
        logger.reset();(g as any).applyEnvironmentalEffects();expect(logger.messages).toHaveLength(0);
    });

    it.each([false,true])('real throw into a creature=%s consumes one incendiary dart without physical attack or dropped loot',hit=>{
        const g=room(),m=hit?mob(g,'goblin',13,10):undefined;
        if(m){m.hp=m.maxHp=100;m.applyShield(1000);}
        const dart=Items.spawnWeapon('incendiary_dart',-1,-1)!;dart.quantity=3;g.player.inventory.addItem(dart);
        const physical=vi.spyOn(CombatSystem,'resolveThrownWeapon');
        const original=darts.resolveIncendiaryDart;let impact:unknown;
        vi.spyOn(darts,'resolveIncendiaryDart').mockImplementation((unit,pos,world)=>{
            const result=original(unit,pos,world);impact={quantity:unit.quantity,pos:{...pos},tile:world.grid.getCell(pos.x,pos.y)!.layers[L.SURFACE],result};return result;
        });
        g.executeItemCommand('throw',dart);g.executeCommand('mouse_travel',{x:13,y:10});
        expect(physical).not.toHaveBeenCalled();expect(dart.quantity).toBe(2);
        expect(impact).toEqual({quantity:1,pos:{x:13,y:10},tile:T.DART_EXPLOSION,result:true});
        expect(g.items.some(i=>i.identityId==='incendiary_dart'||i.identityId==='dart')).toBe(false);
        expect(g.absoluteTurnNumber).toBeGreaterThan(0);
        if(m)expect((m.statusDurations as Record<string,number>).burning).toBeGreaterThan(0);
    });

    it('reading the generated scroll identity consumes/identifies it and wakes distant monsters into pursuit',()=>{
        const g=room(),a=mob(g,'goblin',24,10),b=mob(g,'ogre',38,10);
        a.state=b.state=MonsterState.ASLEEP;
        const scroll=Items.spawnScroll('scroll_of_aggravate_monsters',-1,-1)!;g.player.inventory.addItem(scroll);
        g.executeItemCommand('read',scroll);
        expect(g.player.inventory.items).not.toContain(scroll);
        expect(Items.identifiedItems.has('scroll_of_aggravate_monsters')).toBe(true);
        for(const m of [a,b]){expect(m.state).toBe(MonsterState.HUNTING);expect(m.givenUpOnScent).toBe(false);}
        expect(g.player.getStatusDuration('aggravating')).toBeGreaterThan(0);
        expect(logger.messages.some(m=>m.text.includes('啸'))).toBe(true);
    });

    it.each(['goblin','spider','salamander','phantom','acidic_jelly','underworm','stone_guardian','zombie'])('%s takes real melee blood after shielding and before HP/death, with no duplicate emission',id=>{
        const g=room(),m=mob(g,id);m.hp=m.maxHp=100;m.applyStatus('paralyzed',100);m.applyShield(20);
        const w=Items.spawnWeapon('sword',-1,-1)!;w.damage='10';w.enchantment=0;w.strengthRequired=0;g.player.equippedWeapon=w;
        const original=features.spawnCreatureBlood,seen:any[]=[];
        vi.spyOn(features,'spawnCreatureBlood').mockImplementation((...args)=>{
            const result=original(...args);seen.push({blood:args[2],damage:args[3],hp:args[4],tile:args[0].getCell(args[1].x,args[1].y)!.layers[catalogFeature(args[2] as DF).layer]});return result;
        });
        const directory=text(DUNGEON_FEATURE_CATALOG);
        g.executeCommand('move',{x:1,y:0});
        // Guardians' weapon immunity is intentionally preserved: no contact blood.
        if(m.isImmuneToWeapons())expect(seen).toHaveLength(0);
        else {expect(seen).toHaveLength(1);expect(seen[0]).toMatchObject({blood:m.bloodType,hp:100,tile:catalogFeature(m.bloodType as DF).tile});expect(seen[0].damage).toBeGreaterThan(0);}
        expect(text(DUNGEON_FEATURE_CATALOG)).toBe(directory);
    });

    it('fully shielded/zero/bloodless hits produce no terrain or blood RNG; lethal zombie uses pre-hit HP exactly once',()=>{
        const g=room(),m=mob(g,'zombie');m.hp=5;m.applyShield(100);
        const before=rng.getState();m.takeDamage(3,false,g.grid);
        expect(rng.getState()).toEqual(before);expect(g.grid.getCell(m.x,m.y)!.volume).toBe(0);
        m.takeDamage(0,true,g.grid);expect(rng.getState()).toEqual(before);
        m.takeDamage(100,true,g.grid);expect(m.hp).toBe(0);expect(g.grid.getCell(m.x,m.y)!.volume).toBe(200);
        const playerCell=g.grid.getCell(g.player.x,g.player.y)!;g.player.takeDamage(1,true,g.grid);expect(playerCell.layers).toContain(T.BLOOD);
    });

    it('reflected transference uses HP before the hit for blood, before the caster heals itself',()=>{
        const g=room(),caster=mob(g,'vampire',12,10),reflector=mob(g,'stone_guardian',16,10);
        g.player.loc={x:10,y:12};
        caster.hp=10;caster.isAlly=false;caster.abilityFlags.add('MA_TRANSFERENCE');
        vi.spyOn(rng,'randClumpedRange').mockReturnValue(15);
        const blood=vi.spyOn(features,'spawnCreatureBlood');
        const result=g.castMonsterBolt(caster,reflector,'SPARK')!;
        expect(result.hits.map(h=>h.creature)).toEqual([caster]);
        expect(blood.mock.calls.filter(c=>c[1]===caster.loc).map(c=>[c[3],c[4]])).toEqual([[15,10]]);
        expect(caster.hp).toBe(4); // 10 + trunc(min(15,10)*9/10) - 15.
    });

    it('real objective updates emit naga/salamander trails once and activation occurs after absorption but before paralysis',()=>{
        const g=room(),n=mob(g,'naga',15,10),s=mob(g,'salamander',20,10),guard=mob(g,'stone_guardian',25,10);
        n.state=s.state=MonsterState.ASLEEP;
        const spy=vi.spyOn(features,'emitCreatureFeature');
        g.executeCommand('wait');
        expect(g.grid.getCell(n.x,n.y)!.layers).toContain(T.PUDDLE);
        expect(g.grid.getCell(s.x,s.y)!.layers.some(t=>t===T.EMBERS||t===T.ASH)).toBe(true);
        expect(spy.mock.calls.filter(c=>c[1]===n&&c[2]==='objective')).toHaveLength(1);
        expect(spy.mock.calls.filter(c=>c[1]===guard&&c[2]==='activation')).toHaveLength(0);
        guard.applyStatus('paralyzed',10);guard.takeTurn(g,10);
        expect(g.grid.getCell(guard.x,guard.y)!.layers).toContain(T.GUARDIAN_GLOW);
        expect(spy.mock.calls.filter(c=>c[1]===guard&&c[2]==='activation')).toHaveLength(1);
    });
});

describe('X4-R6 knowledge, detail formulas and persistence',()=>{
    it('successful staff commands keep only three observed use turns, reject cancel/empty, and persist without RNG',()=>{
        const g=room(),m=mob(g,'goblin',13,10);m.hp=m.maxHp=100;
        const staff=Items.spawnStaff('staff_of_haste',-1,-1)!;staff.charges=10;staff.enchantment=3;staff.maxCharges=3;g.player.inventory.addItem(staff);
        const turns:number[]=[];
        for(let i=0;i<4;i++){
            g.executeItemCommand('use',staff);g.setArcanaTarget(13,10);turns.unshift(g.absoluteTurnNumber);g.executeCommand('confirm_target');
        }
        expect(staff.knownStaffUses).toEqual(turns.slice(0,3));
        g.executeItemCommand('use',staff);g.executeCommand('cancel_target');expect(staff.knownStaffUses).toEqual(turns.slice(0,3));
        staff.charges=0;staff.identified=false;g.executeItemCommand('use',staff);g.setArcanaTarget(13,10);g.executeCommand('confirm_target');
        expect(staff.knownStaffUses).toEqual(turns.slice(0,3));
        const saved=json(g.toSnapshot()),random=rng.getState();expect(g.loadSnapshot(saved)).toBe(true);expect(rng.getState()).toEqual(random);
        const restored=g.player.inventory.items.find(i=>i.id===staff.id)!;
        expect(restored.knownStaffUses).toEqual(turns.slice(0,3));
        const context=createItemDetailContext(g,restored);expect(context.knownStaffUses).not.toBe(restored.knownStaffUses);
        expect(text(generateItemDetail(restored,context))).toContain('最近');
    });

    it('ordinary generation owns originDepth; pickup/drop and mixed-depth stacks retain honest provenance',()=>{
        const g=createHeadlessGame(424242);g.animationEnabled=false;
        const ordinary=g.items.filter(i=>i.category!==C.GOLD);expect(ordinary.length).toBeGreaterThan(0);
        expect(ordinary.every(i=>i.originDepth===1)).toBe(true);
        const item=ordinary.find(i=>i.category===C.POTION||i.category===C.SCROLL)!;expect(item).toBeDefined();
        const originalDepth=item.originDepth;g.player.loc={...item.loc};g.executeCommand('pickup');
        expect(g.player.inventory.stackFor(item)?.originDepth).toBe(originalDepth);
        const a=Items.spawnPotion('potion_of_life',0,0)!,b=Items.spawnPotion('potion_of_life',0,0)!;
        a.originDepth=2;b.originDepth=3;g.player.inventory.addItem(a);g.player.inventory.addItem(b);
        expect(g.player.inventory.stackFor(a)!.originDepth).toBe(0);
        const saved=json(g.toSnapshot());expect(g.loadSnapshot(saved)).toBe(true);expect(differences(json(g.toSnapshot()),saved)).toEqual([]);
    });

    it('keyboard, location and inventory generators share all contextual paragraphs; replay omniscience is independent and read-only',()=>{
        const g=room(),item=Items.spawnFood('ration_of_food',11,10)!;g.items.push(item);(g as any).updateVision();g.grid.getCell(11,10)!.isVisible=true;
        const expected=generateItemDetail(item,createItemDetailContext(g,item));
        g.executeCommand('examine');expect(g.inspectTarget).toEqual(expected);
        g.handleInspectAt(11,10);expect(g.inspectTarget).toEqual(expected);
        const staff=Items.spawnStaff('staff_of_fire',0,0)!;staff.identified=false;g.player.inventory.addItem(staff);
        const saved=json(g.toSnapshot()),random=rng.getState(),knowledge=[...Items.identifiedItems];
        g.replayOmniscientDetails=true;expect(createItemDetailContext(g,staff).omniscient).toBe(false);
        g.replayRecording=g.exportRecording();const ctx=createItemDetailContext(g,staff);expect(ctx.omniscient).toBe(true);
        expect(text(generateItemDetail(staff,ctx))).toContain('火焰');
        expect(differences(json(g.toSnapshot()),saved)).toEqual([]);expect(rng.getState()).toEqual(random);expect([...Items.identifiedItems]).toEqual(knowledge);
    });

    it('E/E+1 staff effects and equipment enchanting match the displayed projections, including nonpositive reflection',()=>{
        const g=room(),m=mob(g,'goblin');m.maxHp=100;
        for(const [id,effect] of [['staff_of_healing',BoltEffect.HEALING],['staff_of_haste',BoltEffect.HASTE],['staff_of_discord',BoltEffect.DISCORD]] as const){
            const staff=Items.spawnStaff(id,0,0)!;staff.identified=true;Items.identify(id);
            const observed=[];
            for(const e of [3,4]){staff.enchantment=e;staff.maxCharges=e;m.hp=1;m.statusDurations={};(g as any).applyBasicBoltEffect(m,effect,e);
                observed.push(effect===BoltEffect.HEALING?m.hp-1:m.getStatusDuration(effect===BoltEffect.HASTE?'hasted':'discordant'));}
            staff.enchantment=3;staff.maxCharges=3;const detail=text(generateItemDetail(staff,createItemDetailContext(g,staff)));
            for(const n of observed)expect(detail).toContain(String(n));
            expect(observed).toEqual(effect===BoltEffect.HEALING?[30,40]:effect===BoltEffect.HASTE?[14,18]:[12,16]);
        }
        const armor=Items.spawnArmor('chain_mail',0,0)!;armor.enchantment=-3;armor.strengthRequired=16;armor.identified=true;armor.runicKnown=true;armor.runicType='reflection';g.player.equippedArmor=armor;g.player.inventory.addItem(armor);
        const prediction=enchantedEquipment(armor.enchantment,armor.strengthRequired);
        const random=rng.getState();expect(projectileReflects(g.player,m)).toBe(false);expect(rng.getState()).toEqual(random);
        expect(text(generateItemDetail(armor,createItemDetailContext(g,armor)))).toContain('不会偏转');
        enchantChosenItem(g.player,armor,{updateVision:()=>{},logEnchanted:()=>{},logUncursed:()=>{}});
        expect(armor).toMatchObject(prediction);
    });

    it('Tab inspection cycles and closes without turns, movement or RNG, including an empty scene',()=>{
        const g=room(),item=Items.spawnFood('ration_of_food',11,10)!;g.items.push(item);
        (g as any).updateVision();g.grid.getCell(11,10)!.isVisible=true;
        const before={turn:g.absoluteTurnNumber,loc:{...g.player.loc},rng:rng.getState()};
        g.executeCommand('cycle_target');expect(g.inspectTarget).toEqual(generateItemDetail(item,createItemDetailContext(g,item)));
        g.executeCommand('cycle_target');expect(g.inspectTarget).toBeNull();
        g.items=[];g.executeCommand('cycle_target');
        expect({turn:g.absoluteTurnNumber,loc:g.player.loc,rng:rng.getState()}).toEqual(before);
        expect((g as any).isAutoExploring).toBe(false);
    });

    it('replay omniscience survives restart/seek and leaves recorded state and RNG identical with zero OOS',()=>{
        const g=createHeadlessGame(424242);g.animationEnabled=false;
        for(let i=0;i<3;i++)g.executeCommand('wait');
        const recording=json(g.exportRecording());
        expect(g.loadReplay(recording)).toBe(true);expect(g.replayOmniscientDetails).toBe(false);
        g.replaySeek(recording.events.length);expect(g.replayError).toBeNull();const ordinary=json(g.toSnapshot());
        g.replayOmniscientDetails=true;g.replayRestart();expect(g.replayOmniscientDetails).toBe(true);
        g.replaySeek(recording.events.length);expect(g.replayOmniscientDetails).toBe(true);expect(g.replayError).toBeNull();
        expect(differences(json(g.toSnapshot()),ordinary)).toEqual([]);
        g.replaySeek(1);expect(g.replayOmniscientDetails).toBe(true);expect(g.replayError).toBeNull();
        g.replaySeek(recording.events.length);expect(g.replayError).toBeNull();
        expect(differences(json(g.toSnapshot()),ordinary)).toEqual([]);
        g.startNewGame({seed:424242});expect(g.replayOmniscientDetails).toBe(false);
    });

    it('rejects absent or malformed persisted staff-use history without migrating it',()=>{
        const g=room(),staff=Items.spawnStaff('staff_of_haste',-1,-1)!;g.player.inventory.addItem(staff);
        const saved=json(g.toSnapshot());
        for(const value of [undefined,[-1],[1,2],[1.5],[0,0,0,0]]){
            const bad=json(saved);(bad.player.inventory.find(i=>i.id===staff.id)! as any).knownStaffUses=value;
            expect(g.loadSnapshot(bad)).toBe(false);
        }
        expect(g.loadSnapshot(saved)).toBe(true);
    });
});

describe('X4-R6 actual terrain, flavor and monster text consumers',()=>{
    it('all 208 names use the catalog at Game and sidebar, with visible/memory/secret priority boundaries',()=>{
        const g=room();
        for(const terrain of Object.values(T).filter((v):v is T=>typeof v==='number')){
            expect((g as any).getTerrainName(terrain)).toBe(getTerrainDescription(terrain,{atDungeonExit:g.depth===1}));
            expect(sidebarTerrainName(terrain)).toBe(getTerrainDescription(terrain));
        }
        const c=g.grid.getCell(11,10)!;
        for(const terrain of [T.PLAIN_FIRE,T.POISON_GAS,T.HOLE,T.FORCEFIELD,T.ANCIENT_SPIRIT_VINES,T.ANCIENT_SPIRIT_GRASS]){
            c.layers=[T.FLOOR,T.NOTHING,T.NOTHING,T.NOTHING];g.grid.setTerrain(11,10,terrain);c.isVisible=true;
            g.updateHover(11,10);expect(g.hoveredText).toContain(getTerrainDescription(terrain));expect(g.hoveredText).not.toBe('地面');
        }
        c.layers=[T.SECRET_DOOR,T.NOTHING,T.NOTHING,T.NOTHING];c.isVisible=true;g.updateHover(11,10);expect(g.hoveredText).not.toContain('秘密');
        c.isVisible=false;c.hasMemory=true;c.rememberedLayers=[T.FLOOR,T.NOTHING,T.POISON_GAS,T.NOTHING];
        c.layers=[T.FLOOR,T.NOTHING,T.NOTHING,T.FORCEFIELD];c.isDiscovered=true;
        g.updateHover(11,10);expect(g.hoveredText).toContain(getTerrainDescription(T.POISON_GAS));expect(g.hoveredText).not.toContain(getTerrainDescription(T.FORCEFIELD));
        c.isVisible=true;c.layers=[T.FLOOR,T.NOTHING,T.POISON_GAS,T.PLAIN_FIRE];g.updateHover(11,10);expect(g.hoveredText).toContain(getTerrainDescription(T.PLAIN_FIRE));
        c.layers=[T.FLOOR,T.NOTHING,T.NOTHING,T.BLOODFLOWER_STALK];
        expect(sidebarEntityRows(g.player,g.grid,[],[],null,g.depth).find(r=>r.loc.x===11&&r.loc.y===10)?.name).toBe(getTerrainDescription(T.BLOODFLOWER_STALK));
    });

    it('standing uses CE flavor and respiration/levitation/disturbed/end gates without writing history',()=>{
        const g=room(),c=g.grid.getCell(g.player.x,g.player.y)!;
        c.layers=[T.FLOOR,T.NOTHING,T.POISON_GAS,T.NOTHING];const messages=json(logger.messages);
        g.updateFlavorText();expect(g.flavorText).toBe(tileFlavor(c.layers));
        const armor=Items.spawnArmor('leather_armor',0,0)!;armor.runicType='respiration';g.player.equippedArmor=armor;
        g.updateFlavorText();expect(g.flavorText).toContain('清凉洁净');
        g.player.equippedArmor=null;g.player.applyStatus('levitating',10);g.updateFlavorText();expect(g.flavorText).toContain(getTerrainDescription(T.POISON_GAS));
        expect(logger.messages).toEqual(messages);
        g.flavorText='unchanged';g.disturbed=false;g.updateFlavorText();expect(g.flavorText).toBe('unchanged');
        g.disturbed=true;g.isGameOver=true;g.updateFlavorText();expect(g.flavorText).toBe('unchanged');
    });

    it('visible failed summons still narrate species incantation, hidden summons stay silent, and absorption status uses species wording',()=>{
        const g=room(),m=mob(g,'goblin_conjurer',12,10);(g as any).updateVision();g.grid.getCell(m.x,m.y)!.isVisible=true;
        vi.spyOn(g as any,'findMinionSpawnSpot').mockReturnValue(null);
        logger.reset();expect(g.summonMinionsFor(m)).toBe(false);
        expect(logger.messages.map(x=>x.text)).toContain(formatMonsterSummonMessage(m.typeId,g.monsterDisplayName(m)));
        m.applyStatus('invisible',50);logger.reset();g.summonMinionsFor(m);expect(logger.messages).toHaveLength(0);
        m.targetCorpseLoc={...m.loc};m.corpseAbsorptionCounter=10;
        const detail=generateMonsterDetail(m,100,12,0,[1,2],0,0);
        expect(text(detail)).toContain(getMonsterAbsorbStatus(m.typeId));
    });

    it('both activation alarms and both mechanical alarms use localized once-per-turn visible DF hooks',()=>{
        const g=room();
        for(const df of [DF.DF_GUARDIAN_STEP,DF.DF_MIRROR_TOTEM_STEP,158,163]){
            const feature=catalogFeature(df as DF);const c=g.grid.getCell(12,10)!;c.isVisible=false;logger.reset();
            // Install the actual Game hook and keep map effects local: unchanged description/id.
            const probe={...feature,startProbability:0,subsequentDF:null};
            spawnDungeonFeature(g.grid,12,10,probe,false);expect(logger.messages).toHaveLength(0);
            c.isVisible=true;spawnDungeonFeature(g.grid,12,10,probe,false);spawnDungeonFeature(g.grid,12,10,probe,false);
            expect(logger.messages).toHaveLength(1);expect(logger.messages[0]!.text).toMatch(/[\u4e00-\u9fff]/);
        }
    });
});
