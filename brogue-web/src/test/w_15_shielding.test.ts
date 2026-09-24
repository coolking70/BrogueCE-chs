import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { Game } from '../engine/Core/Game';
import { Grid, TerrainType as T } from '../engine/Map/Grid';
import { EnvironmentManager, GasType } from '../engine/Environment/Gas';
import { Player } from '../entities/Player';
import { Creature } from '../entities/Creature';
import { Monster, MonsterState, isShielded, specificallyValidBoltTarget, type MonsterData } from '../entities/Monster';
import monsters from '../data/monsters.json';
import { Item, ItemCategory } from '../engine/Items/Item';
import { ItemLoader } from '../engine/Items/ItemLoader';
import { BoltEffect, getBoltForItem, type BoltConfig } from '../engine/Combat/Bolt';
import { CEBoltType } from '../engine/Combat/BoltCatalog';
import { CombatSystem } from '../engine/Combat/Combat';
import { staffProtection } from '../engine/Combat/Shielding';
import { rng } from '../engine/Random';
import { logger } from '../engine/Systems/Logger';
import { createHeadlessGame } from './harness';

const shield = (c: Creature) => [c.getStatusDuration('shielded'), c.maxShield];
function scene() {
    const g = Object.create(Game.prototype) as Game;
    g.grid = new Grid(18, 12);
    for (let x = 0; x < 18; x++) for (let y = 0; y < 12; y++) {
        g.grid.setTerrain(x, y, T.FLOOR); g.grid.getCell(x, y)!.isVisible = true;
    }
    g.player = new Player(4, 5); g.player.maxHp = g.player.hp = 100;
    g.monsters = []; g.items = []; g.environment = new EnvironmentManager(g.grid);
    g.stats = { kills: 0, gold: 0, turns: 0, maxDepth: 1 };
    g.spawnFloatingText = vi.fn(); g.spawnBlood = vi.fn();
    (g as any).updateVision = vi.fn();
    return g;
}
function mob(g: Game, id = 'rat', x = 8, y = 5) {
    const m = new Monster(x, y, (monsters as MonsterData[]).find(m => m.id === id)!);
    m.hp = m.maxHp = 100; m.goldDropChance = m.itemDropChance = 0;
    m.ticksUntilTurn = 100000; m.state = MonsterState.HUNTING; g.monsters.push(m); return m;
}
function staff(E = 2) {
    const item = new Item('explicit protection', '/', 0xffffaa, ItemCategory.STAFF);
    Object.assign(item, { enchantment: E, maxCharges: 99, charges: 1 }); return item;
}
const config: BoltConfig = { id: 'test_protection', name: 'protection', ceType: CEBoltType.SHIELDING,
    effect: BoltEffect.SHIELDING, magnitude: 987, char: '*', color: 0xffffaa, maxRange: 0, piercing: false, selfTargeting: false };
const zap = (g: Game, E = 2, aim = { x: 8, y: 5 }) => g.zapBoltFromPlayer(config, staff(E), aim);
function armor(g: Game, type: string, E = 3) {
    const a = new Item('armor', ']', 0xffffff, ItemCategory.ARMOR);
    a.runicType = type; a.enchantment = E; a.strengthRequired = g.player.strength;
    g.player.equippedArmor = a; return a;
}
function live() {
    const g = createHeadlessGame(1515, 'test');
    g.monsters = []; g.dormantMonsters = []; g.items = [];
    g.player.statusDurations = {}; g.player.maxShield = 0;
    g.player.equippedArmor = g.player.equippedWeapon = g.player.ringLeft = g.player.ringRight = null;
    g.player.inventory.items = []; g.player.maxHp = g.player.hp = 100; g.player.loc = { x: 4, y: 5 };
    for (let x = 1; x < 14; x++) for (let y = 1; y < 10; y++) g.grid.setTerrain(x, y, T.FLOOR);
    return g;
}
beforeEach(() => { rng.seedRandomGenerator(1515); logger.messages = []; });
afterEach(() => vi.restoreAllMocks());

describe('W-15 CE shield units, fixed-point formula, max and decay', () => {
    it('matches compiled CE fp_pow/staffProtection golden values, including negative exponent', () => {
        const golden = [66,92,130,181,254,356,499,699,978,1370,1918,2685,3760,5264,7369,10317,14444,20222,28311,39635,55489];
        const before = rng.randomNumbersGenerated;
        golden.forEach((value, E) => expect(staffProtection(E)).toBe(value));
        expect(staffProtection(3.9)).toBe(181); expect(rng.randomNumbersGenerated).toBe(before);
    });
    it.each([[130, 3, 0, 100, 130], [130, 13, 0, 0, 0], [130, 16, 3, 0, 0], [1, 1, 0, 0, 0], [11, 3, 1, 0, 0]])(
        'shield %i / incoming %i: residual %i, current %i, max %i', (amount, damage, residual, current, max) => {
            const c = new Player(0, 0); c.applyShield(amount); const hp = c.hp;
            c.takeDamage(damage); expect(hp - c.hp).toBe(residual); expect(shield(c)).toEqual([current, max]);
        });
    it('damage reducer does not own HP/death; zero/bypassed damage never spends shielding', () => {
        const c = new Player(0, 0); c.applyShield(130); const death = vi.spyOn(c as any, 'die');
        expect(c.absorbShieldDamage(20)).toBe(7); expect(c.hp).toBe(30); expect(death).not.toHaveBeenCalled();
        c.applyShield(130); c.takeDamage(0); c.takeDamage(3, true);
        expect(c.hp).toBe(27); expect(shield(c)).toEqual([130,130]);
    });
    it('full/weak/repeated casts take max(current,new), reset max even without an increase, never add', () => {
        const c = new Player(0, 0); c.applyShield(356); c.takeDamage(5);
        expect(shield(c)).toEqual([306,356]); c.applyShield(130); expect(shield(c)).toEqual([306,306]);
        c.tickStatuses(); expect(shield(c)).toEqual([291,306]);
        c.applyShield(499); expect(shield(c)).toEqual([499,499]);
        c.applyShield(499); expect(shield(c)).toEqual([499,499]);
    });
    it.each(['player','monster'])('%s decays by integer max/20, not current/20 or one turn', who => {
        const g = scene(), c = who === 'player' ? g.player : mob(g); c.applyShield(130); c.takeDamage(3);
        c.tickStatuses(); expect(shield(c)).toEqual([94,130]);
        for (let i=0;i<15;i++) c.tickStatuses(); expect(shield(c)).toEqual([4,130]);
        expect(c.tickStatuses()).toContain('shielded'); expect(shield(c)).toEqual([0,0]);
        c.applyShield(19); for (let i=0;i<50;i++) c.tickStatuses(); expect(shield(c)).toEqual([19,19]);
    });
    it('objective scheduler: haste two half-actions/slow double-block, zero shield RNG', () => {
        const g = live(); g.player.applyShield(130); g.player.applyStatus('hasted', 50);
        g.handlePlayerAction('wait'); expect(shield(g.player)).toEqual([130,130]);
        g.handlePlayerAction('wait'); expect(shield(g.player)).toEqual([124,130]);
        g.player.setStatusDuration('hasted', 0); g.player.applyStatus('slowed', 50);
        g.handlePlayerAction('wait'); expect(shield(g.player)).toEqual([112,130]);
    });
});

describe('W-15 real player/monster bolt contacts', () => {
    it.each([[2,130],[3,181],[8,978]])('E%i ignores charge/capacity/config constants, applies %i to hit target', (E, expected) => {
        const g = scene(), m = mob(g), before = rng.randomNumbersGenerated;
        const r = zap(g,E); expect(r.hits.map(h=>h.creature)).toEqual([m]); expect(r.outcome?.autoID).toBe(true);
        expect(shield(m)).toEqual([expected,expected]); expect(shield(g.player)).toEqual([0,0]);
        expect(g.player.hasStatus('telepathy')).toBe(false); expect(rng.randomNumbersGenerated).toBe(before);
    });
    it.each(['empty','wall','origin'])('%s does not buff the caster or identify', mode => {
        const g = scene(); if (mode==='wall') { mob(g); g.grid.setTerrain(6,5,T.WALL); }
        const r = zap(g,2,mode==='origin'?g.player.loc:{x:8,y:5});
        expect(r.outcome?.autoID).toBe(false); expect(shield(g.player)).toEqual([0,0]); expect(g.player.hasStatus('telepathy')).toBe(false);
    });
    it('returning bolt shields player, reflector untouched', () => {
        const g = scene(), m = mob(g,'stone_guardian'); const r = zap(g,3);
        expect(r.reflections).toHaveLength(1); expect(r.hits.map(h=>h.creature)).toEqual([g.player]);
        expect(shield(g.player)).toEqual([181,181]); expect(shield(m)).toEqual([0,0]);
        expect(g.player.hasStatus('telepathy')).toBe(false);
    });
    it('hidden/inanimate targets and unchanged shields still autoID, CE has no living gate', () => {
        const g = scene(), m = mob(g); m.behaviorFlags.add('MONST_INANIMATE'); m.applyStatus('invisible',100);
        zap(g); m.takeDamage(1); const r = zap(g); expect(r.outcome?.autoID).toBe(true); expect(shield(m)).toEqual([130,130]);
    });
    it('retired light mapping clears telepathy mismatch, remains outside item pool', () => {
        const g = scene(), m = mob(g); g.zapBoltFromPlayer(getBoltForItem('staff_of_light')!, staff(), m.loc);
        expect(shield(m)).toEqual([130,130]); expect(g.player.hasStatus('telepathy')).toBe(false);
        expect(ItemLoader.genStaffs.some(i=>i.id==='staff_of_light')).toBe(false);
        expect(ItemLoader.genStaffs.some(i=>i.id==='staff_of_protection')).toBe(true); // W-26 catalog
    });
    it.each(['player','monster'])('monster magnitude5 =>356 for %s; shielded target is excluded until depleted', who => {
        const g = scene(), caster=mob(g,'goblin_mystic',10,5), target=who==='player'?g.player:mob(g);
        caster.isAlly=true; if(target instanceof Monster) target.isAlly=true;
        const enemy = mob(g, 'rat', 15, 5);
        g.grid.getCell(caster.x, caster.y)!.isVisible = true;
        g.grid.getCell(enemy.x, enemy.y)!.isVisible = true;
        expect(g.castMonsterBolt(caster,target,'SHIELDING')!.outcome?.autoID).toBe(true);
        expect(shield(target)).toEqual([356,356]); expect(isShielded(target)).toBe(true);
        expect(specificallyValidBoltTarget(caster,target,'SHIELDING',g)).toBe(false);
        target.takeDamage(40); expect(isShielded(target)).toBe(false);
        expect(specificallyValidBoltTarget(caster,target,'SHIELDING',g)).toBe(true);
    });
});

describe('W-15 absorbable damage and bypass/death owners', () => {
    it.each(['player','monster'])('physical contact and poison rider: %s loses shield, still receives poison', who => {
        const g=scene(), a=mob(g,'centipede'), c=who==='player'?g.player:mob(g,'rat',10,5);
        a.abilityFlags.add('MA_POISONS'); a.damageString='6'; c.applyShield(130);
        vi.spyOn(rng,'randPercent').mockReturnValue(true); CombatSystem.attack(a,c);
        expect(c.hp).toBe(100); expect(shield(c)).toEqual([120,130]); expect(c.poisonAmount).toBe(1);
        (g as any).resolvePoisonDamage(c); expect(c.hp).toBe(99); expect(shield(c)).toEqual([120,130]);
    });
    it('transference only heals from damage left after shielding', () => {
        const g=scene(), a=mob(g), c=g.player; a.abilityFlags.add('MA_TRANSFERENCE'); a.damageString='10'; a.hp=20;
        c.applyShield(130); vi.spyOn(rng,'randPercent').mockReturnValue(true);
        CombatSystem.attack(a,c); expect([a.hp,c.hp]).toEqual([20,100]); expect(shield(c)).toEqual([30,130]);
        CombatSystem.attack(a,c); expect([a.hp,c.hp]).toEqual([26,93]);
    });
    it.each(['fire','lightning','thrown','monster-bolt'])('%s direct damage uses shield once', source => {
        const g=scene(), m=mob(g); m.applyShield(5000); vi.spyOn(rng,'randPercent').mockReturnValue(true);
        if(source==='monster-bolt') g.castMonsterBolt(mob(g,'goblin',10,5),m,'SPARK');
        else if(source==='thrown') { const item=new Item('dart',')',0xffffff,ItemCategory.WEAPON); item.damage='3'; CombatSystem.resolveThrownWeapon(g.player,m,item); }
        else g.zapBoltFromPlayer(getBoltForItem(`staff_of_${source}`)!,staff(),m.loc);
        expect(m.hp).toBe(100); expect(m.getStatusDuration('shielded')).toBeLessThan(5000); expect(m.maxShield).toBe(5000);
    });
    it.each(['player','monster'])('%s explosion consumes shield, preserves immunity/death ordering', who => {
        const g=scene(), c=who==='player'?g.player:mob(g); c.applyShield(130); c.hp=30;
        g.grid.setTerrain(c.x,c.y,T.GAS_EXPLOSION); const death=vi.spyOn(c as any,'die');
        (g as any).resolveExplosionDamage(c); expect(c.hp).toBe(who==='player'?-7:0); expect(shield(c)).toEqual([0,0]);
        (g as any).resolveExplosionDamage(c); expect(death).toHaveBeenCalledTimes(who==='player'?0:1);
    });
    it('dampening and invulnerable explosion retain shield and consume their existing RNG', () => {
        const g=scene(); armor(g,'dampening'); const m=mob(g); m.behaviorFlags.add('MONST_INVULNERABLE');
        for(const c of [g.player,m]) { c.applyShield(130); g.grid.setTerrain(c.x,c.y,T.GAS_EXPLOSION); (g as any).resolveExplosionDamage(c); expect(c.hp).toBe(100); expect(shield(c)).toEqual([130,130]); }
    });
    it.each(['burning','poison','gas','steam'])('%s bypasses both species shields', source => {
        const g=scene(), m=mob(g); vi.spyOn(rng,'randRange').mockReturnValue(2);
        for(const c of [g.player,m]) {
            c.applyShield(130);
            if(source==='burning') { (c.statusDurations as any).burning=3; (g as any).resolveBurningDamage(c); }
            if(source==='poison') { c.addPoison(3,2); (g as any).resolvePoisonDamage(c); }
            if(source==='gas'||source==='steam') g.environment.addGas(c.x,c.y,source==='gas'?GasType.POISON:GasType.STEAM,1000);
        }
        if(source==='gas'||source==='steam') (g as any).applyEnvironmentalEffects();
        for(const c of [g.player,m]) { expect(c.hp).toBe(source==='gas'||source==='steam'?94:98); expect(shield(c)).toEqual([130,130]); }
    });
    it('both starvation APIs bypass shields', () => {
        const p=new Player(0,0); p.nutrition=0; p.applyShield(130);
        p.recoverPerTurn(); p.updateNutrition(); expect(p.hp).toBe(28); expect(shield(p)).toEqual([130,130]);
    });
    it('poison then other lethal sources settle death and loot once under a full shield', () => {
        const g=scene(), m=mob(g); m.hp=1; m.applyShield(130); m.addPoison(3,2);
        const death=vi.spyOn(m as any,'die'), drops=vi.spyOn(g as any,'dropMonsterLoot');
        (g as any).resolvePoisonDamage(m); (m.statusDurations as any).burning=3;
        (g as any).resolveBurningDamage(m); (g as any).resolvePoisonDamage(m);
        expect(death).toHaveBeenCalledTimes(1); expect(drops).toHaveBeenCalledTimes(1); expect(shield(m)).toEqual([130,130]);
    });
    it.each(['quietus','slaying','negation','kamikaze','tunnel','shatter','lava'])('%s instant death bypasses large shield', source => {
        const g=scene(), m=mob(g); m.applyShield(200000); g.player.equippedWeapon=staff();
        if(source==='quietus'||source==='slaying') (g as any).applyWeaponRunicEffect(m,1,source);
        if(source==='negation') { m.behaviorFlags.add('MONST_DIES_IF_NEGATED'); (g as any).negateCreatureMagic(m); }
        if(source==='kamikaze') { m.abilityFlags.add('MA_KAMIKAZE'); CombatSystem.attack(m,g.player); }
        if(source==='tunnel') { m.behaviorFlags.add('MONST_ATTACKABLE_THRU_WALLS'); g.grid.setTerrain(m.x,m.y,T.WALL); (g as any).tunnelAt(m.loc); }
        if(source==='shatter') { m.behaviorFlags.add('MONST_ATTACKABLE_THRU_WALLS'); g.grid.setTerrain(m.x,m.y,T.WALL); (g as any).crystalizeFromPlayer(10); }
        if(source==='lava') { g.grid.setTerrain(m.x,m.y,T.LAVA); (g as any).applyEnvironmentalEffects(); }
        expect(m.hp).toBe(0); expect(shield(m)).toEqual([200000,200000]);
    });
    it('split HP division bypasses shield and clone owns an independent copy of current/max', () => {
        const g=scene(), m=mob(g,'pink_jelly'); m.hp=51; m.applyShield(130); m.takeDamage(3);
        (g as any).trySplitMonster(m,g.player); const clone=g.monsters[1]!;
        expect([m.hp,clone.hp]).toEqual([26,26]); expect(shield(clone)).toEqual([100,130]);
        clone.takeDamage(2); expect(shield(m)).toEqual([100,130]); expect(shield(clone)).toEqual([80,130]);
    });
    it('ordinary negation clears both fields', () => {
        const g=scene(), m=mob(g); for(const c of [g.player,m]) { c.applyShield(130); (g as any).negateCreatureMagic(c); expect(shield(c)).toEqual([0,0]); }
    });
    it('player fall uses reducer without calling takeDamage or introducing another death owner', () => {
        const g=live(); g.player.applyShield(130); const hit=vi.spyOn(g.player,'takeDamage');
        vi.spyOn(g as any,'generateDepth').mockImplementation(()=>{}); vi.spyOn(g as any,'placePlayerOnFallLanding').mockImplementation(()=>{});
        vi.spyOn(rng,'randClumpedRange').mockReturnValue(9); (g as any).playerFalls();
        expect(g.player.hp).toBe(100); expect(shield(g.player)).toEqual([40,130]); expect(hit).not.toHaveBeenCalled();
    });
    it('falling monster keeps unspent shield while pending; activation monster still dies directly', () => {
        const g=live(), m=mob(g); m.applyShield(130); m.falling=true;
        const doomed=mob(g,'rat',10,5); doomed.falling=true; doomed.behaviorFlags.add('MONST_GETS_TURN_ON_ACTIVATION'); doomed.applyShield(130);
        vi.spyOn(rng,'randClumpedRange').mockReturnValue(8); (g as any).monstersFall();
        expect(m.hp).toBe(100); expect(shield(m)).toEqual([50,130]); expect((g as any).pendingFallenByDepth.get(2)).toContain(m);
        expect(doomed.hp).toBe(0); expect(shield(doomed)).toEqual([130,130]);
    });
});

describe('W-15 armor ordering, snapshots and legacy fallback', () => {
    it.each(['absorption','mutuality','reprisal','immunity'])('%s runs before shielding without phantom healing', type => {
        const g=scene(), a=mob(g,'rat',5,5), other=mob(g,'rat',4,6); armor(g,type);
        a.damageString='10'; g.player.hp=50; for(const c of [g.player,a,other]) c.applyShield(130);
        vi.spyOn(rng,'randPercent').mockReturnValue(true); vi.spyOn(rng,'randRange').mockImplementation((lo,hi)=>lo===hi?lo:3);
        (a as any).resolveGeometryAttackOn(g,g.player,'hostile');
        expect(g.player.hp).toBe(50);
        expect(shield(g.player)).toEqual([type==='absorption'?60:type==='mutuality'?80:type==='immunity'?130:30,130]);
        if(type==='mutuality') { expect(other.hp).toBe(95); expect(shield(other)).toEqual([130,130]); }
        if(type==='reprisal') { expect(a.hp).toBe(99); expect(shield(a)).toEqual([130,130]); }
    });
    it('ordinary melee uses armor-before-shield too', () => {
        const g=live(), a=mob(g,'rat',5,5); a.damageString='10'; armor(g,'absorption'); g.player.applyShield(130);
        vi.spyOn(rng,'randPercent').mockReturnValue(true); vi.spyOn(rng,'randRange').mockImplementation((lo,hi)=>lo===hi?lo:3);
        a.takeTurn(g,20); expect(g.player.hp).toBe(100); expect(shield(g.player)).toEqual([60,130]);
    });
    it('JSON roundtrip retains partial shields for player, active and dormant monsters plus half-block', () => {
        const g=live(), m=mob(g), d=mob(g,'rat',10,5); g.monsters.pop(); g.dormantMonsters=[d];
        for(const c of [g.player,m,d]) { c.applyShield(130); c.takeDamage(3); }
        g.player.applyStatus('hasted',50); g.handlePlayerAction('wait');
        const saved=JSON.parse(JSON.stringify(g.toSnapshot())); expect(saved.ticksTillUpdateEnvironment).toBe(50);
        expect(g.loadSnapshot(saved)).toBe(true);
        for(const c of [g.player,g.monsters[0]!,g.dormantMonsters[0]!]) expect(shield(c)).toEqual([100,130]);
        g.monsters[0]!.ticksUntilTurn=100000; g.handlePlayerAction('wait'); expect(shield(g.player)).toEqual([94,130]);
        expect(shield(g.monsters[0]!)).toEqual([94,130]); expect(shield(g.dormantMonsters[0]!)).toEqual([100,130]);

    });
    it('test-room snapshot restoration retains current/max', () => {
        const g=scene(), m=mob(g); m.applyShield(181); m.takeDamage(4);
        const saved=(g as any).serializeMonster(m);
        const restored=(g as any).createMonsterFromSnapshot(JSON.parse(JSON.stringify(saved)));
        expect(shield(restored)).toEqual([141,181]); restored.tickStatuses(); expect(shield(restored)).toEqual([132,181]);

    });
    it('old/invalid snapshot fallback is deterministic and cannot leave an immortal countdown shield', () => {
        const c=new Player(0,0), before=rng.randomNumbersGenerated;
        for(const max of [undefined,0,-1,NaN,Infinity]) { c.statusDurations.shielded=15; c.restoreShield(max); expect(shield(c)).toEqual([0,0]); }
        c.statusDurations.shielded=100; c.restoreShield(130); expect(shield(c)).toEqual([100,130]);
        expect(rng.randomNumbersGenerated).toBe(before);
    });
});
