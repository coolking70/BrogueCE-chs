import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHeadlessGame } from './harness';
import { Game } from '../engine/Core/Game';
import { TerrainType as T, DungeonLayer as L, DRAW_PRIORITY, TERRAIN_HOME_LAYER } from '../engine/Map/Grid';
import { Monster, MonsterState, specificallyValidBoltTarget, type MonsterData } from '../entities/Monster';
import monsters from '../data/monsters.json';
import { rng } from '../engine/Random';
import { DF, DUNGEON_FEATURE_CATALOG as DFC } from '../engine/Map/DungeonFeatureCatalog';
import { catalogFeature, spawnDungeonFeature, cellTerrainFlags } from '../engine/Map/DungeonFeature';
import { TERRAIN_FLAGS, T_ENTANGLES, T_CAUSES_DAMAGE, T_IS_FLAMMABLE, TM_PROMOTES_ON_PLAYER_ENTRY } from '../engine/Map/TerrainCatalog';
import { promoteTile, runPromotionUpdate, breakEntanglingTerrain } from '../engine/Map/Promotion';
import { CEBoltType as B, CEBoltEffect as E, CEBoltFlags as F, CE_BOLT_CATALOG as BC } from '../engine/Combat/BoltCatalog';
import { MONSTER_BOLT_TABLE, BoltEffect } from '../engine/Combat/Bolt';
import { Item, ItemCategory } from '../engine/Items/Item';

function scene() {
    const g = createHeadlessGame(8008, 'test');
    g.monsters=[]; g.dormantMonsters=[]; g.items=[];
    for (let x=0;x<g.grid.width;x++) for(let y=0;y<g.grid.height;y++) {
        g.grid.setTerrain(x,y,x===0||y===0||x===g.grid.width-1||y===g.grid.height-1?T.WALL:T.FLOOR);
        Object.assign(g.grid.getCell(x,y)!,{isVisible:true,hasMemory:true,hasDormantMonster:false,machineNumber:0});
    }
    g.player.loc={x:18,y:10}; g.player.hp=g.player.maxHp=150;
    g.spawnFloatingText=vi.fn(); (g as any).updateVision=vi.fn();
    rng.seedRandomGenerator(808);
    return g;
}
function mob(g:Game,id='spider',x=8,y=10) {
    const m=new Monster(x,y,(monsters as MonsterData[]).find(m=>m.id===id)!);
    m.state=MonsterState.HUNTING; g.monsters.push(m); return m;
}
const surface=(g:Game,x:number,y=10)=>g.grid.getCell(x,y)!.layers[L.SURFACE]!;
const set=(g:Game,x:number,t:T,y=10)=>g.grid.setTerrainLayer(x,y,L.SURFACE,t);
const env=(g:Game,target?:Monster)=> (g as any).applyEnvironmentalEffects(target);
afterEach(()=>vi.restoreAllMocks());
beforeEach(()=>rng.seedRandomGenerator(808));

describe('U08 CE catalog and runtime qualification',()=>{
    it.each([
        [DF.DF_WEB_SMALL,57,T.WEB,15,12], [DF.DF_WEB_LARGE,58,T.WEB,100,39],
        [DF.DF_ANCIENT_SPIRIT_VINES,59,T.ANCIENT_SPIRIT_VINES,75,70],
        [DF.DF_ANCIENT_SPIRIT_GRASS,60,T.ANCIENT_SPIRIT_GRASS,50,47],
    ])('DF %s copies CE id/tile/spread and no unrelated flags', (id,n,tile,start,decr)=>{
        expect(id).toBe(n); expect(DFC[id as DF]).toMatchObject({tile,layer:L.SURFACE,startProbability:start,probabilityDecrement:decr,
            flags:0,subsequentDF:null,propagationTerrain:null,effectRadius:0,lightFlare:''});
    });
    it('new closed terrain set: 139 DFs, no entity/spawn flags; web forbidden to learn, vines eligible',()=>{
        expect(Object.keys(DFC)).toHaveLength(139);
        expect(BC[B.SPIDERWEB]).toMatchObject({effect:E.NONE,pathDF:'DF_WEB_SMALL',targetDF:'DF_WEB_LARGE'});
        expect(BC[B.ANCIENT_SPIRIT_VINES]).toMatchObject({effect:E.NONE,pathDF:'DF_ANCIENT_SPIRIT_GRASS',targetDF:'DF_ANCIENT_SPIRIT_VINES'});
        expect(BC[B.SPIDERWEB].flags).toBe(F.TARGET_ENEMIES|F.NEVER_REFLECTS|F.NOT_LEARNABLE);
        expect(BC[B.ANCIENT_SPIRIT_VINES].flags).toBe(F.TARGET_ENEMIES|F.NEVER_REFLECTS);
        for(const name of ['SPIDERWEB','ANCIENT_SPIRIT_VINES']) expect(MONSTER_BOLT_TABLE[name]!.effect).toBe(BoltEffect.NONE);
        expect(TERRAIN_FLAGS[T.ANCIENT_SPIRIT_VINES]).toMatchObject({flags:T_ENTANGLES|T_CAUSES_DAMAGE|T_IS_FLAMMABLE,
            fireType:'DF_PLAIN_FIRE',promoteType:'DF_ANCIENT_SPIRIT_GRASS',promoteChance:1000});
        expect(TERRAIN_FLAGS[T.ANCIENT_SPIRIT_VINES].mechFlags & TM_PROMOTES_ON_PLAYER_ENTRY).not.toBe(0);
        expect(DRAW_PRIORITY[T.ANCIENT_SPIRIT_VINES]).toBe(19);expect(DRAW_PRIORITY[T.ANCIENT_SPIRIT_GRASS]).toBe(60);
        expect(TERRAIN_HOME_LAYER[T.ANCIENT_SPIRIT_VINES]).toBe(L.SURFACE);
    });
    it.each(['SPIDERWEB','ANCIENT_SPIRIT_VINES'])('%s rejects teammates, invulnerable, web immune and current entanglement without rolling',name=>{
        const g=scene(),m=mob(g),t=mob(g,'rat',18);t.isAlly=true;
        const before=rng.randomNumbersGenerated;
        expect(specificallyValidBoltTarget(m,t,name,g)).toBe(true);
        t.isAlly=false;expect(specificallyValidBoltTarget(m,t,name,g)).toBe(false);t.isAlly=true;
        for(const flag of ['MONST_INVULNERABLE','MONST_IMMUNE_TO_WEBS']) {
            t.behaviorFlags.add(flag);expect(specificallyValidBoltTarget(m,t,name,g)).toBe(false);t.behaviorFlags.delete(flag);
        }
        set(g,t.x,T.WEB);expect(specificallyValidBoltTarget(m,t,name,g)).toBe(false);
        expect(rng.randomNumbersGenerated).toBe(before);
    });
    it('distinct forbidden flags: web rejects immobile/turret, vines rejects inanimate',()=>{
        const g=scene(),m=mob(g),t=mob(g,'rat',18);t.isAlly=true;
        t.behaviorFlags.add('MONST_IMMOBILE');expect(specificallyValidBoltTarget(m,t,'SPIDERWEB',g)).toBe(false);
        expect(specificallyValidBoltTarget(m,t,'ANCIENT_SPIRIT_VINES',g)).toBe(true);
        t.behaviorFlags.clear();t.behaviorFlags.add('MONST_TURRET');expect(specificallyValidBoltTarget(m,t,'SPIDERWEB',g)).toBe(false);
        t.behaviorFlags.clear();t.behaviorFlags.add('MONST_INANIMATE');expect(specificallyValidBoltTarget(m,t,'ANCIENT_SPIRIT_VINES',g)).toBe(false);
        expect(specificallyValidBoltTarget(m,t,'SPIDERWEB',g)).toBe(true);
    });
    it('real spider and dryad always cast, pay 400/100 ticks, and reject sleeping/hidden/blocked targets',()=>{
        for(const [id,ticks] of [['spider',400],['mangrove_dryad',100]] as const) {
            const g=scene(),m=mob(g,id);const at={...m.loc};
            m.takeTurn(g,100);expect(m.loc).toEqual(at);expect(m.ticksUntilTurn).toBe(ticks);
            expect(g.pendingBoltFrames.length).toBe(10);
        }
        const g=scene(),m=mob(g);g.player.setStatusDuration('invisible',5);
        expect(m.tryUseBolt(g)).toBe(false);g.player.setStatusDuration('invisible',0);
        for(let y=1;y<g.grid.height-1;y++)g.grid.setTerrain(12,y,T.WALL);
        expect(m.tryUseBolt(g)).toBe(false);
        m.state=MonsterState.ASLEEP;const cast=vi.spyOn(g,'castMonsterBolt');m.takeTurn(g,100);expect(cast).not.toHaveBeenCalled();
    });
    it('no target => no ticks/RNG; repeated web does not recast while occupied terrain holds',()=>{
        const g=scene(),m=mob(g);expect(m.tryUseBolt(g)).toBe(true);
        const before=rng.randomNumbersGenerated;m.ticksUntilTurn=17;
        expect(m.tryUseBolt(g)).toBe(false);expect(m.ticksUntilTurn).toBe(17);expect(rng.randomNumbersGenerated).toBe(before);
    });
});

describe('U08 actual zap path and ordered DF fill',()=>{
    it.each(['SPIDERWEB','ANCIENT_SPIRIT_VINES'])('%s exactly reproduces pathDF once per reached cell then targetDF, including RNG',name=>{
        const g=scene(),m=mob(g,name==='SPIDERWEB'?'spider':'mangrove_dryad');g.player.loc={x:30,y:20};
        const target=mob(g,'rat',18);target.isAlly=true;
        const h=scene();h.player.loc={x:30,y:20};
        rng.seedRandomGenerator(2026);const result=g.castMonsterBolt(m,target,name)!;const draws=rng.randomNumbersGenerated;
        rng.seedRandomGenerator(2026);
        for(let x=9;x<=18;x++)spawnDungeonFeature(h.grid,x,10,catalogFeature(name==='SPIDERWEB'?DF.DF_WEB_SMALL:DF.DF_ANCIENT_SPIRIT_GRASS),false);
        spawnDungeonFeature(h.grid,18,10,catalogFeature(name==='SPIDERWEB'?DF.DF_WEB_LARGE:DF.DF_ANCIENT_SPIRIT_VINES),false);
        expect(rng.randomNumbersGenerated).toBe(draws);
        expect(Array.from({length:g.grid.width},(_,x)=>Array.from({length:g.grid.height},(_,y)=>g.grid.getCell(x,y)!.layers))).toEqual(Array.from({length:h.grid.width},(_,x)=>Array.from({length:h.grid.height},(_,y)=>h.grid.getCell(x,y)!.layers)));
        expect(result.path).toEqual(Array.from({length:10},(_,i)=>({x:i+9,y:10})));
        expect(result.hits.map(h=>h.creature)).toEqual([target]);
        expect(result.outcome).toEqual({autoID:false,casterMovement:null});
        expect(g.monsters).toHaveLength(2);expect(target.hp).toBe(target.maxHp);
        expect(surface(g,18)).toBe(name==='SPIDERWEB'?T.WEB:T.ANCIENT_SPIRIT_VINES);
    });
    it.each(['SPIDERWEB','ANCIENT_SPIRIT_VINES'])('%s hits intervening ally and stops; never reflects even from 100%% reflector',name=>{
        const g=scene(),m=mob(g),blocker=mob(g,'rat',12);blocker.abilityFlags.add('MA_REFLECT_100');
        const result=g.castMonsterBolt(m,g.player,name)!;
        expect(result.landingPos).toEqual(blocker.loc);expect(result.hits.map(h=>h.creature)).toEqual([blocker]);
        expect(result.reflections).toEqual([]);expect(surface(g,18)).toBe(T.NOTHING);
    });
    it('wall is reached, receives no surface, and stops travel; endpoint spread can fill adjacent legal cells',()=>{
        const g=scene(),m=mob(g);g.grid.setTerrain(12,10,T.WALL);
        const result=g.castMonsterBolt(m,g.player,'SPIDERWEB')!;
        expect(result.landingPos).toEqual({x:12,y:10});expect(result.path).toHaveLength(4);
        expect(surface(g,12)).toBe(T.NOTHING);expect(surface(g,13)).toBe(T.WEB);expect(surface(g,18)).toBe(T.NOTHING);
    });
    it('empty origin aim does not fabricate a landing or DF',()=>{
        const g=scene(),m=mob(g);const before=rng.randomNumbersGenerated;
        const r=g.castMonsterBolt(m,m,'SPIDERWEB')!;expect(r.path).toEqual([]);expect(r.landingPos).toBeNull();expect(rng.randomNumbersGenerated).toBe(before);
    });
    it('origin is not a path step, but DF spread may reach it',()=>{
        const g=scene(),m=mob(g);const calls=vi.spyOn(g as any,'spawnEntanglingBoltFeature');
        const r=g.castMonsterBolt(m,g.player,'SPIDERWEB')!;
        expect(calls.mock.calls.map(c=>c[1])).toEqual([...r.path,r.landingPos]);
        expect(calls.mock.calls.every(c=>(c[1] as {x:number;y:number}).x!==m.x || (c[1] as {x:number;y:number}).y!==m.y)).toBe(true);
    });
    it.each([false,true])('vines immediately promote under player during fill, levitating=%s',flying=>{
        const g=scene(),m=mob(g,'mangrove_dryad');if(flying)g.player.setStatusDuration('levitating',10);
        const hp=g.player.hp;g.castMonsterBolt(m,g.player,'ANCIENT_SPIRIT_VINES');
        expect(surface(g,18)).toBe(T.ANCIENT_SPIRIT_GRASS);expect(g.player.hp).toBe(hp);
        expect(cellTerrainFlags(g.grid,18,10)&T_ENTANGLES).toBe(0);
    });
    it('refresh occurs during fill, not after it; nested grass fill cannot overwrite stronger vines',()=>{
        const g=scene();const seen:T[]=[];
        spawnDungeonFeature(g.grid,18,10,catalogFeature(DF.DF_ANCIENT_SPIRIT_VINES),false,p=>{
            seen.push(surface(g,p.x,p.y));if(p.x===18&&p.y===10)promoteTile(g.grid,18,10,L.SURFACE,false);
        });
        expect(seen.length).toBeGreaterThan(1);expect(seen.every(t=>t===T.ANCIENT_SPIRIT_VINES)).toBe(true);
        expect(surface(g,18)).toBe(T.ANCIENT_SPIRIT_GRASS);
    });
});

describe('U08 terrain lifecycle, hold and consumers',()=>{
    it('player walking and magical placement promote vines, monsters keep them',()=>{
        const g=scene();set(g,19,T.ANCIENT_SPIRIT_VINES);g.player.loc={x:19,y:10};(g as any).handleSpecialTileEntry();
        expect(surface(g,19)).toBe(T.ANCIENT_SPIRIT_GRASS);
        set(g,20,T.ANCIENT_SPIRIT_VINES);expect(g.placeCreature(g.player,{x:20,y:10})).toBe(true);expect(surface(g,20)).toBe(T.ANCIENT_SPIRIT_GRASS);
        const m=mob(g,'rat',8);set(g,9,T.ANCIENT_SPIRIT_VINES);expect(g.placeCreature(m,{x:9,y:10})).toBe(true);expect(surface(g,9)).toBe(T.ANCIENT_SPIRIT_VINES);
    });
    it.each([T.WEB,T.ANCIENT_SPIRIT_VINES])('terrain %s holds ordinary monster, immune spider walks, breaking preserves floor and water',tile=>{
        const g=scene(),m=mob(g,'rat');set(g,8,tile);g.grid.setTerrainLayer(8,10,L.LIQUID,T.WATER_SHALLOW);
        vi.spyOn(rng,'randPercent').mockReturnValue(true);
        (m as any).tryMoveTo(9,10,g);expect(m.x).toBe(8);expect(surface(g,8)).toBe(T.NOTHING);
        expect(g.grid.getCell(8,10)!.layers[L.DUNGEON]).toBe(T.FLOOR);expect(g.grid.getCell(8,10)!.layers[L.LIQUID]).toBe(T.WATER_SHALLOW);
        m.behaviorFlags.add('MONST_IMMUNE_TO_WEBS');set(g,8,tile);(m as any).tryMoveTo(9,10,g);expect(m.x).toBe(9);expect(surface(g,8)).toBe(tile);
    });
    it('release clears only SURFACE even in a synthetic multi-layer entanglement',()=>{
        const g=scene();g.grid.setTerrainLayer(8,10,L.LIQUID,T.WEB);set(g,8,T.ANCIENT_SPIRIT_VINES);
        breakEntanglingTerrain(g.grid,8,10);expect(surface(g,8)).toBe(T.NOTHING);
        expect(g.grid.getCell(8,10)!.layers[L.LIQUID]).toBe(T.WEB);
    });
    it('a manually installed learnable vines bolt executes for an ally without spending learning points',()=>{
        const g=scene(),m=mob(g,'rat');m.isAlly=true;m.bolts=['ANCIENT_SPIRIT_VINES'];m.newPowerCount=2;
        m.behaviorFlags.add('MONST_ALWAYS_USE_ABILITY');const enemy=mob(g,'rat',15);
        expect(m.tryUseBolt(g)).toBe(true);expect(surface(g,enemy.x)).toBe(T.ANCIENT_SPIRIT_VINES);expect(m.newPowerCount).toBe(2);
    });
    it('gradual vines damage once, bypass shield, hurt web-immune/flying, exempt inanimate/invulnerable',()=>{
        const g=scene(),m=mob(g,'rat');m.hp=m.maxHp=150;m.applyShield(100);set(g,8,T.ANCIENT_SPIRIT_VINES);
        env(g,m);expect(m.hp).toBe(150); // instant contact, no gradual damage
        m.behaviorFlags.add('MONST_IMMUNE_TO_WEBS');m.setStatusDuration('levitating',100);env(g);expect(m.hp).toBe(140);expect(m.getStatusDuration('shielded')).toBe(100);
        g.grid.setTerrainLayer(8,10,L.GAS,T.POISON_GAS);env(g);expect(m.hp).toBe(130); // two damaging layers, once
        for(const flag of ['MONST_INANIMATE','MONST_INVULNERABLE']){m.behaviorFlags.add(flag);env(g);expect(m.hp).toBe(130);m.behaviorFlags.delete(flag);}
    });
    it('respiration also protects from vines and identifies; lethal monster damage uses ordinary cleanup',()=>{
        const g=scene();const armor=new Item('armor',']',0xffffff,ItemCategory.ARMOR);armor.runicType='respiration';g.player.equippedArmor=armor;
        set(g,18,T.ANCIENT_SPIRIT_VINES);env(g);expect(g.player.hp).toBe(150);expect(armor.runicKnown).toBe(true);
        const m=mob(g,'rat');m.hp=1;set(g,8,T.ANCIENT_SPIRIT_VINES);env(g);expect(m.hp).toBeLessThanOrEqual(0);(g as any).removeDeadMonsters();expect(g.monsters).not.toContain(m);
    });
    it('spontaneous promotion is <1000 out of 0..10000 and leaves non-promoting grass',()=>{
        const g=scene();set(g,8,T.ANCIENT_SPIRIT_VINES);
        const roll=vi.spyOn(rng,'randRange').mockReturnValue(1000);
        runPromotionUpdate(g.grid,{keyOnTileAt:()=>false});expect(surface(g,8)).toBe(T.ANCIENT_SPIRIT_VINES);
        roll.mockReturnValue(999);runPromotionUpdate(g.grid,{keyOnTileAt:()=>false});expect(surface(g,8)).toBe(T.ANCIENT_SPIRIT_GRASS);
        expect(TERRAIN_FLAGS[T.ANCIENT_SPIRIT_GRASS].promoteChance).toBe(0);
    });
    it.each([T.WEB,T.ANCIENT_SPIRIT_VINES,T.ANCIENT_SPIRIT_GRASS])('terrain %s burns to plain fire, with original base/liquid intact',tile=>{
        const g=scene();set(g,8,tile);g.environment.ignite(8,10);
        expect(surface(g,8)).toBe(T.PLAIN_FIRE);expect(g.grid.getCell(8,10)!.layers[L.DUNGEON]).toBe(T.FLOOR);
    });
    it('current snapshot retains new terrain/occupancy, next contact promotes and no learning is installed',()=>{
        const g=scene(),m=mob(g,'mangrove_dryad');set(g,12,T.ANCIENT_SPIRIT_VINES);set(g,13,T.ANCIENT_SPIRIT_GRASS);
        m.newPowerCount=2;const before=[...m.bolts];const snap=g.toSnapshot();const h=createHeadlessGame(2,'test');h.loadSnapshot(snap);
        expect(surface(h,12)).toBe(T.ANCIENT_SPIRIT_VINES);expect(surface(h,13)).toBe(T.ANCIENT_SPIRIT_GRASS);
        expect(h.monsters[0]!.bolts).toEqual(before);expect(h.monsters[0]!.newPowerCount).toBe(2);
        expect(h.placeCreature(h.player,{x:12,y:10})).toBe(true);expect(surface(h,12)).toBe(T.ANCIENT_SPIRIT_GRASS);
    });
});
