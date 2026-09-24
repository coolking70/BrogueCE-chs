import { afterEach, describe, expect, it, vi } from 'vitest';
import i18next from 'i18next';
import zh from '../locales/zh_CN.json';
import { createHeadlessGame } from './harness';
import type { Game } from '../engine/Core/Game';
import { Monster, MonsterState, specificallyValidBoltTarget, type MonsterData } from '../entities/Monster';
import monsters from '../data/monsters.json';
import { TerrainType as T, DungeonLayer } from '../engine/Map/Grid';
import { CEBoltType as B } from '../engine/Combat/BoltCatalog';
import * as absorption from '../engine/Combat/MonsterAbsorption';
import { anyoneWantABite, canAbsorb, corpseDistanceMap, updateMonsterCorpseAbsorption } from '../engine/Combat/MonsterAbsorption';
import { getBoltForItem } from '../engine/Combat/Bolt';
import { ItemLoader } from '../engine/Items/ItemLoader';
import { CombatSystem } from '../engine/Combat/Combat';
import { monsterBlinkAvoids } from '../engine/Combat/MonsterBlink';
import { generateMonsterDetail } from '../engine/UI/DetailGenerator';
import { logger } from '../engine/Systems/Logger';
import { rng } from '../engine/Random';

const data = (id = 'rat') => (monsters as MonsterData[]).find(d => d.id === id)!;
function scene() {
    const g = createHeadlessGame(1111, 'test');
    g.monsters = []; g.dormantMonsters = []; g.items = []; g.animationEnabled = false;
    for (let x = 0; x < g.grid.width; x++) for (let y = 0; y < g.grid.height; y++) {
        g.grid.setTerrain(x, y, !x || !y || x === g.grid.width-1 || y === g.grid.height-1 ? T.WALL : T.FLOOR);
        Object.assign(g.grid.getCell(x,y)!, {isVisible:true,hasMemory:true,hasDormantMonster:false,machineNumber:0});
    }
    g.player.loc = {x:4,y:8}; g.player.hp = g.player.maxHp = 1000;
    g.spawnFloatingText = vi.fn(); g.spawnBlood = vi.fn();
    return g;
}
function mob(g: Game, id = 'rat', x = 8, y = 8) {
    const m = new Monster(x,y,data(id));m.state=MonsterState.HUNTING;m.ticksUntilTurn=100;
    g.monsters.push(m);return m;
}
function learner(g: Game, x=8, y=8) {
    const m=mob(g,'rat',x,y);m.isAlly=true;
    const wand=ItemLoader.spawnWand('wand_of_empowerment',-1,-1)!;
    g.zapBoltFromPlayer(getBoltForItem('wand_of_empowerment')!,wand,m.loc);
    expect([m.newPowerCount,m.totalPowerCount]).toEqual([1,1]);return m;
}
const cleanup=(g:Game)=>(g as any).removeDeadMonsters();
function kill(g:Game,m:Monster) {m.takeDamage(m.hp,true);cleanup(g);}
const task=(m:Monster)=>({loc:m.targetCorpseLoc&&{...m.targetCorpseLoc},name:m.targetCorpseName,counter:m.corpseAbsorptionCounter,
    flag:m.absorptionFlags,behavior:m.absorbBehavior,bolt:m.absorptionBolt,absorbing:m.isAbsorbing,new:m.newPowerCount,total:m.totalPowerCount});
function finish(g:Game,m:Monster) {
    for(let n=0;!m.isAbsorbing&&n<19;n++)m.takeTurn(g,0);
    expect(m.isAbsorbing).toBe(true);expect(m.corpseAbsorptionCounter).toBe(20);
    for(let n=0;n<19;n++){m.takeTurn(g,0);expect(m.ticksUntilTurn).toBe(100);expect(m.newPowerCount).toBe(1);}
    expect(m.corpseAbsorptionCounter).toBe(1);m.takeTurn(g,0);
    expect([m.newPowerCount,m.totalPowerCount,m.isAbsorbing,m.targetCorpseLoc,m.ticksUntilTurn]).toEqual([0,1,false,null,100]);
}
function assign(g:Game,m:Monster,flag='MONST_FLIES',counter=20) {
    Object.assign(m,{targetCorpseLoc:{...m.loc},targetCorpseName:'corpse',absorptionFlags:flag,absorbBehavior:flag.startsWith('MONST'),
        absorptionBolt:B.NONE,corpseAbsorptionCounter:counter,isAbsorbing:true});return g;
}
afterEach(()=>{vi.restoreAllMocks();i18next.changeLanguage('en');});

describe('U11 CE two-pass selection, scratch array and actual distance maps',()=>{
    it.each([
        [2,20,2,1,1,'B',2], [2,20,2,1,2,'none',1],
        [20,2,2,1,1,'A',2], [2,20,2,0,1,'none',1],
    ] as const)('last-map fixture %j', (aOwn,bA,bOwn,bSlots,draw,selected,calls)=>{
        const g=scene(),a=learner(g),b=mob(g,'rat',9);b.isAlly=true;b.newPowerCount=bSlots;
        const prey=mob(g,'centipede',10);prey.hp=0;
        const distances=vi.fn((_g:Game,m:Monster)=>{
            const map=Array.from({length:g.grid.width},()=>Array(g.grid.height).fill(30000));
            map[a.x]![a.y]=m===a?aOwn:bA;map[b.x]![b.y]=bOwn;return map;
        });
        const random=vi.spyOn(rng,'randRange').mockReturnValueOnce(draw).mockReturnValue(1);
        expect(anyoneWantABite(g,prey,distances)).toBe(selected!=='none');
        expect(distances).toHaveBeenCalledTimes(2);expect(random).toHaveBeenCalledTimes(calls);
        expect(random.mock.calls[0]).toEqual([1,aOwn<=10?1+bSlots:1]);
        expect(a.targetCorpseLoc!==null).toBe(selected==='A');expect(b.targetCorpseLoc!==null).toBe(selected==='B');
    });
    it('scratch only rebuilds for a qualified bolt branch; a busy last ally still overwrites the map',()=>{
        const g=scene(),m=learner(g),prey=mob(g,'centipede',9),map=corpseDistanceMap(g,m,prey.loc),scratch=new Set([B.FIRE]);
        expect(canAbsorb(g,m,scratch,prey,map)).toBe(true);expect([...scratch]).toEqual([B.FIRE]);
        prey.abilityFlags.clear();prey.bolts=['FIRE'];m.bolts=['SPARK'];
        expect(canAbsorb(g,m,scratch,prey,map)).toBe(true);expect([...scratch]).toEqual([B.SPARK]);
        m.newPowerCount=0;expect(canAbsorb(g,m,scratch,prey,map)).toBe(false);expect([...scratch]).toEqual([B.SPARK]);
        m.newPowerCount=1;const busy=mob(g,'rat',10);busy.isAlly=true;busy.targetCorpseLoc={x:3,y:3};busy.newPowerCount=1;
        const maps=vi.fn((_g:Game,a:Monster)=>Array.from({length:g.grid.width},()=>Array(g.grid.height).fill(a===busy?20:2)));
        expect(anyoneWantABite(g,prey,maps)).toBe(false);expect(maps).toHaveBeenCalledTimes(2);
    });
    it.each(['no-slot','busy','not-ally','inanimate','immobile','turret','far','avoided'] as const)('eligibility rejects %s without a lottery',kind=>{
        const g=scene(),m=learner(g),prey=mob(g,'centipede',9);prey.hp=0;
        if(kind==='no-slot')m.newPowerCount=0;if(kind==='busy')m.targetCorpseLoc={x:7,y:7};if(kind==='not-ally')m.isAlly=false;
        if(['inanimate','immobile','turret'].includes(kind))m.behaviorFlags.add(`MONST_${kind.toUpperCase()}`);
        if(kind==='far')prey.loc={x:25,y:8};if(kind==='avoided')g.grid.setTerrain(prey.x,prey.y,T.WATER_DEEP);
        const spy=vi.spyOn(rng,'randRange');expect(anyoneWantABite(g,prey)).toBe(false);expect(spy).not.toHaveBeenCalled();
    });
    it.each(['rat','arrow_turret','spectral_sword','spectral-image-without-flags','wall','unlearnable-bolts'])( 'corpse early/empty-pool rejection: %s',kind=>{
        const g=scene();learner(g);const prey=mob(g,['wall','unlearnable-bolts','spectral-image-without-flags'].includes(kind)?'rat':kind,9);
        if(kind==='spectral-image-without-flags'){prey.typeId='spectral_sword';prey.bolts=['FIRE'];}
        if(kind==='wall'){prey.bolts=['FIRE'];g.grid.setTerrain(prey.x,prey.y,T.WALL);}
        if(kind==='unlearnable-bolts')prey.bolts=['PLENTY','EMPOWERMENT','SPIDERWEB','DRAGONFIRE','DISTANCE_ATTACK','POISON_DART','WHIP'];
        const spy=vi.spyOn(rng,'randRange');expect(anyoneWantABite(g,prey)).toBe(false);expect(spy).not.toHaveBeenCalled();
    });
    it.each([10,11])('real eight-way distance cutoff %i, no visibility condition',distance=>{
        const g=scene(),m=learner(g),prey=mob(g,'centipede',m.x+distance);g.grid.getCell(prey.x,prey.y)!.isVisible=false;
        expect(corpseDistanceMap(g,m,prey.loc)[m.x]![m.y]).toBe(distance);
        expect(anyoneWantABite(g,prey)).toBe(distance===10);
    });
    it('distance uses permanent flags, secret doors, diagonal obstructions and stationary immune occupants',()=>{
        const g=scene(),m=learner(g,8,8),prey=mob(g,'centipede',10,8);
        for(let y=1;y<g.grid.height-1;y++)g.grid.setTerrain(9,y,T.WATER_DEEP);
        expect(corpseDistanceMap(g,m,prey.loc)[m.x]![m.y]).toBe(30000);
        m.setStatusDuration('levitating',100);expect(corpseDistanceMap(g,m,prey.loc)[m.x]![m.y]).toBe(30000);
        m.behaviorFlags.add('MONST_FLIES');expect(corpseDistanceMap(g,m,prey.loc)[m.x]![m.y]).toBe(2);
        for(let y=1;y<g.grid.height-1;y++)g.grid.setTerrain(9,y,T.WALL);
        g.grid.setTerrain(9,8,T.SECRET_DOOR);expect(corpseDistanceMap(g,m,prey.loc)[m.x]![m.y]).toBe(2);
        const guard=mob(g,'stone_guardian',9,8);expect(guard.isImmuneToWeapons()).toBe(true);
        expect(corpseDistanceMap(g,m,prey.loc)[m.x]![m.y]).toBe(30000);
    });
    it.each(['MA_TRANSFERENCE','MA_CAUSES_WEAKNESS','MONST_INVISIBLE','MONST_FLIES','MONST_IMMUNE_TO_FIRE','MONST_REFLECT_50'])('flag lottery bit order selects %s ahead of every bolt',selected=>{
        const g=scene(),m=learner(g),prey=mob(g,'rat',9);
        const flags=['MA_TRANSFERENCE','MA_CAUSES_WEAKNESS','MONST_INVISIBLE','MONST_FLIES','MONST_IMMUNE_TO_FIRE','MONST_REFLECT_50'];
        prey.abilityFlags=new Set(flags.slice(0,2));prey.behaviorFlags=new Set(flags.slice(2));prey.bolts=['BLINKING','FIRE'];
        const spy=vi.spyOn(rng,'randRange').mockReturnValueOnce(1).mockReturnValueOnce(flags.indexOf(selected)+1);
        expect(anyoneWantABite(g,prey)).toBe(true);expect(m.absorptionFlags).toBe(selected);expect(m.absorptionBolt).toBe(B.NONE);
        expect(spy.mock.calls).toEqual([[1,1],[1,6]]);
    });
    it('bolt lottery preserves corpse order, removes owned/nonlearnable entries and rebuilds ourBolts for the winner',()=>{
        const g=scene(),m=learner(g),prey=mob(g,'rat',9);m.bolts=['FIRE'];
        prey.bolts=['WHIP','FIRE','ANCIENT_SPIRIT_VINES','BLINKING'];
        const spy=vi.spyOn(rng,'randRange').mockReturnValueOnce(1).mockReturnValueOnce(2);
        expect(anyoneWantABite(g,prey)).toBe(true);expect(m.absorptionBolt).toBe(B.BLINKING);expect(spy.mock.calls).toEqual([[1,1],[1,2]]);
    });
    it.each(['TELEPORT','SLOW','POLYMORPH','NEGATION','DOMINATION','BECKONING','INVISIBILITY','LIGHTNING','FIRE','POISON',
        'TUNNELING','BLINKING','ENTRANCEMENT','OBSTRUCTION','DISCORD','CONJURATION','HEALING','HASTE','SLOW_2','SHIELDING','SPARK','ANCIENT_SPIRIT_VINES'] as const)
        ('all22 CE learnable identities survive selection and installation: %s',power=>{
            const g=scene(),m=learner(g),prey=mob(g,'rat',9);prey.bolts=[power];kill(g,prey);
            expect(m.absorptionBolt).toBe(B[power]);finish(g,m);expect(m.bolts).toEqual([power]);
        });
    it('a player clone retains MK_YOU, so an acquired power on its corpse is learnable',()=>{
        const g=scene(),m=learner(g),prey=Monster.copyPlayerForClone(g.player);prey.loc={x:9,y:8};prey.bolts=['FIRE'];g.monsters.push(prey);
        kill(g,prey);expect(m.absorptionBolt).toBe(B.FIRE);
    });
});

describe('U11 actual death chain, walking, twenty actions and usable powers',()=>{
    it.each(['BLINKING','ANCIENT_SPIRIT_VINES','FIRE','TUNNELING','OBSTRUCTION'])('empower → real lethal hit → walk → learn %s → consumer',power=>{
        const g=scene(),m=learner(g),prey=mob(g,power==='BLINKING'?'imp':power==='ANCIENT_SPIRIT_VINES'?'mangrove_dryad':'rat',10);
        if(!['BLINKING','ANCIENT_SPIRIT_VINES'].includes(power))prey.bolts=[power];
        kill(g,prey);expect(m.targetCorpseLoc).toEqual({x:10,y:8});expect(m.isAbsorbing).toBe(false);expect(m.bolts).not.toContain(power);
        finish(g,m);expect(m.bolts).toContain(power);expect(g.monsters).not.toContain(prey);
        m.behaviorFlags.add('MONST_ALWAYS_USE_ABILITY');
        if(power==='BLINKING'){
            g.player.loc={x:28,y:8};g.scent.update(g.grid,28,8,Array.from({length:g.grid.width},()=>Array(g.grid.height).fill(true)));
            const before=m.x;m.takeTurn(g,0);expect(m.x).toBeGreaterThan(before+1);
        } else {
            const target=mob(g,'ogre',14);target.hp=target.maxHp=100;
            if(power==='ANCIENT_SPIRIT_VINES'){
                m.takeTurn(g,0);expect(g.grid.getCell(target.x,target.y)!.layers[DungeonLayer.SURFACE]).toBe(T.ANCIENT_SPIRIT_VINES);
            } else if(power==='FIRE') {m.takeTurn(g,0);expect(target.hp).toBeLessThan(100);}
            else {const cast=vi.spyOn(g,'castMonsterBolt');expect(specificallyValidBoltTarget(m,target,power,g)).toBe(false);m.takeTurn(g,0);expect(cast).not.toHaveBeenCalled();}
        }
    });
    it.each(['MA_TRANSFERENCE','MA_CAUSES_WEAKNESS','MONST_INVISIBLE','MONST_FLIES','MONST_IMMUNE_TO_FIRE','MONST_REFLECT_50'])('learned %s reaches its actual consumer',power=>{
        const g=scene(),m=learner(g),prey=mob(g,'rat',10);
        (power.startsWith('MA_')?prey.abilityFlags:prey.behaviorFlags).add(power);
        kill(g,prey);finish(g,m);
        if(power.startsWith('MA_')){
            const target=mob(g,'ogre',11);target.hp=target.maxHp=100;m.damageString='10';m.accuracy=10000;m.hp=5;
            vi.spyOn(rng,'randPercent').mockReturnValue(true);CombatSystem.attack(m,target,{isWeaponAttack:true});
            if(power==='MA_TRANSFERENCE')expect(m.hp).toBe(9);else expect([target.weaknessAmount,target.getStatusDuration('weakened')]).toEqual([1,300]);
        } else if(power==='MONST_FLIES'){
            g.player.loc={x:16,y:8};for(let x=11;x<=13;x++)g.grid.setTerrain(x,8,T.WATER_DEEP);
            expect(m.getStatusDuration('levitating')).toBe(1000);expect(monsterBlinkAvoids(g,m,{x:11,y:8})).toBe(false);
            m.takeTurn(g,0);expect(m.loc).toEqual({x:11,y:8});(g as any).applyEnvironmentalEffects(m);expect(m.hp).toBeGreaterThan(0);
        } else if(power==='MONST_IMMUNE_TO_FIRE'){
            const enemy=mob(g,'rat',14),hp=m.hp;g.castMonsterBolt(enemy,m,'FIRE');expect(m.hp).toBe(hp);expect(m.getStatusDuration('immune_fire')).toBe(1000);
        } else if(power==='MONST_INVISIBLE'){
            const enemy=mob(g,'ogre',14);expect(specificallyValidBoltTarget(enemy,m,'FIRE',g)).toBe(true);
            enemy.bolts=['FIRE'];enemy.behaviorFlags.add('MONST_ALWAYS_USE_ABILITY');g.player.setStatusDuration('invisible',20);expect(enemy.tryUseBolt(g)).toBe(false); // general invisibility gate, no target is cast upon
            expect(m.isTrulyInvisible()).toBe(true);m.tickStatuses();expect(m.getStatusDuration('invisible')).toBe(1000);
        } else {
            expect(m.reflectChance()).toBe(48);const enemy=mob(g,'ogre',14);enemy.hp=enemy.maxHp=100;
            vi.spyOn(rng,'randPercent').mockReturnValue(true);const hp=m.hp,result=g.castMonsterBolt(enemy,m,'FIRE')!;
            expect(result.reflections.length).toBeGreaterThan(0);expect(m.hp).toBe(hp);expect(enemy.hp).toBeLessThan(100);
        }
    });
    it('real player strike and monster attack, poison and burning deaths all reach allocation exactly once',()=>{
        for(const cause of ['player','monster','poison','burning']){
            const g=scene(),m=learner(g,6,8),prey=mob(g,'centipede',5,8);prey.hp=1;
            if(cause==='player'){vi.spyOn(rng,'randPercent').mockReturnValue(true);g.handlePlayerAction('move',{x:1,y:0});}
            if(cause==='monster'){m.accuracy=10000;m.damageString='100';vi.spyOn(rng,'randPercent').mockReturnValue(true);m.takeTurn(g,0);cleanup(g);}
            if(cause==='poison'){prey.addPoison(5,2);(g as any).tickCreatureStatuses();cleanup(g);}
            if(cause==='burning'){(prey.statusDurations as Record<string,number>).burning=5;(g as any).tickCreatureStatuses();cleanup(g);}
            expect(prey.hp,cause).toBeLessThanOrEqual(0);expect(prey.deathProcessed,cause).toBe(true);expect(m.targetCorpseLoc,cause).toEqual({x:5,y:8});
            const spy=vi.spyOn(rng,'randRange');const before=task(m);cleanup(g);cleanup(g);expect(task(m)).toEqual(before);expect(spy).not.toHaveBeenCalled();vi.restoreAllMocks();
        }
    });
    it('DF executes before learning; two deaths at the same square are distinct; a saved processed corpse never reassigns',()=>{
        const g=scene(),a=learner(g),b=mob(g,'rat',9);b.isAlly=true;b.newPowerCount=1;
        const prey=mob(g,'bloat',10);kill(g,prey);expect(prey.deathEffectTriggered).toBe(true);expect(prey.deathProcessed).toBe(true);
        expect([a.targetCorpseLoc,b.targetCorpseLoc]).toEqual([null,null]); // poison DF makes its own corpse avoided
        g.grid.setTerrainLayer(10,8,DungeonLayer.GAS,T.NOTHING);
        const first=mob(g,'centipede',10);kill(g,first);const remaining=[a,b].find(m=>!m.targetCorpseLoc)!;const other=mob(g,'centipede',10);kill(g,other);expect(remaining.targetCorpseLoc).toEqual({x:10,y:8});
        a.targetCorpseLoc=b.targetCorpseLoc=null;g.monsters.push(prey);
        const snapshot=JSON.parse(JSON.stringify(g.toSnapshot()));g.loadSnapshot(snapshot);const spy=vi.spyOn(rng,'randRange');cleanup(g);expect(spy).not.toHaveBeenCalled();
    });
    it('dormant / administrative detached removals give no task; release occurs before host allocation',()=>{
        const g=scene(),m=learner(g),d=mob(g,'centipede',10);d.isDormant=true;kill(g,d);expect(m.targetCorpseLoc).toBeNull();
        const discarded=mob(g,'centipede',10);g.monsters=g.monsters.filter(a=>a!==discarded);cleanup(g);expect(m.targetCorpseLoc).toBeNull();
        m.newPowerCount=0;const host=mob(g,'centipede',10),passenger=new Monster(1,1,data());passenger.isAlly=true;passenger.newPowerCount=1;
        host.carriedMonster=passenger;kill(g,host);expect(g.monsters).toContain(passenger);expect(passenger.ticksUntilTurn).toBe(200);expect(passenger.loc).toEqual({x:10,y:8});expect(passenger.targetCorpseLoc).toEqual(host.loc);
    });
    it('a passenger killed by its landing resolves its own death before the host selects a learner',()=>{
        const g=scene(),m=learner(g),host=mob(g,'centipede',10),passenger=new Monster(1,1,data());
        m.setStatusDuration('immune_fire',50);passenger.bolts=['FIRE'];host.carriedMonster=passenger;g.grid.setTerrain(10,8,T.LAVA);
        kill(g,host);expect(passenger.hp).toBeLessThanOrEqual(0);expect(passenger.deathProcessed).toBe(true);
        expect(m.absorptionBolt).toBe(B.FIRE);expect(m.absorptionFlags).toBeNull();expect(host.carriedMonster).toBeNull();
    });
});

describe('U11 interruption, lifecycle, timing, priority, progress and messages',()=>{
    it.each(['poisoned','burning','fire-immune'])('start gate %s does not discard the selected corpse',mode=>{
        const g=scene(),m=learner(g),prey=mob(g,'centipede',10);kill(g,prey);m.loc={x:10,y:8};
        if(mode==='poisoned')m.setStatusDuration('poisoned',10);else (m.statusDurations as Record<string,number>).burning=10;
        if(mode==='fire-immune')m.setStatusDuration('immune_fire',20);m.takeTurn(g,0);
        expect(m.isAbsorbing).toBe(mode==='fire-immune');expect(m.targetCorpseLoc).not.toBeNull();expect(m.newPowerCount).toBe(1);
    });
    it.each([17,16])('leaving while counter=%i decrements then checks <=15',counter=>{
        const g=scene(),m=learner(g);assign(g,m,'MONST_FLIES',counter);m.loc.x++;
        expect(updateMonsterCorpseAbsorption(g,m)).toBe(false);expect(m.corpseAbsorptionCounter).toBe(counter-1);expect(m.isAbsorbing).toBe(false);
        expect(m.targetCorpseLoc===null).toBe(counter===16);expect(m.absorptionFlags===null).toBe(counter===16);expect(m.newPowerCount).toBe(1);
    });
    it('damage fully blocked by shield interrupts; restarting resets20 without reroll/refund; zero/invulnerability do not interrupt',()=>{
        const g=scene(),m=learner(g);assign(g,m,'MONST_FLIES',7);m.applyShield(1000);const hp=m.hp;
        m.takeDamage(1);expect(m.hp).toBe(hp);expect(m.isAbsorbing).toBe(false);const spy=vi.spyOn(rng,'randRange');m.takeTurn(g,0);
        expect(m.corpseAbsorptionCounter).toBe(20);expect(m.isAbsorbing).toBe(true);expect(spy).not.toHaveBeenCalled();
        m.takeDamage(0);expect(m.isAbsorbing).toBe(true);m.behaviorFlags.add('MONST_INVULNERABLE');m.takeDamage(1);expect(m.isAbsorbing).toBe(true);
    });
    it('expiry clears only the CE task fields, leaves name/behavior/new and never rebroadcasts; null target with lingering absorption expires',()=>{
        const g=scene(),m=learner(g);assign(g,m,'MONST_FLIES',1);m.targetCorpseLoc=null;
        updateMonsterCorpseAbsorption(g,m);expect(task(m)).toEqual({loc:null,name:'corpse',counter:0,flag:null,behavior:true,bolt:B.NONE,absorbing:false,new:1,total:1});
        m.takeTurn(g,0);expect(m.corpseAbsorptionCounter).toBe(-1);m.takeTurn(g,0);expect(m.corpseAbsorptionCounter).toBe(-1);
    });
    it('a blocked twenty-action approach times out without spending or redistributing the corpse',()=>{
        const g=scene(),m=learner(g),prey=mob(g,'centipede',10);kill(g,prey);m.setStatusDuration('poisoned',50);
        const other=mob(g,'rat',11);other.isAlly=true;other.newPowerCount=1;
        for(let n=0;n<20;n++)m.takeTurn(g,0);
        expect(m.targetCorpseLoc).toBeNull();expect(m.newPowerCount).toBe(1);expect(m.absorptionFlags).toBeNull();expect(other.targetCorpseLoc).toBeNull();
    });
    it('bolt takes precedence over residual flag; completion synchronizes all current permanent traits and retains name/behavior',()=>{
        const g=scene(),m=learner(g);assign(g,m,'MONST_REFLECT_50',1);m.absorptionBolt=B.FIRE;
        for(const f of ['MONST_FIERY','MONST_FLIES','MONST_INVISIBLE','MONST_RESTRICTED_TO_LIQUID','MONST_SUBMERGES'])m.behaviorFlags.add(f);
        m.takeTurn(g,0);expect(m.bolts).toEqual(['FIRE']);expect(m.hasBehavior('MONST_REFLECT_50')).toBe(false);expect(m.hasBehavior('MONST_RESTRICTED_TO_LIQUID')).toBe(false);expect(m.hasBehavior('MONST_SUBMERGES')).toBe(false);
        expect(m.statusDurations).toMatchObject({burning:1000,levitating:1000,invisible:1000});expect([m.targetCorpseName,m.absorbBehavior,m.absorptionFlags,m.absorptionBolt]).toEqual(['corpse',true,null,B.NONE]);
    });
    it('save at13 reloads without reselect/reset; the next13 actions finish once',()=>{
        const g=scene(),m=learner(g);assign(g,m,'MONST_FLIES',13);const before=task(m);
        const snapshot=JSON.parse(JSON.stringify(g.toSnapshot()));const spy=vi.spyOn(absorption,'anyoneWantABite');expect(g.loadSnapshot(snapshot)).toBe(true);expect(spy).not.toHaveBeenCalled();
        const loaded=g.monsters[0]!;expect(task(loaded)).toEqual(before);
        for(let i=0;i<12;i++)loaded.takeTurn(g,0);expect(loaded.newPowerCount).toBe(1);loaded.takeTurn(g,0);expect(loaded.newPowerCount).toBe(0);expect(loaded.hasBehavior('MONST_FLIES')).toBe(true);
    });
    it('negation preserves a pending task and refunds total; completion can reinstall it; polymorph preserves task',()=>{
        const g=scene(),m=learner(g);assign(g,m,'MONST_FLIES',1);m.totalPowerCount=3;m.newPowerCount=0;const before=task(m);
        (g as any).negateCreatureMagic(m);expect(task(m)).toEqual({...before,new:3});m.takeTurn(g,0);expect(m.newPowerCount).toBe(2);expect(m.hasBehavior('MONST_FLIES')).toBe(true);
        assign(g,m,'MA_TRANSFERENCE',2);const pending=task(m);m.polymorph(()=>{});expect(task(m)).toEqual(pending);m.takeTurn(g,0);m.takeTurn(g,0);expect(m.hasAbility('MA_TRANSFERENCE')).toBe(true);
    });
    it('clone copies task by value; return before16 can duplicate learning as CE permits, without a global token',()=>{
        const g=scene(),m=learner(g);assign(g,m,'MONST_FLIES',20);const clone=m.copyForClone();clone.loc.x++;g.monsters.push(clone);
        expect(clone.targetCorpseLoc).toEqual(m.targetCorpseLoc);expect(clone.targetCorpseLoc).not.toBe(m.targetCorpseLoc);
        updateMonsterCorpseAbsorption(g,clone);expect(clone.isAbsorbing).toBe(false);expect(clone.targetCorpseLoc).not.toBeNull();
        // A displacement may stack the tasks in time; CE does not consume a corpse item.
        clone.loc={...m.loc};m.loc.y++;m.isAbsorbing=false;clone.takeTurn(g,0);expect(clone.corpseAbsorptionCounter).toBe(20);
        for(let i=0;i<20;i++)clone.takeTurn(g,0);expect(clone.newPowerCount).toBe(0);clone.loc.y++;
        m.loc={...m.targetCorpseLoc!};m.takeTurn(g,0);for(let i=0;i<20;i++)m.takeTurn(g,0);expect(m.newPowerCount).toBe(0);
    });
    it('level change clears only location; next action clears ongoing bit then expires the residual task',()=>{
        const g=scene(),m=learner(g);assign(g,m,'MONST_FLIES',16);m.clearCorpseTargetOnLevelChange();
        expect(m.isAbsorbing).toBe(true);m.takeTurn(g,0);expect(m.isAbsorbing).toBe(false);expect(m.absorptionFlags).toBeNull();expect(m.newPowerCount).toBe(1);
    });
    it.each(['paralyzed','entranced','caged','activation'])('real scheduler withholds %s absorption actions',state=>{
        const g=scene(),m=learner(g);assign(g,m);if(state==='caged')m.isCaged=true;else if(state==='activation')m.behaviorFlags.add('MONST_GETS_TURN_ON_ACTIVATION');else m.setStatusDuration(state as 'paralyzed'|'entranced',50);
        for(let i=0;i<3;i++)g.handlePlayerAction('wait');expect(m.corpseAbsorptionCounter).toBe(20);expect(m.newPowerCount).toBe(1);
    });
    it('normal scheduler consumes exactly20 actions at100 ticks even for a fast learner; completion does not move',()=>{
        const g=scene(),m=learner(g);assign(g,m);m.movementSpeed=50;m.ticksUntilTurn=100;
        for(let i=0;i<19;i++)g.handlePlayerAction('wait');expect(m.corpseAbsorptionCounter).toBe(1);expect(m.newPowerCount).toBe(1);
        g.handlePlayerAction('wait');expect(m.newPowerCount).toBe(0);expect(m.loc).toEqual({x:8,y:8});
    });
    it('poison acquired during absorption is not a second start gate; direct monstersTurn updates before inner paralysis',()=>{
        const g=scene(),m=learner(g);assign(g,m,'MONST_FLIES',2);m.setStatusDuration('poisoned',20);m.setStatusDuration('paralyzed',20);
        m.takeTurn(g,0);m.takeTurn(g,0);expect(m.newPowerCount).toBe(0);
    });
    it('corpse outranks following/blink-follow, but magic, nearby combat and escaping hazards outrank corpse',()=>{
        const g=scene(),m=learner(g),prey=mob(g,'centipede',10);kill(g,prey);m.bolts=['BLINKING'];g.player.loc={x:30,y:8};
        m.takeTurn(g,0);expect(m.loc).toEqual({x:9,y:8});
        const enemy=mob(g,'ogre',10,9);enemy.hp=enemy.maxHp=100;g.player.loc={x:8,y:7};m.bolts=['FIRE'];m.behaviorFlags.add('MONST_ALWAYS_USE_ABILITY');
        m.takeTurn(g,0);expect(enemy.hp).toBeLessThan(100);expect(m.isAbsorbing).toBe(false);
        m.bolts=[];m.takeTurn(g,0);expect(m.isAbsorbing).toBe(false);expect(m.loc).toEqual({x:9,y:8});
        g.monsters=g.monsters.filter(a=>a!==enemy);g.grid.setTerrain(m.x,m.y,T.PLAIN_FIRE);m.takeTurn(g,0);expect(m.isAbsorbing).toBe(false);expect(m.loc).not.toEqual({x:9,y:8});
    });
    it('absorbing friend blocks walking; no implicit corpse-item disappearance or rediscovery check',()=>{
        const g=scene(),m=learner(g),prey=mob(g,'centipede',10);kill(g,prey);const blocker=mob(g,'rat',9);blocker.isAlly=true;assign(g,blocker);
        m.takeTurn(g,0);expect(blocker.loc).toEqual({x:9,y:8});expect(m.loc).not.toEqual(blocker.loc);
        g.monsters=g.monsters.filter(a=>a!==blocker);finish(g,m);expect(m.hasAbility('MA_CAUSES_WEAKNESS')).toBe(true);
    });
    it.each(['en','zh_CN'])('detail progress and completion messages follow actual learning in %s',async lng=>{
        const g=scene(),m=learner(g);i18next.addResourceBundle('zh_CN','translation',zh,true,true);await i18next.changeLanguage(lng);
        const prey=mob(g,'centipede',9);kill(g,prey);m.takeTurn(g,0);
        const details=()=>generateMonsterDetail(m,30,12,0,null,0,12).sections.flatMap(s=>s.lines);
        expect(details().find(l=>l.progress)?.progress).toEqual({value:20,max:20});m.takeTurn(g,0);expect(details().find(l=>l.progress)?.progress?.value).toBe(19);
        for(let i=0;i<19;i++)m.takeTurn(g,0);expect(details().some(l=>l.progress)).toBe(false);
        const logs=logger.messages.map(l=>l.text).join('\n');expect(logs).toContain(lng==='en'?'begins gnawing at the fallen':'开始啃咬');expect(logs).toContain(lng==='en'?'finished gnawing at':'完毕');expect(logs).toContain(lng==='en'?'now saps strength':'现在造成伤害时会削弱');
    });
    it('lottery boundary calls versus actual RNG advancement: singleton0, multiple2; absorption0',()=>{
        const g=scene(),m=learner(g),prey=mob(g,'centipede',9);const before=rng.randomNumbersGenerated;
        kill(g,prey);expect(rng.randomNumbersGenerated).toBe(before);m.loc={...m.targetCorpseLoc!};m.takeTurn(g,0);
        const started=rng.randomNumbersGenerated;for(let i=0;i<20;i++)m.takeTurn(g,0);expect(rng.randomNumbersGenerated).toBe(started);
        m.newPowerCount=1;const b=mob(g,'rat',9);b.isAlly=true;b.newPowerCount=1;const dead=mob(g,'rat',10);dead.abilityFlags=new Set(['MA_TRANSFERENCE','MA_CAUSES_WEAKNESS']);
        // Ensure both allies lack both entries after the first learner acquired weakness.
        m.abilityFlags.clear();const count=rng.randomNumbersGenerated;kill(g,dead);expect(rng.randomNumbersGenerated-count).toBe(2);
    });
});
