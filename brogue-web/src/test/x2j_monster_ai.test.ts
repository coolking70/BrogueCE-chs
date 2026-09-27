import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createHeadlessGame } from './harness';
import { Monster, MonsterMode, MonsterState, type MonsterData } from '../entities/Monster';
import { Player } from '../entities/Player';
import monsters from '../data/monsters.json';
import ceStates from '../../ai_docs/reports/x2j-evidence/ce-state.json';
import { getBoltForItem } from '../engine/Combat/Bolt';
import { CombatSystem } from '../engine/Combat/Combat';
import { updateMonsterState, wakeMonster, monsterFleesFrom } from '../engine/Combat/MonsterAI';
import { getBlinkTargetMap, getBlinkSafeTerrainMap, getBlinkAllySafetyMap } from '../engine/Combat/MonsterBlink';
import { ItemLoader } from '../engine/Items/ItemLoader';
import { ItemCategory } from '../engine/Items/Item';
import { TerrainType as T } from '../engine/Map/Grid';
import { rng } from '../engine/Random';
import { logger } from '../engine/Systems/Logger';

let g: ReturnType<typeof createHeadlessGame>;
const data = (id: string) => (monsters as MonsterData[]).find(m => m.id === id)!;
const mob = (id = 'monkey', x = 11, y = 10) => {
    const m = new Monster(x, y, data(id)); m.state = MonsterState.HUNTING; g.monsters.push(m); return m;
};
const attack = (m: Monster) => CombatSystem.attack(m, g.player, { grid: g.grid, itemGenerationDepth: g.depth });
const aware = (v = true) => vi.spyOn(g.scent, 'awareOfTarget').mockReturnValue(v);
const update = (m: Monster) => updateMonsterState(g, m, 10);
beforeEach(() => {
    g = createHeadlessGame(2712, 'test'); g.animationEnabled = false;
    g.monsters = []; g.dormantMonsters = []; g.items = []; g.player = new Player(10, 10);
    g.player.hp = g.player.maxHp = 200;
    for (let x = 0; x < g.grid.width; x++) for (let y = 0; y < g.grid.height; y++) {
        g.grid.setTerrain(x, y, !x || !y || x === g.grid.width - 1 || y === g.grid.height - 1 ? T.WALL : T.FLOOR);
        g.grid.getCell(x, y)!.isVisible = true;
    }
    g.waypoints.count = 0;
});
afterEach(() => vi.restoreAllMocks());

describe('X2j CE specialHit theft', () => {
    it.each([[ItemCategory.WEAPON, 1, 1], [ItemCategory.WEAPON, 3, 3], [ItemCategory.WEAPON, 4, 2],
        [ItemCategory.WEAPON, 5, 3], [ItemCategory.POTION, 5, 1], [ItemCategory.GEM, 8, 1]])('steals category %s stack %i -> %i with one owner', (category, quantity, stolen) => {
        const m = mob(); m.accuracy = 100;
        const item = category === ItemCategory.WEAPON ? ItemLoader.spawnWeapon('dart', -1, -1)!
            : category === ItemCategory.GEM ? ItemLoader.spawnGem(27, -1, -1) : ItemLoader.spawnPotion('potion_of_life', -1, -1)!;
        Object.assign(item, { quantity, enchantment: 3, originDepth: 7, flags: ['ITEM_PLAYER_AVOIDS'], inventoryLetter: 'c' });
        g.player.inventory.addItem(item); g.player.applyStatus('paralyzed', 5);
        expect(attack(m).hit).toBe(true);
        expect(m.carriedItem?.quantity).toBe(stolen); expect(m.carriedItem?.enchantment).toBe(3);
        expect(m.carriedItem?.originDepth).toBe(7); expect(m.carriedItem?.flags).not.toContain('ITEM_PLAYER_AVOIDS');
        expect(m.creatureMode).toBe(MonsterMode.PERM_FLEEING); expect(m.state).toBe(MonsterState.FLEEING);
        expect(g.items).not.toContain(m.carriedItem); expect(g.player.inventory.items).not.toContain(m.carriedItem);
        if (stolen < quantity) { expect(item.quantity).toBe(quantity - stolen); expect(m.carriedItem!.id).not.toBe(item.id); }
        else expect(m.carriedItem).toBe(item);
        expect(logger.messages[logger.messages.length - 1]?.text).toContain('stole');
    });
    it('excludes every equipped slot but samples unequipped stacks equally, not individual quantities', () => {
        const m = mob(); g.player.applyStatus('paralyzed', 5);
        const weapon = ItemLoader.spawnWeapon('dagger', 0, 0)!, armor = ItemLoader.spawnArmor('leather_armor', 0, 0)!;
        const a = ItemLoader.spawnRing('ring_of_stealth', 0, 0)!, b = ItemLoader.spawnRing('ring_of_light', 0, 0)!;
        const food = ItemLoader.spawnFood('ration_of_food', 0, 0)!;
        for (const item of [weapon, armor, a, b, food]) g.player.inventory.addItem(item);
        g.player.equippedWeapon = weapon; g.player.equippedArmor = armor; g.player.ringLeft = a; g.player.ringRight = b;
        const roll = vi.spyOn(rng, 'randRange'); attack(m);
        expect(m.carriedItem).toBe(food); expect(roll).toHaveBeenCalledWith(1, 1);
        expect(g.player.inventory.items).toEqual([weapon, armor, a, b]);
    });
    it('requires a second attackHit and permits a zero-damage hit to steal', () => {
        const m = mob(); m.damageString = '0';
        const item = ItemLoader.spawnFood('ration_of_food', 0, 0)!; g.player.inventory.addItem(item);
        const roll = vi.spyOn(rng, 'randPercent').mockReturnValueOnce(true).mockReturnValueOnce(false);
        expect(attack(m).hit).toBe(true); expect(m.carriedItem).toBeFalsy(); expect(roll).toHaveBeenCalledTimes(2);
        roll.mockReturnValue(true); attack(m); expect(m.carriedItem).toBe(item);
    });
    it.each(['confused', 'carrying', 'dead attacker', 'dead defender', 'immune armor', 'empty', 'equipped only'])('does not steal: %s', reason => {
        const m = mob(); m.damageString = reason === 'dead defender' ? '500' : '0';
        g.player.applyStatus('paralyzed', 10);
        const item = ItemLoader.spawnWeapon('dagger', 0, 0)!;
        if (reason !== 'empty') g.player.inventory.addItem(item);
        if (reason === 'confused') m.applyStatus('confused', 10);
        if (reason === 'carrying') m.carriedItem = ItemLoader.spawnFood('ration_of_food', 0, 0)!;
        if (reason === 'dead attacker') m.hp = 0;
        if (reason === 'immune armor') { g.player.equippedArmor = ItemLoader.spawnArmor('leather_armor', 0, 0)!; g.player.equippedArmor.runicType = 'immunity'; g.player.equippedArmor.vorpalEnemy = 'animal'; }
        if (reason === 'equipped only') g.player.equippedWeapon = item;
        const before = m.carriedItem; attack(m); expect(m.carriedItem).toBe(before); expect(m.creatureMode).toBe(MonsterMode.NORMAL);
    });
    it('save/reload during flight preserves split identity, private maps and exact next action', () => {
        const m = mob(); m.accuracy = 100; m.damageString = '0';
        const item = ItemLoader.spawnWeapon('dart', 0, 0)!; item.quantity = 8; g.player.inventory.addItem(item);
        g.player.applyStatus('paralyzed', 3); attack(m); g.player.setStatusDuration('paralyzed', 0);
        getBlinkTargetMap(g, m, g.player); getBlinkSafeTerrainMap(g); getBlinkAllySafetyMap(g);
        m.lastSeenPlayerAt = { ...g.player.loc }; m.safetySnapshot = g.safetyMap.map(col => [...col]);
        const saved = g.toSnapshot(), stolenId = m.carriedItem!.id;
        const run = () => { g.handlePlayerAction('wait', undefined, 'system'); const s = g.toSnapshot(); s.savedAt = 0; return s; };
        const expected = run(); g.loadSnapshot(JSON.parse(JSON.stringify(saved)));
        const loaded = g.monsters.find(other => other.id === m.id)!;
        expect(loaded.carriedItem?.id).toBe(stolenId); expect(loaded.carriedItem?.quantity).toBe(4);
        expect(loaded.creatureMode).toBe(MonsterMode.PERM_FLEEING);
        expect(loaded.lastSeenPlayerAt).toEqual(m.lastSeenPlayerAt);
        expect(g.player.mapToMe).toEqual(saved.player.mapToMe);
        const actual = run();
        const differences = (a: any, b: any, path = ''): string[] => {
            if (JSON.stringify(a) === JSON.stringify(b)) return [];
            if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return [path + ': ' + JSON.stringify(a) + ' / ' + JSON.stringify(b)];
            return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap(k => differences(a[k], b[k], path + '.' + k));
        };
        expect(differences(actual, expected)).toEqual([]);
    });
    it.each(['death', 'captivity', 'domination', 'discord expires'])('returns carried item on %s without duplicating it', reason => {
        const m = mob(); const item = ItemLoader.spawnFood('ration_of_food', 0, 0)!; m.carriedItem = item;
        m.state = MonsterState.FLEEING; m.creatureMode = MonsterMode.PERM_FLEEING;
        if (reason === 'death') { m.hp = 0; (g as any).removeDeadMonsters(); (g as any).removeDeadMonsters(); }
        if (reason === 'captivity') { m.isCaged = true; m.ticksUntilTurn = 0; g.handlePlayerAction('wait', undefined, 'system'); }
        if (reason === 'domination') g.becomeAllyWith(m);
        if (reason === 'discord expires') { m.isAlly = true; m.applyStatus('discordant', 1); (g as any).tickCreatureStatuses(); }
        expect(m.carriedItem).toBeNull(); expect(g.items.filter(i => i.id === item.id)).toHaveLength(1);
        g.player.loc = { ...item.loc }; g.handlePlayerAction('pickup', undefined, 'system');
        expect(g.player.inventory.items.some(i => i.id === item.id)).toBe(true); expect(g.items).not.toContain(item);
    });
});

describe('X2j CE updateMonsterState and cache boundaries', () => {
    it('sleep awareness is a 25% roll and awakening consumes the action, alerting normal horde members', () => {
        const leader = mob('rat'), mate = mob('rat', 12, 10); mate.leader = leader;
        leader.state = mate.state = MonsterState.ASLEEP; mate.ticksUntilTurn = 20;
        const cast = vi.spyOn(leader, 'tryUseBolt'), attackSpy = vi.spyOn(CombatSystem, 'attack');
        vi.spyOn(rng, 'randPercent').mockReturnValue(false); leader.takeTurn(g, 10); expect(leader.state).toBe(MonsterState.ASLEEP);
        vi.mocked(rng.randPercent).mockReturnValue(true); leader.takeTurn(g, 10);
        expect(leader.state).toBe(MonsterState.HUNTING); expect(mate.state).toBe(MonsterState.HUNTING);
        expect(leader.ticksUntilTurn).toBe(100); expect(mate.ticksUntilTurn).toBe(100);
        expect(cast).not.toHaveBeenCalled(); expect(attackSpy).not.toHaveBeenCalled();
    });
    it('always-hunting outranks permanent flight; immobile awareness outranks the ordinary mode branches', () => {
        const m = mob('rat'); const perception = aware(false);
        m.behaviorFlags.add('MONST_ALWAYS_HUNTING'); m.creatureMode = MonsterMode.PERM_FLEEING; m.state = MonsterState.FLEEING;
        update(m); expect(m.state).toBe(MonsterState.HUNTING); expect(perception).not.toHaveBeenCalled();
        m.behaviorFlags.delete('MONST_ALWAYS_HUNTING'); m.behaviorFlags.add('MONST_IMMOBILE'); update(m);
        expect(m.state).toBe(MonsterState.ASLEEP); perception.mockReturnValue(true); update(m); expect(m.state).toBe(MonsterState.HUNTING);
    });
    it('lost awareness wanders toward the remembered location, not the current player', () => {
        const m = mob('rat'); m.lastSeenPlayerAt = { x: 20, y: 10 }; aware(false);
        g.waypoints.count = 2; g.waypoints.distanceMaps = [0, 1].map(() => Array.from({ length: g.grid.width }, () => Array(g.grid.height).fill(100)));
        g.waypoints.distanceMaps[1]![20]![10] = 2; m.waypointAlreadyVisited = [true, true];
        update(m); expect(m.state).toBe(MonsterState.WANDERING); expect(m.targetWaypointIndex).toBe(1); expect(m.waypointAlreadyVisited[1]).toBe(false);
    });
    it.each([24, 25, 26, 75, 76])('quarter-health entry / three-quarter retention at %i HP', hp => {
        const m = mob('rat'); m.maxHp = 100; m.hp = hp; m.behaviorFlags.add('MONST_FLEES_NEAR_DEATH'); aware();
        update(m); expect(m.state).toBe(hp <= 25 ? MonsterState.FLEEING : MonsterState.HUNTING);
        m.state = MonsterState.FLEEING; update(m); expect(m.state).toBe(hp <= 75 ? MonsterState.FLEEING : MonsterState.HUNTING);
    });
    it('remembering a waypoint consumes no RNG and survives until lazy initialization on actual wandering', () => {
        const m = mob('rat'); m.lastSeenPlayerAt = { x: 20, y: 10 }; aware(false);
        g.waypoints.count = 2;
        g.waypoints.distanceMaps = [0, 1].map(index => Array.from({ length: g.grid.width }, (_, x) =>
            Array.from({ length: g.grid.height }, (_, y) => index ? Math.abs(x - 20) + Math.abs(y - 10) : 1000)));
        const before = rng.randomNumbersGenerated; update(m);
        expect(rng.randomNumbersGenerated).toBe(before); expect(m.waypointAlreadyVisited).toBeNull();
        expect(m.targetWaypointIndex).toBe(1);
        m.takeTurn(g, 10);
        expect(m.targetWaypointIndex).toBe(1); expect(m.waypointAlreadyVisited![1]).toBe(false);
        expect(m.loc).toEqual({ x: 12, y: 10 });
    });
    it('fears attackers within 3, recovers at 3, and respects fear, immunity, kamikaze and poisoned prey', () => {
        const m = mob('rat', 12, 10); aware(); m.behaviorFlags.add('MONST_MAINTAINS_DISTANCE');
        update(m); expect(m.state).toBe(MonsterState.FLEEING); m.loc.x = 13; update(m); expect(m.state).toBe(MonsterState.HUNTING);
        m.applyStatus('magical_fear', 4); update(m); expect(m.state).toBe(MonsterState.FLEEING);
        const enemy = mob('stone_guardian', 14, 10); enemy.isAlly = true;
        expect(monsterFleesFrom(m, enemy)).toBe(true); m.behaviorFlags.delete('MONST_MAINTAINS_DISTANCE');
        enemy.behaviorFlags.add('MONST_IMMOBILE'); expect(monsterFleesFrom(m, enemy)).toBe(false);
        enemy.abilityFlags.add('MA_KAMIKAZE'); expect(monsterFleesFrom(m, enemy)).toBe(true);
        enemy.abilityFlags.delete('MA_KAMIKAZE'); m.abilityFlags.add('MA_POISONS'); enemy.statusDurations.poisoned = 500; enemy.poisonAmount = 10;
        expect(monsterFleesFrom(m, enemy)).toBe(true);
    });
    it('feared enemies require both traversible terrain and an unobstructed creature path', () => {
        const m = mob('rat', 12, 10); m.behaviorFlags.add('MONST_MAINTAINS_DISTANCE'); aware();
        g.grid.setTerrain(11, 10, T.WALL); update(m); expect(m.state).toBe(MonsterState.HUNTING);
        g.grid.setTerrain(11, 10, T.FLOOR); const blocker = mob('rat', 11, 10);
        update(m); expect(m.state).toBe(MonsterState.HUNTING);
        blocker.setStatusDuration('invisible', 5); update(m); expect(m.state).toBe(MonsterState.FLEEING);
    });
    it('successful scheduled theft interrupts automatic travel', () => {
        const m = mob(); m.accuracy = 100; m.damageString = '0'; m.ticksUntilTurn = 0;
        g.player.inventory.addItem(ItemLoader.spawnFood('ration_of_food', 0, 0)!);
        g.autoPath = [{ x: 10, y: 11 }]; g.isMouseTraveling = true;
        vi.spyOn(rng, 'randPercent').mockReturnValue(true);
        g.handlePlayerAction('wait', undefined, 'system');
        expect(m.carriedItem).toBeTruthy(); expect(g.autoPath).toEqual([]); expect(g.isMouseTraveling).toBe(false);
    });
    it('thief keeps fleeing out of sight; loss of the item resets mode only after magical fear expires', () => {
        const m = mob(); m.creatureMode = MonsterMode.PERM_FLEEING; m.carriedItem = ItemLoader.spawnFood('ration_of_food', 0, 0)!;
        aware(false); update(m); expect(m.state).toBe(MonsterState.FLEEING);
        m.carriedItem = null; m.applyStatus('magical_fear', 3); update(m); expect(m.creatureMode).toBe(MonsterMode.PERM_FLEEING);
        m.setStatusDuration('magical_fear', 0); update(m); expect(m.creatureMode).toBe(MonsterMode.NORMAL); expect(m.state).toBe(MonsterState.HUNTING);
    });
    it('noise wakes a permanent thief without losing its mode or waking permanent-mode packmates', () => {
        const m = mob(), mate = mob('rat', 12, 10); mate.leader = m; mate.creatureMode = MonsterMode.PERM_FLEEING;
        m.creatureMode = MonsterMode.PERM_FLEEING; m.carriedItem = ItemLoader.spawnFood('ration_of_food', 0, 0)!;
        m.state = mate.state = MonsterState.ASLEEP; wakeMonster(g, m, 10);
        expect(m.state).toBe(MonsterState.FLEEING); expect(m.lastSeenPlayerAt).toEqual(g.player.loc); expect(mate.state).toBe(MonsterState.ASLEEP);
    });
    it('target-owned map reuses stale terrain / traveler costs until current target distance exceeds 3', () => {
        const m = mob('imp', 30, 10), map = getBlinkTargetMap(g, m, g.player);
        g.grid.setTerrain(20, 10, T.WALL); g.player.loc.x += 3;
        expect(getBlinkTargetMap(g, m, g.player)).toBe(map);
        g.player.loc.x++; expect(getBlinkTargetMap(g, m, g.player)).not.toBe(map);
    });
    it('safe terrain and ally maps persist through a player action and reset on the next action', () => {
        const terrain = getBlinkSafeTerrainMap(g), safety = getBlinkAllySafetyMap(g);
        g.grid.setTerrain(15, 10, T.PLAIN_FIRE); expect(getBlinkSafeTerrainMap(g)).toBe(terrain); expect(getBlinkAllySafetyMap(g)).toBe(safety);
        g.handlePlayerAction('wait', undefined, 'system'); expect(getBlinkSafeTerrainMap(g)).not.toBe(terrain); expect(getBlinkAllySafetyMap(g)).not.toBe(safety);
    });
    it('PERM_FLEEING survives thrown attempts and both damage bolt paths, with thrown miss retaining fear and bolt damage shortening it', () => {
        const m = mob(); m.hp = m.maxHp = 200; m.creatureMode = MonsterMode.PERM_FLEEING;
        const prepare = () => { m.state = MonsterState.WANDERING; m.setStatusDuration('magical_fear', 9); };
        prepare(); vi.spyOn(rng, 'randPercent').mockReturnValue(false); CombatSystem.resolveThrownWeapon(g.player, m, ItemLoader.spawnWeapon('dart', 0, 0)!, g.grid);
        expect(m.state).toBe(MonsterState.WANDERING); expect(m.getStatusDuration('magical_fear')).toBe(9);
        prepare(); vi.mocked(rng.randPercent).mockReturnValue(true); CombatSystem.resolveThrownWeapon(g.player, m, ItemLoader.spawnWeapon('dart', 0, 0)!, g.grid);
        expect(m.creatureMode).toBe(MonsterMode.PERM_FLEEING); expect(m.getStatusDuration('magical_fear')).toBe(1);
        vi.mocked(rng.randPercent).mockRestore();
        prepare(); const staff = ItemLoader.spawnStaff('staff_of_fire', 0, 0)!;
        g.zapBoltFromPlayer(getBoltForItem('staff_of_fire')!, staff, m.loc);
        expect(m.state).toBe(MonsterState.WANDERING); expect(m.getStatusDuration('magical_fear')).toBe(1);
        prepare(); const caster = mob('dar_battlemage', 15, 10);
        g.castMonsterBolt(caster, m, 'LIGHTNING');
        expect(m.state).toBe(MonsterState.WANDERING); expect(m.getStatusDuration('magical_fear')).toBe(1);
    });
});

it('matches the original compiled CE updateMonsterState over all 10,240 branch combinations', () => {
    const m = mob('rat'), perception = aware(), item = ItemLoader.spawnFood('ration_of_food', 0, 0)!;
    for (const [state, mode, flags, fear, steal, carrying, perceived, hp, closest, expectedState, expectedMode, seenX, ticks] of ceStates) {
        m.isAlly = state === 4; m.state = state === 4 ? MonsterState.WANDERING : state!;
        m.creatureMode = mode!; m.hp = hp!; m.maxHp = 100; m.ticksUntilTurn = 3;
        m.lastSeenPlayerAt = null; m.loc = { x: g.player.x + closest!, y: g.player.y };
        m.behaviorFlags = new Set(['MONST_MAINTAINS_DISTANCE']);
        for (const [bit, name] of [[1, 'MONST_ALWAYS_HUNTING'], [2, 'MONST_IMMOBILE'], [4, 'MONST_FLEES_NEAR_DEATH']] as const)
            if (flags! & bit) m.behaviorFlags.add(name);
        m.abilityFlags = new Set(steal ? ['MA_HIT_STEAL_FLEE'] : []); m.carriedItem = carrying ? item : null;
        m.statusDurations = fear ? { magical_fear: 2 } : {}; perception.mockReturnValue(!!perceived);
        update(m);
        const resultState = m.isAlly && m.state !== MonsterState.FLEEING ? 4 : m.state;
        expect([resultState, m.creatureMode, (m.lastSeenPlayerAt as { x: number } | null)?.x ?? -1, m.ticksUntilTurn],
            JSON.stringify([state,mode,flags,fear,steal,carrying,perceived,hp,closest])).toEqual([expectedState,expectedMode,seenX,ticks]);
    }
});
