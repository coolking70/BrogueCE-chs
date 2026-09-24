import fs from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHeadlessGame } from './harness';
import { Game } from '../engine/Core/Game';
import { Monster, MonsterState, specificallyValidBoltTarget, type MonsterData } from '../entities/Monster';
import { Creature, PERMANENT_STATUS_DURATION } from '../entities/Creature';
import monsters from '../data/monsters.json';
import { TerrainType as T } from '../engine/Map/Grid';
import { MONSTER_BOLT_TABLE } from '../engine/Combat/Bolt';
import { CEBoltType as B, CEBoltFlags as F, CE_BOLT_CATALOG } from '../engine/Combat/BoltCatalog';
import { CombatSystem } from '../engine/Combat/Combat';
import { reflectionChance } from '../engine/Combat/CombatFormulas';
import { rng } from '../engine/Random';

// Independent literals from Rogue.h LEARNABLE_* and GlobalsBrogue.c:61-89.
const learnedBolts = [
    ['TELEPORT',10], ['SLOW',10], ['POLYMORPH',10], ['NEGATION',10], ['DOMINATION',10],
    ['BECKONING',10], ['INVISIBILITY',10], ['LIGHTNING',10], ['FIRE',4], ['POISON',10],
    ['TUNNELING',10], ['BLINKING',5], ['ENTRANCEMENT',10], ['OBSTRUCTION',10], ['DISCORD',10],
    ['CONJURATION',10], ['HEALING',5], ['HASTE',2], ['SLOW_2',2], ['SHIELDING',5], ['SPARK',1],
    ['ANCIENT_SPIRIT_VINES',5],
] as const;
const added = ['TELEPORT','SLOW','POLYMORPH','DOMINATION','INVISIBILITY','LIGHTNING','POISON','ENTRANCEMENT','CONJURATION'];
const data = (id = 'rat') => (monsters as MonsterData[]).find(m => m.id === id)!;
function scene() {
    const g = createHeadlessGame(9009, 'test');
    g.monsters = []; g.dormantMonsters = []; g.items = []; g.animationEnabled = false;
    for (let x=0; x<g.grid.width; x++) for (let y=0; y<g.grid.height; y++) {
        g.grid.setTerrain(x,y, x===0 || y===0 || x===g.grid.width-1 || y===g.grid.height-1 ? T.WALL : T.FLOOR);
        Object.assign(g.grid.getCell(x,y)!, { isVisible:true, hasDormantMonster:false, machineNumber:0 });
    }
    g.player.loc = {x:4,y:9}; g.player.hp = g.player.maxHp = 1000;
    g.spawnFloatingText = vi.fn(); g.spawnBlood = vi.fn();
    return g;
}
function mob(g:Game, x=12, id='rat', y=5) {
    const m = new Monster(x,y,data(id)); m.hp = m.maxHp = 100;
    m.state = MonsterState.HUNTING; g.monsters.push(m); return m;
}
const negate = (g:Game,m:Creature) => (g as unknown as {negateCreatureMagic(m:Creature):boolean}).negateCreatureMagic(m);
afterEach(() => vi.restoreAllMocks());

describe('U09 complete learning eligibility / negation / execution identity matrix', () => {
    it('CE masks are exactly four behaviors and two abilities; no TURRET, FIERY, POISONS or reflection100', () => {
        const source=fs.readFileSync('../BrogueCE-master/src/brogue/Rogue.h','utf8');
        const bits=(key:string)=>source.match(new RegExp(`${key}\\s*=\\s*\\(([^)]+)\\)`))![1]!.match(/\b(?:MONST|MA)_\w+/g);
        expect(bits('LEARNABLE_BEHAVIORS')).toEqual(['MONST_INVISIBLE','MONST_FLIES','MONST_IMMUNE_TO_FIRE','MONST_REFLECT_50']);
        expect(bits('LEARNABLE_ABILITIES')).toEqual(['MA_TRANSFERENCE','MA_CAUSES_WEAKNESS']);
        expect(bits('MONST_TURRET')).toEqual(['MONST_IMMUNE_TO_WEBS','MONST_NEVER_SLEEPS','MONST_IMMOBILE','MONST_INANIMATE','MONST_ATTACKABLE_THRU_WALLS','MONST_WILL_NOT_USE_STAIRS']);
    });
    it('all 22 learnable identities have metadata; the seven unlearnable entries stay excluded', () => {
        const actual=Object.values(CE_BOLT_CATALOG).filter(b=>b.type!==B.NONE && !(b.flags&F.NOT_LEARNABLE));
        expect(actual.map(b=>[B[b.type],b.magnitude])).toEqual(learnedBolts);
        for (const [name,magnitude] of learnedBolts) {
            expect(MONSTER_BOLT_TABLE[name]).toMatchObject({ceType:B[name],magnitude});
            expect(MONSTER_BOLT_TABLE[name]!.effect).not.toBeNull();
        }
        expect(Object.values(CE_BOLT_CATALOG).filter(b=>b.flags&F.NOT_LEARNABLE).map(b=>B[b.type]))
            .toEqual(['PLENTY','EMPOWERMENT','SPIDERWEB','DRAGONFIRE','DISTANCE_ATTACK','POISON_DART','WHIP']);
    });
    it.each(learnedBolts)('%s is erased by negation and CE refunds all learning slots', (name) => {
        const g=scene(),m=mob(g); m.bolts=[name]; m.newPowerCount=3; m.totalPowerCount=4;
        expect(CE_BOLT_CATALOG[B[name]].flags&F.NOT_NEGATABLE).toBe(0);
        expect(negate(g,m)).toBe(true); expect(m.bolts).toEqual([]);
        expect([m.newPowerCount,m.totalPowerCount]).toEqual([4,4]);
    });
    it.each(['TUNNELING','OBSTRUCTION'])('%s is learnable but neither AI nor direct monster execution opens an exit', name => {
        const g=scene(),m=mob(g); m.bolts=[name]; m.behaviorFlags.add('MONST_ALWAYS_USE_ABILITY');
        const ticks=m.ticksUntilTurn, before=rng.randomNumbersGenerated, grid=JSON.stringify(g.toSnapshot().grid);
        expect(specificallyValidBoltTarget(m,g.player,name,g)).toBe(false);
        expect(m.tryUseBolt(g)).toBe(false); expect(g.castMonsterBolt(m,g.player,name)).toBeUndefined();
        expect(m.ticksUntilTurn).toBe(ticks); expect(rng.randomNumbersGenerated).toBe(before);
        expect(JSON.stringify(g.toSnapshot().grid)).toBe(grid);
    });
});

describe('U09 hand-installed abilities use the real AI loop, without natural learning', () => {
    it('matches the verbatim compiled CE predicate on all 198 new-identity target cases', () => {
        const g=scene();
        const oracle=JSON.parse(fs.readFileSync('ai_docs/reports/u-09-evidence/ce-target-cases.json','utf8')) as {
            formulas:{reflection48:number;lightningLow:number;lightningHigh:number};
            tests:{name:string;label:string;casterAlly:boolean;targetAlly:boolean;playerTarget:boolean;behavior:string[];ability:string[];status:string[];expected:boolean}[];
        };
        expect(oracle.formulas).toEqual({reflection48:48,lightningLow:9,lightningHigh:29});expect(oracle.tests).toHaveLength(198);
        for(const test of oracle.tests) {
            g.monsters=[];g.player.statusDurations={};
            const caster=mob(g),target=test.playerTarget?g.player:mob(g,8);caster.isAlly=test.casterAlly;
            if(target instanceof Monster) {target.isAlly=test.targetAlly;target.behaviorFlags=new Set(test.behavior);target.abilityFlags=new Set(test.ability);}
            const statuses={STATUS_ENTRANCED:'entranced',STATUS_SLOWED:'slowed',STATUS_INVISIBLE:'invisible',STATUS_IMMUNE_TO_FIRE:'immune_fire'} as const;
            for(const id of test.status) target.setStatusDuration(statuses[id as keyof typeof statuses],10);
            expect(specificallyValidBoltTarget(caster,target,test.name,g),`${test.name}/${test.label}`).toBe(test.expected);
        }
    });
    it.each(added)('%s: eligible target, real cast, attack ticks; no power counter spent', name => {
        const g=scene(),m=mob(g),target=mob(g,8);
        m.isAlly=name!=='INVISIBILITY'; target.isAlly=false;
        m.bolts=[name]; m.behaviorFlags.add('MONST_ALWAYS_USE_ABILITY'); m.behaviorFlags.add('MONST_CAST_SPELLS_SLOWLY');
        m.newPowerCount=2; m.totalPowerCount=3;
        if(name==='TELEPORT') for(let y=0;y<g.grid.height;y++)g.grid.setTerrain(20,y,T.WALL);
        const cast=vi.spyOn(g,'castMonsterBolt');
        expect(m.tryUseBolt(g)).toBe(true); expect(cast).toHaveBeenCalledWith(m,target,name);
        expect(cast.mock.results[0]!.value.outcome).not.toBeNull();
        expect(m.ticksUntilTurn).toBe(m.attackSpeed*2);
        expect([m.newPowerCount,m.totalPowerCount]).toEqual([2,3]);
        if(name==='SLOW') expect(target.getStatusDuration('slowed')).toBe(50);
        if(name==='POISON') expect([target.getStatusDuration('poisoned'),target.poisonAmount]).toEqual([40,1]);
        if(name==='INVISIBILITY') expect(target.getStatusDuration('invisible')).toBe(150);
        if(name==='ENTRANCEMENT') expect(target.getStatusDuration('entranced')).toBe(30);
        if(name==='LIGHTNING') expect(target.hp).toBeLessThan(100);
        if(name==='POLYMORPH') expect(target.typeId).not.toBe('rat');
        if(name==='TELEPORT') expect(target.loc).not.toEqual({x:8,y:5});
        if(name==='CONJURATION') expect(g.monsters.filter(m=>m.typeId==='spectral_blade')).toHaveLength(15);
    });
    it('preserves player-first/bolt-order and 30% rolls, including failed candidates without a roll', () => {
        const g=scene(),m=mob(g); m.bolts=['TUNNELING','SLOW','POISON'];
        g.player.loc={x:8,y:5};
        const percent=vi.spyOn(rng,'randPercent').mockReturnValueOnce(false).mockReturnValueOnce(true);
        const cast=vi.spyOn(g,'castMonsterBolt');
        expect(m.tryUseBolt(g)).toBe(true); expect(percent.mock.calls).toEqual([[30],[30]]);
        expect(cast).toHaveBeenCalledExactlyOnceWith(m,g.player,'POISON');
    });
    it.each(added)('%s applies its CE faction, invulnerable, forbidden and reflectability gates', name => {
        const g=scene(),m=mob(g),target=mob(g,8);
        m.isAlly=name!=='INVISIBILITY';
        expect(specificallyValidBoltTarget(m,target,name,g)).toBe(true);
        target.isAlly=!target.isAlly;
        expect(specificallyValidBoltTarget(m,target,name,g)).toBe(false); target.isAlly=false;
        target.behaviorFlags.add('MONST_INVULNERABLE');
        expect(specificallyValidBoltTarget(m,target,name,g)).toBe(name==='INVISIBILITY'); // ally bolt: CE checks forbidden INANIMATE, not INVULNERABLE here
        target.behaviorFlags.delete('MONST_INVULNERABLE');
        const forbidden:Record<string,string>={TELEPORT:'MONST_IMMOBILE',SLOW:'MONST_INANIMATE',POLYMORPH:'MONST_INANIMATE',DOMINATION:'MONST_INANIMATE',INVISIBILITY:'MONST_INANIMATE',POISON:'MONST_INANIMATE',ENTRANCEMENT:'MONST_INANIMATE',CONJURATION:'MONST_IMMUNE_TO_WEAPONS'};
        if(forbidden[name]) {
            target.behaviorFlags.add(forbidden[name]); expect(specificallyValidBoltTarget(m,target,name,g)).toBe(false);
            target.behaviorFlags.delete(forbidden[name]);
        }
        target.behaviorFlags.add('MONST_REFLECT_50');
        expect(specificallyValidBoltTarget(m,target,name,g)).toBe(name==='CONJURATION');
        target.behaviorFlags.delete('MONST_REFLECT_50'); target.abilityFlags.add('MA_REFLECT_100');
        expect(specificallyValidBoltTarget(m,target,name,g)).toBe(name==='CONJURATION');
    });
    it('allied reflective recipient remains eligible and contact reflection is still resolved by travel', () => {
        const g=scene(),m=mob(g),target=mob(g,8); m.isAlly=target.isAlly=true;target.abilityFlags.add('MA_REFLECT_100');
        expect(specificallyValidBoltTarget(m,target,'INVISIBILITY',g)).toBe(true);
        const result=g.castMonsterBolt(m,target,'INVISIBILITY')!;
        expect(result.hits.map(h=>h.creature)).toEqual([m]);expect(m.getStatusDuration('invisible')).toBe(150);
        expect(target.hasStatus('invisible')).toBe(false);
    });
    it('TURRET contributes all six bits at effect gates; no sleep/initialization RNG rewrite', () => {
        const g=scene(),m=mob(g),target=mob(g,8);target.behaviorFlags=new Set(['MONST_TURRET']); m.isAlly=true;
        for(const flag of ['MONST_IMMUNE_TO_WEBS','MONST_NEVER_SLEEPS','MONST_IMMOBILE','MONST_INANIMATE','MONST_ATTACKABLE_THRU_WALLS','MONST_WILL_NOT_USE_STAIRS']) expect(target.hasCEBehavior(flag)).toBe(true);
        for(const name of ['TELEPORT','SLOW','POLYMORPH','DOMINATION','POISON','ENTRANCEMENT','SPIDERWEB','ANCIENT_SPIRIT_VINES']) expect(specificallyValidBoltTarget(m,target,name,g)).toBe(false);
        const pos={...target.loc},percent=vi.spyOn(rng,'randPercent');
        for(const name of ['TELEPORT','SLOW','POLYMORPH','DOMINATION','POISON','ENTRANCEMENT','INVISIBILITY']) g.castMonsterBolt(m,target,name);
        expect(target.loc).toEqual(pos);expect(target.typeId).toBe('rat');expect(target.statusDurations).toEqual({});
        expect(percent).not.toHaveBeenCalled();expect([...target.behaviorFlags]).toEqual(['MONST_TURRET']);
    });
});

describe('U09 real contacts, magnitude and caster ownership', () => {
    it('TELEPORT frees a captive even when destination search fails; IMMOBILE prevents both', () => {
        const g=scene(),m=mob(g),target=mob(g,8); target.isCaged=true;
        for(let x=0;x<g.grid.width;x++) for(let y=0;y<g.grid.height;y++) g.grid.setTerrain(x,y,T.WALL);
        for(let x=8;x<=12;x++) {g.grid.setTerrain(x,5,T.FLOOR);g.grid.getCell(x,5)!.machineNumber=1;}
        const result=g.castMonsterBolt(m,target,'TELEPORT')!;
        expect(target.isCaged).toBe(false);expect(target.isAlly).toBe(true);expect(target.loc).toEqual({x:8,y:5});expect(result.outcome?.autoID).toBe(false);
        target.isCaged=true;target.behaviorFlags.add('MONST_IMMOBILE');g.castMonsterBolt(m,target,'TELEPORT');expect(target.isCaged).toBe(true);
    });
    it('POLYMORPH uses W19 in-place species replacement; player contact is immune without species RNG', () => {
        const g=scene(),m=mob(g),target=mob(g,8);const id=target.id;
        const roll=vi.spyOn(rng,'randRange').mockReturnValue(monsters.findIndex(m=>m.id==='phantom')+1);
        const result=g.castMonsterBolt(m,target,'POLYMORPH')!;
        expect(target.id).toBe(id);expect(target.typeId).toBe('phantom');expect(target.getStatusDuration('invisible')).toBe(1000);expect(result.outcome?.autoID).toBe(false);
        roll.mockClear();g.castMonsterBolt(m,g.player,'POLYMORPH');expect(roll).not.toHaveBeenCalled();
    });
    it('DOMINATION from hostile caster still converts to player allegiance, demotes leadership and clears discord', () => {
        const g=scene(),m=mob(g),target=mob(g,8),child=mob(g,7,'rat',6);child.leader=target;
        target.setStatusDuration('discordant',30);vi.spyOn(rng,'randPercent').mockReturnValue(true);
        g.castMonsterBolt(m,target,'DOMINATION');
        expect(target.isAlly).toBe(true);expect(target.leader).not.toBe(m);expect(target.dominated).toBe(true);
        expect(child.leader).not.toBe(target);expect(target.hasStatus('discordant')).toBe(false);expect(m.isAlly).toBe(false);
    });
    it('DOMINATION failure and player contact preserve ownership and spend only the eligible roll', () => {
        const g=scene(),m=mob(g),target=mob(g,8);const roll=vi.spyOn(rng,'randPercent').mockReturnValue(false);
        g.castMonsterBolt(m,target,'DOMINATION');expect(target.isAlly).toBe(false);expect(roll).toHaveBeenCalledTimes(1);
        g.castMonsterBolt(m,g.player,'DOMINATION');expect(roll).toHaveBeenCalledTimes(1);
    });
    it('CONJURATION detonates before the intercepted creature and creates 15 player-bound blades even for a hostile caster', () => {
        const g=scene(),m=mob(g),target=mob(g,5),blocker=mob(g,9);
        const result=g.castMonsterBolt(m,target,'CONJURATION')!, blades=g.monsters.filter(m=>m.typeId==='spectral_blade');
        expect(result.landingPos).toEqual({x:10,y:5});expect(result.hits).toEqual([]);expect(blades).toHaveLength(15);
        expect(blades[0]!.loc).toEqual({x:10,y:5});expect(blocker.hp).toBe(100);
        expect(new Set(blades.map(b=>`${b.x},${b.y}`)).size).toBe(15);
        for(const b of blades) {expect(b.isAlly && b.boundToPlayer && b.doesNotTrackLeader).toBe(true);expect(b.leader).toBeNull();expect(b.ticksUntilTurn).toBe(b.attackSpeed+1);expect([b.goldDropChance,b.itemDropChance]).toEqual([0,0]);}
        m.hp=0;(g as unknown as {removeDeadMonsters():void}).removeDeadMonsters();expect(g.monsters.filter(m=>m.typeId==='spectral_blade')).toHaveLength(15);
    });
    it('CONJURATION on a full grid creates no overlapping/off-map creature', () => {
        const g=scene(),m=mob(g);g.player.loc={x:10,y:5};
        for(let x=0;x<g.grid.width;x++)for(let y=0;y<g.grid.height;y++)g.grid.setTerrain(x,y,T.WALL);
        g.grid.setTerrain(12,5,T.FLOOR);g.grid.setTerrain(11,5,T.FLOOR);mob(g,11);
        expect(g.castMonsterBolt(m,g.player,'CONJURATION')!.outcome?.autoID).toBe(false);
        expect(g.monsters.filter(m=>m.typeId==='spectral_blade')).toEqual([]);
    });
    it('LIGHTNING uses magnitude10 (9..29, four clumps), pierces, and never calls physical attack', () => {
        const g=scene(),m=mob(g),first=mob(g,9),second=mob(g,7);m.accuracy=0;m.damageString='9999';first.defense=9999;
        const attack=vi.spyOn(CombatSystem,'attack');const clump=vi.spyOn(rng,'randClumpedRange').mockReturnValue(28);
        const result=g.castMonsterBolt(m,first,'LIGHTNING')!;
        expect(result.hits.map(h=>h.creature)).toEqual([first,second]);expect([first.hp,second.hp]).toEqual([72,72]);
        expect(clump.mock.calls).toEqual([[9,29,4],[9,29,4]]);expect(attack).not.toHaveBeenCalled();
    });
    it('LIGHTNING reflection owns transference and lethal source at the original monster', () => {
        const g=scene(),m=mob(g),mirror=mob(g,8);mirror.abilityFlags.add('MA_REFLECT_100');m.abilityFlags.add('MA_TRANSFERENCE');m.hp=10;
        vi.spyOn(rng,'randClumpedRange').mockReturnValue(20);const result=g.castMonsterBolt(m,mirror,'LIGHTNING')!;
        expect(result.hits[0]!.creature).toBe(m);expect(m.hp).toBe(0);expect(mirror.hp).toBe(100);
        const other=mob(g,12,'rat',7);g.player.loc={x:8,y:7};g.player.hp=1;
        g.castMonsterBolt(other,g.player,'LIGHTNING');expect(g.lastDamageSource).toBe(other.name);expect(g.player.hp).toBe(0);
    });
    it('POISON magnitude10 stacks 40 turns and one concentration per contact; no immediate health transfer', () => {
        const g=scene(),m=mob(g),target=mob(g,8);m.abilityFlags.add('MA_TRANSFERENCE');m.hp=5;
        g.castMonsterBolt(m,target,'POISON');g.castMonsterBolt(m,target,'POISON');
        expect([target.hp,target.getStatusDuration('poisoned'),target.poisonAmount,m.hp]).toEqual([100,80,2,5]);
    });
    it('ENTRANCEMENT player contact confuses; monster contact wakes and entrains independently of caster allegiance', () => {
        const g=scene(),m=mob(g),target=mob(g,8);target.state=MonsterState.ASLEEP;target.ticksUntilTurn=900;
        g.castMonsterBolt(m,target,'ENTRANCEMENT');expect(target.getStatusDuration('entranced')).toBe(30);expect(target.state).toBe(MonsterState.HUNTING);expect(target.ticksUntilTurn).toBe(100);
        g.castMonsterBolt(m,g.player,'ENTRANCEMENT');expect(g.player.getStatusDuration('confused')).toBe(30);expect(g.player.hasStatus('entranced')).toBe(false);
    });
});

describe('U09 six installed flags: permanent status and passive consumers', () => {
    it.each([['MONST_FLIES','levitating'],['MONST_IMMUNE_TO_FIRE','immune_fire'],['MONST_INVISIBLE','invisible']] as const)('%s synchronizes, survives ticks/current snapshots and is permanently negated', (flag,status) => {
        const g=scene(),m=mob(g);m.behaviorFlags.add(flag);m.syncFlagDerivedStatuses(true);
        expect(m.getStatusDuration(status)).toBe(PERMANENT_STATUS_DURATION);for(let i=0;i<12;i++)m.tickStatuses();expect(m.getStatusDuration(status)).toBe(1000);
        const snapshot=JSON.parse(JSON.stringify(g.toSnapshot()));g.loadSnapshot(snapshot);
        const restored=g.monsters.find(n=>n.id===m.id)!;restored.tickStatuses();expect(restored.getStatusDuration(status)).toBe(1000);
        expect(negate(g,restored)).toBe(true);restored.syncFlagDerivedStatuses(true);restored.tickStatuses();expect(restored.hasStatus(status)).toBe(false);expect(restored.hasBehavior(flag)).toBe(false);
    });
    it('learning flight clears aquatic restrictions, while initialization retains its own CE flags', () => {
        const m=new Monster(1,1,{...data(),behaviorFlags:['MONST_FLIES','MONST_RESTRICTED_TO_LIQUID','MONST_SUBMERGES']});
        expect(m.hasBehavior('MONST_RESTRICTED_TO_LIQUID')).toBe(true);m.syncFlagDerivedStatuses(true);
        expect(m.hasBehavior('MONST_RESTRICTED_TO_LIQUID')).toBe(false);expect(m.hasBehavior('MONST_SUBMERGES')).toBe(false);
    });
    it('an already-FIERY recipient rederives permanent burning after learning another power, without making FIERY learnable', () => {
        const g=scene(),m=mob(g,12,'salamander');
        expect((m.statusDurations as Record<string,number>).burning ?? 0).toBe(0); // generation remains unchanged
        m.behaviorFlags.add('MONST_REFLECT_50');m.syncFlagDerivedStatuses(true);
        for(let i=0;i<10;i++)m.tickStatuses();
        expect((m.statusDurations as Record<string,number>).burning).toBe(1000);
        expect([m.newPowerCount,m.totalPowerCount]).toEqual([0,0]);
        negate(g,m);m.syncFlagDerivedStatuses(true);
        expect((m.statusDurations as Record<string,number>).burning ?? 0).toBe(0);expect(m.hasBehavior('MONST_FIERY')).toBe(false);
    });
    it('installed flight and fire immunity protect against real environmental contact; invisibility enters perception', () => {
        const g=scene(),m=mob(g);m.behaviorFlags.add('MONST_FLIES');m.behaviorFlags.add('MONST_IMMUNE_TO_FIRE');m.behaviorFlags.add('MONST_INVISIBLE');m.syncFlagDerivedStatuses(true);
        g.grid.setTerrain(m.x,m.y,T.LAVA);g.onRenderRequested=()=>{};
        (g as unknown as {applyEnvironmentalEffects():void}).applyEnvironmentalEffects();g.update();expect(m.hp).toBe(100);expect(g.visibleMonsters.has(m)).toBe(false);
        expect(specificallyValidBoltTarget(m,m,'FIRE',g)).toBe(false);
    });
    it('MONST_REFLECT_50 reads reflectionChance(4) and real travel loses the ability after negation', () => {
        const g=scene(),m=mob(g),target=mob(g,8);target.behaviorFlags.add('MONST_REFLECT_50');
        expect(target.reflectChance()).toBe(reflectionChance(4));expect(target.reflectChance()).toBe(48);
        const percent=vi.spyOn(rng,'randPercent').mockReturnValue(true);const result=g.castMonsterBolt(m,target,'SLOW')!;
        expect(result.reflections).toHaveLength(1);expect(m.getStatusDuration('slowed')).toBe(50);expect(target.hasStatus('slowed')).toBe(false);
        expect(percent).toHaveBeenCalledWith(48);negate(g,target);expect(target.reflectChance()).toBe(0);
    });
    it.each([false,true])('TRANSFERENCE ally=%s: melee and bolt share shield/remainingHP/cap semantics', ally => {
        const g=scene(),m=mob(g),target=mob(g,8);m.isAlly=ally;m.hp=100;m.abilityFlags.add('MA_TRANSFERENCE');m.damageString='20';m.accuracy=10000;target.hp=7;target.applyShield(50);
        CombatSystem.attack(m,target,{isWeaponAttack:true});expect(m.hp).toBe(100+(ally?2:6));expect(target.hp).toBe(0);
        target.hp=7;target.applyShield(50);m.hp=100;vi.spyOn(rng,'randClumpedRange').mockReturnValue(20);g.castMonsterBolt(m,target,'LIGHTNING');expect(m.hp).toBe(100+(ally?2:6));
        negate(g,m);target.hp=7;m.hp=100;g.castMonsterBolt(m,target,'LIGHTNING');expect(m.hp).toBe(100);
    });
    it.each(['MONST_INANIMATE','MONST_TURRET','MONST_INVULNERABLE'])('TRANSFERENCE and weakness reject a %s victim', flag => {
        const g=scene(),m=mob(g),target=mob(g,8);m.abilityFlags=new Set(['MA_TRANSFERENCE','MA_CAUSES_WEAKNESS']);m.hp=5;m.damageString='10';m.accuracy=10000;target.behaviorFlags.add(flag);
        CombatSystem.attack(m,target,{isWeaponAttack:true});expect(m.hp).toBe(5);expect(target.weaknessAmount).toBe(0);
        g.castMonsterBolt(m,target,'LIGHTNING');expect(m.hp).toBe(5);
    });
    it('weakness affects a surviving monster through melee and BE_ATTACK, but never BE_DAMAGE; removing the ability preserves existing weakness', () => {
        const g=scene(),m=mob(g),target=mob(g,8);m.abilityFlags.add('MA_CAUSES_WEAKNESS');m.damageString='1';m.accuracy=10000;target.applyShield(1000);
        CombatSystem.attack(m,target,{isWeaponAttack:true});g.castMonsterBolt(m,target,'POISON_DART');
        expect([target.weaknessAmount,target.getStatusDuration('weakened'),target.hp]).toEqual([2,300,100]);
        g.castMonsterBolt(m,target,'LIGHTNING');expect(target.weaknessAmount).toBe(2);
        negate(g,m);negate(g,target);expect(target.weaknessAmount).toBe(2);CombatSystem.attack(m,target,{isWeaponAttack:true});expect(target.weaknessAmount).toBe(2);
    });
    it('legacy on-hit/abilities/immunities are not learned or removed by negation', () => {
        const g=scene(),m=mob(g,12,'vampire');m.behaviorFlags.add('MONST_INVISIBLE');m.syncFlagDerivedStatuses(true);
        const legacy=[...m.abilities],immunities=[...m.statusImmunities],onHit=m.onHitStatus;
        negate(g,m);expect([...m.abilities]).toEqual(legacy);expect([...m.statusImmunities]).toEqual(immunities);expect(m.onHitStatus).toBe(onHit);
        expect(m.hasAbility('MA_TRANSFERENCE')).toBe(false);expect(m.hasStatus('invisible')).toBe(false);
    });
});
