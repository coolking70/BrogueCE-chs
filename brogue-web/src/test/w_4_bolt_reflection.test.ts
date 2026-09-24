import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Game } from '../engine/Core/Game';
import { Grid, TerrainType as T, DungeonLayer as L } from '../engine/Map/Grid';
import { EnvironmentManager } from '../engine/Environment/Gas';
import { Player } from '../entities/Player';
import { Monster, type MonsterData } from '../entities/Monster';
import monsters from '../data/monsters.json';
import { Item, ItemCategory } from '../engine/Items/Item';
import { ItemLoader } from '../engine/Items/ItemLoader';
import { BoltEffect, getBoltForItem, type BoltConfig } from '../engine/Combat/Bolt';
import { CEBoltType } from '../engine/Combat/BoltCatalog';
import { boltLine, traceBolt } from '../engine/Combat/BoltTrajectory';
import { projectileReflects } from '../engine/Combat/BoltReflection';
import { CombatSystem } from '../engine/Combat/Combat';
import { rng } from '../engine/Random';
import type { Pos } from '../types';

function scene() {
    const g = Object.create(Game.prototype) as Game;
    g.grid = new Grid(18, 12);
    for (let x = 0; x < 18; x++) for (let y = 0; y < 12; y++) {
        g.grid.setTerrain(x, y, T.FLOOR);
        g.grid.getCell(x, y)!.isVisible = true;
        g.grid.getCell(x, y)!.hasMemory = true;
    }
    g.player = new Player(4, 5); g.player.hp = g.player.maxHp = 100;
    g.monsters = []; g.items = []; g.environment = new EnvironmentManager(g.grid);
    g.spawnFloatingText = vi.fn(); g.spawnBlood = vi.fn();
    (g as unknown as { updateVision(): void }).updateVision = vi.fn();
    return g;
}
function monster(g: Game, x: number, y = 5, id = 'rat') {
    const m = new Monster(x, y, (monsters as MonsterData[]).find(m => m.id === id)!);
    m.maxHp = m.hp = 100; g.monsters.push(m); return m;
}
// W-5: construct before RNG spies/counters; these suites observe casting, not generation.
function prepareZap(g: Game, id = 'staff_of_fire', aim: Pos = { x: 8, y: 5 }, override?: Partial<BoltConfig>) {
    const item = id.startsWith('staff') ? ItemLoader.spawnStaff(id, -1, -1)! : ItemLoader.spawnWand(id, -1, -1)!;
    // W-8: fix instance E for trajectory fixtures; old 6/10 HP constants are retired.
    if (id.startsWith('staff')) item.enchantment = 2;
    return () => g.zapBoltFromPlayer({ ...getBoltForItem(id)!, ...override }, item, aim);
}
function zap(g: Game, id = 'staff_of_fire', aim: Pos = { x: 8, y: 5 }, override?: Partial<BoltConfig>) {
    return prepareZap(g, id, aim, override)();
}
function armor(g: Game, enchantment = 50) {
    const a = new Item('reflection armor', ']', 0xcccccc, ItemCategory.ARMOR);
    a.runicType = 'reflection'; a.enchantment = enchantment; a.strengthRequired = g.player.strength;
    g.player.equippedArmor = a; return a;
}
const recipients = (r: ReturnType<typeof zap>) => r.hits.map(h => h.creature);
beforeEach(() => { vi.restoreAllMocks(); ItemLoader.identifiedItems.clear(); rng.seedRandomGenerator(4404); });

describe('W-4 reflected travel (CE Items.c:4960-5065,5675-5705,5830-5852)', () => {
    it('fire retraces to the player: reflector is not a hit, frames include the return, instance E is retained on return', () => {
        const g = scene(), guardian = monster(g, 8, 5, 'stone_guardian');
        const cast = prepareZap(g);
        const roll = vi.spyOn(rng, 'randClumpedRange').mockReturnValue(3); // W-8 CE E2 minimum
        const r = cast();
        expect(roll).toHaveBeenCalledExactlyOnceWith(3, 9, 1);
        expect(r.path.map(p => p.x)).toEqual([5, 6, 7, 8, 7, 6, 5, 4]);
        expect(recipients(r)).toEqual([g.player]); expect(g.player.hp).toBe(97); expect(guardian.hp).toBe(100);
        expect(r.hits[0]!.pos).toEqual({ x: 4, y: 5 }); expect(r.landingPos).toEqual(g.player.loc);
        expect(r.frames.map(f => ({ x: f.x, y: f.y }))).toEqual(r.path);
        expect(r.reflections).toEqual([{ pos: { x: 8, y: 5 }, pathIndex: 3, creature: guardian, towardCaster: true }]);
        expect(r.outcome).toEqual({ autoID: true, casterMovement: null });
    });

    it('the first diagonal return follows the exact tuned incoming cells; extension passes the origin', () => {
        const g = scene(), guardian = monster(g, 10, 8, 'stone_guardian');
        const r = zap(g, 'staff_of_lightning', guardian.loc);
        const kink = r.reflections[0]!.pathIndex;
        expect(r.path.slice(kink + 1, 2 * kink + 1)).toEqual(r.path.slice(0, kink).reverse());
        expect(recipients(r)).toContain(g.player); expect(r.path).toContainEqual(g.player.loc);
        expect(r.path[r.path.length - 1]).not.toEqual(g.player.loc);
    });

    it('a second successful roll returns to the caster; a failed second roll reaches a bystander instead', () => {
        const g = scene(), golem = monster(g, 8, 5, 'golem'), bystander = monster(g, 8, 8);
        const cast = prepareZap(g, 'wand_of_slowness');
        const rolls = vi.spyOn(rng, 'randPercent').mockReturnValueOnce(true).mockReturnValueOnce(false);
        vi.spyOn(rng, 'randRange').mockReturnValue(16); // CE perimeter: south
        const r = cast();
        expect(recipients(r)).toEqual([bystander]); expect(bystander.statusDurations.slowed).toBe(50);
        expect(golem.hasStatus('slowed')).toBe(false); expect(g.player.hasStatus('slowed')).toBe(false);
        expect(r.reflections[0]!.towardCaster).toBe(false); expect(rolls).toHaveBeenCalledTimes(2);
        expect(r.outcome?.autoID).toBe(true);
    });

    it('reflection alone does not identify damage magic; an empty random branch has no hits or HP loss', () => {
        const g = scene(); monster(g, 8, 5, 'golem');
        const cast = prepareZap(g, 'staff_of_fire');
        vi.spyOn(rng, 'randPercent').mockReturnValueOnce(true).mockReturnValueOnce(false);
        vi.spyOn(rng, 'randRange').mockReturnValue(16);
        const r = cast();
        expect(r.reflections).toHaveLength(1); expect(r.hits).toEqual([]);
        expect(r.outcome?.autoID).toBe(false); expect(g.player.hp).toBe(100);
        expect(r.landingPos).toEqual({ x: 8, y: 11 });
    });

    it('piercing revisits an earlier hit, hits the player and a creature behind the caster; later reflectors remain relevant', () => {
        const g = scene(), first = monster(g, 6), guardian = monster(g, 10, 5, 'stone_guardian'), behind = monster(g, 2);
        const cast = prepareZap(g, 'staff_of_lightning', first.loc);
        // W-8: one independent CE damage roll for each actual contact.
        vi.spyOn(rng, 'randClumpedRange').mockReturnValueOnce(3).mockReturnValueOnce(4).mockReturnValueOnce(5).mockReturnValueOnce(6);
        const r = cast();
        expect(recipients(r)).toEqual([first, first, g.player, behind]);
        expect([first.hp, guardian.hp, g.player.hp, behind.hp]).toEqual([93, 100, 95, 94]);
        expect(r.hits.map(h => h.pos.x)).toEqual([6, 6, 4, 2]);
    });

    it('openPath examines only cells before the candidate; execution can reflect beyond the aimed candidate', () => {
        const g = scene(), first = monster(g, 6); monster(g, 10, 5, 'stone_guardian');
        const item = ItemLoader.spawnStaff('staff_of_lightning', -1, -1)!; ItemLoader.identifyItemKind(item);
        expect(g.getArcanaCandidates(item)).toEqual([first]);
        const r = g.zapBoltFromPlayer(getBoltForItem('staff_of_lightning')!, item, first.loc);
        expect(r.reflections).toHaveLength(1); expect(recipients(r)).toEqual([first, first, g.player]);
    });

    it('terrain reflects before the crystal on any layer, with live obstruction on the new branch', () => {
        const g = scene(), bystander = monster(g, 6, 9);
        g.grid.setTerrainLayer(7, 5, L.SURFACE, T.CRYSTAL_WALL);
        g.grid.setTerrain(6, 7, T.WALL);
        const cast = prepareZap(g, 'wand_of_slowness');
        vi.spyOn(rng, 'randRange').mockReturnValue(16);
        const r = cast();
        expect(r.path).toEqual([{ x: 5, y: 5 }, { x: 6, y: 5 }, { x: 6, y: 6 }, { x: 6, y: 7 }]);
        expect(r.reflections).toEqual([{ pos: { x: 6, y: 5 }, pathIndex: 1, creature: null, towardCaster: false }]);
        expect(r.hits).toEqual([]); expect(bystander.hasStatus('slowed')).toBe(false);
    });

    it('random direction retries blocked first cells and stops after 50 failed attempts', () => {
        const g = scene(); monster(g, 8, 5, 'golem'); g.grid.setTerrain(8, 6, T.WALL);
        const cast = prepareZap(g, 'wand_of_slowness');
        vi.spyOn(rng, 'randPercent').mockReturnValueOnce(true).mockReturnValueOnce(false);
        const direction = vi.spyOn(rng, 'randRange').mockReturnValue(16);
        const r = cast();
        expect(direction).toHaveBeenCalledTimes(50); expect(r.landingPos).toEqual({ x: 8, y: 6 });
        expect(r.hits).toEqual([]); expect(r.outcome?.autoID).toBe(false);
    });

    it('random retry accepts the next open direction without rescoring for allies/enemies', () => {
        const g = scene(); monster(g, 8, 5, 'golem'); g.grid.setTerrain(8, 6, T.WALL);
        const bystander = monster(g, 11); bystander.isAlly = true;
        const cast = prepareZap(g, 'wand_of_slowness');
        vi.spyOn(rng, 'randPercent').mockReturnValueOnce(true).mockReturnValueOnce(false);
        const direction = vi.spyOn(rng, 'randRange').mockReturnValueOnce(16).mockReturnValueOnce(35);
        const r = cast();
        expect(direction).toHaveBeenCalledTimes(2); expect(recipients(r)).toEqual([bystander]);
        expect(bystander.statusDurations.slowed).toBe(50);
    });

    it('repeated guaranteed reflection terminates at the CE path budget and keeps every animation/hit index finite', () => {
        const g = scene(), guardian = monster(g, 8, 5, 'stone_guardian'); armor(g);
        // Returning to the original caster reflects randomly (CE same-origin guard).
        const cast = prepareZap(g, 'wand_of_slowness');
        vi.spyOn(rng, 'randRange').mockImplementation((_lo, hi) => hi === 39 ? 35 : 0);
        const r = cast();
        expect(r.reflections.length).toBeGreaterThan(10);
        expect(r.path.length).toBeLessThanOrEqual(g.grid.width * 10);
        expect(r.reflections.every(e => e.pathIndex < g.grid.width * 10 - Math.max(g.grid.width, g.grid.height))).toBe(true);
        expect(r.hits).toHaveLength(1); expect([g.player, guardian]).toContain(r.hits[0]!.creature);
        // W-9: path-budget contact reaches the INANIMATE guardian; a hit is
        // an effect attempt, not a bypass of the CE slow eligibility gate.
        expect(r.hits[0]!.creature).toBe(guardian);
        expect(guardian.hasStatus('slowed')).toBe(false);
        expect(g.player.hasStatus('slowed')).toBe(false);
        expect(r.outcome?.autoID).toBe(true);
    });

    it('maxRange counts outbound and return cells; a reflector at the limit does not become a damage hit', () => {
        const g = scene(); monster(g, 8, 5, 'stone_guardian');
        const r = zap(g, 'staff_of_fire', { x: 8, y: 5 }, { maxRange: 4 });
        expect(r.path).toHaveLength(4); expect(r.reflections).toHaveLength(1); expect(r.hits).toEqual([]);
        expect(g.player.hp).toBe(100); expect(r.outcome?.autoID).toBe(false);
    });

    it('preview and automatic targeting stay RNG-free and do not identify reflection armor', () => {
        const g = scene(), guardian = monster(g, 8, 5, 'stone_guardian'), a = armor(g);
        const item = ItemLoader.spawnStaff('staff_of_fire', -1, -1)!;
        const before = rng.randomNumbersGenerated;
        const preview = (g as unknown as { computeBoltResult(b: BoltConfig, from: Pos, to: Pos): ReturnType<typeof zap> })
            .computeBoltResult(getBoltForItem('staff_of_fire')!, g.player.loc, guardian.loc);
        g.getArcanaCandidates(item);
        expect(preview.outcome).toBeNull(); expect(preview.reflections).toEqual([]);
        expect(recipients(preview)).toEqual([guardian]); expect(rng.randomNumbersGenerated).toBe(before);
        expect(a.runicKnown).toBeFalsy();
    });
});

describe('W-4 recipient dispatch and boundaries', () => {
    it.each([
        ['staff_of_poison', 'poisoned', 5], ['wand_of_slowness', 'slowed', 50],
        ['wand_of_invisibility', 'invisible', 150],
    ] as const)('%s reaches the player (W-9 slow/invisibility; W-10 retires poison 12 in favor of CE E2=5)', (id, status, duration) => {
        const g = scene(), guardian = monster(g, 8, 5, 'stone_guardian');
        const r = zap(g, id);
        expect(recipients(r)).toEqual([g.player]); expect(g.player.statusDurations[status]).toBe(duration);
        expect(guardian.hasStatus(status)).toBe(false); expect(r.outcome?.autoID).toBe(true);
    });

    it('reflected teleport moves the caster and snapshots the contact before movement, without autoID', () => {
        const g = scene(); monster(g, 8, 5, 'stone_guardian');
        const cast = prepareZap(g, 'wand_of_teleportation');
        // W-11: old fixture forced a visible coordinate (2,3), forbidden by CE.
        // Keep the movement/reflection assertion, supply one legal hidden cell.
        for (let x = 10; x < 18; x++) for (let y = 0; y < 12; y++) g.grid.setTerrain(x, y, T.WALL);
        g.grid.setTerrain(13, 3, T.FLOOR);
        const r = cast();
        expect(recipients(r)).toEqual([g.player]); expect(r.hits[0]!.pos).toEqual({ x: 4, y: 5 });
        expect(r.outcome).toEqual({ autoID: false, casterMovement: { from: { x: 4, y: 5 }, to: { x: 13, y: 3 } } });
    });

    it('W-9 closes reflected discord: actual player gets discordant at catalog magnitude 10 * 4', () => {
        const g = scene(); monster(g, 8, 5, 'stone_guardian');
        const r = zap(g, 'wand_of_slowness', { x: 8, y: 5 }, { effect: BoltEffect.DISCORD, ceType: CEBoltType.DISCORD });
        expect(recipients(r)).toEqual([g.player]); expect(g.player.statusDurations.discordant).toBe(40);
        expect(g.player.hasStatus('confused')).toBe(false);
    });

    it('U06 monster return rolls catalog damage on the caster then the player behind it', () => {
        const g = scene(), caster = monster(g, 6), guardian = monster(g, 8, 5, 'stone_guardian');
        const attack = vi.spyOn(CombatSystem, 'attack');
        const roll = vi.spyOn(rng, 'randClumpedRange').mockReturnValueOnce(2).mockReturnValueOnce(6);
        const r = g.castMonsterBolt(caster, guardian, 'SPARK')!;
        expect(recipients(r)).toEqual([caster, g.player]);
        expect(attack).not.toHaveBeenCalled();
        expect(roll.mock.calls).toEqual([[2, 6, 1], [2, 6, 1]]);
        expect([caster.hp, g.player.hp]).toEqual([98, 94]);
        expect(g.lastDamageSource).toBe(caster.name);
        expect(r.outcome?.autoID).toBe(true); expect(guardian.hp).toBe(100);
    });

    it('actual reflected recipient invulnerability is checked instead of the original reflector defense', () => {
        const g = scene(), caster = monster(g, 6, 5, 'Warden_of_Yendor'), guardian = monster(g, 8, 5, 'stone_guardian');
        const r = g.castMonsterBolt(caster, guardian, 'FIRE')!;
        expect(recipients(r)).toEqual([caster]); expect(caster.hp).toBe(100); expect(guardian.hp).toBe(100);
        expect(r.outcome?.autoID).toBe(true);
    });

    it('reflection precedes invulnerability for a creature carrying both flags', () => {
        const g = scene(), guardian = monster(g, 8, 5, 'stone_guardian');
        vi.spyOn(guardian, 'isInvulnerable').mockReturnValue(true);
        const cast = prepareZap(g);
        vi.spyOn(rng, 'randClumpedRange').mockReturnValue(3); // W-8 CE E2 minimum
        const r = cast();
        expect(recipients(r)).toEqual([g.player]); expect(g.player.hp).toBe(97); expect(guardian.hp).toBe(100);
    });

    it.each(['DISTANCE_ATTACK', 'POISON_DART'])('%s never reflects from monster/armor/crystal and remains a physical attack', name => {
        for (const targetType of ['monster', 'armor', 'crystal']) {
            const g = scene(), caster = monster(g, 10);
            let target = g.player as Player | Monster;
            if (targetType === 'monster') target = monster(g, 6, 5, 'stone_guardian');
            if (targetType === 'armor') armor(g);
            if (targetType === 'crystal') g.grid.setTerrain(7, 5, T.CRYSTAL_WALL);
            const attack = vi.spyOn(CombatSystem, 'attack');
            const r = g.castMonsterBolt(caster, target, name)!;
            expect(r.reflections).toEqual([]);
            expect(recipients(r)).toEqual(targetType === 'crystal' ? [] : [target]);
            if (targetType !== 'crystal') expect(attack).toHaveBeenLastCalledWith(caster, target, { isWeaponAttack: true });
            attack.mockRestore();
        }
    });

    it('BE_ATTACK respects weapon immunity while the unchanged BE_DAMAGE formula still hurts revenants', () => {
        const g = scene(), caster = monster(g, 10, 5, 'dragon'), target = monster(g, 6, 5, 'revenant');
        vi.spyOn(rng, 'randPercent').mockReturnValue(true);
        for (const name of ['DISTANCE_ATTACK', 'POISON_DART']) {
            const r = g.castMonsterBolt(caster, target, name)!;
            expect(target.hp).toBe(100); expect(recipients(r)).toEqual([target]); expect(r.outcome?.autoID).toBe(true);
        }
        g.castMonsterBolt(caster, target, 'FIRE'); expect(target.hp).toBeLessThan(100);
    });

    it('adjacent casting reflects before damage and identifies armor; the old post-hit hook cannot reflect twice', () => {
        const g = scene(), caster = monster(g, 5), a = armor(g);
        const r = g.castMonsterBolt(caster, g.player, 'SLOW_2')!;
        expect(recipients(r)).toEqual([caster]); expect(caster.statusDurations.slowed).toBe(10); // W-9 CE catalog magnitude 2 * 5, numerically unchanged
        expect(g.player.hasStatus('slowed')).toBe(false); expect(a.runicKnown).toBe(true);
        const hp = caster.hp, before = rng.randomNumbersGenerated;
        g.tryTriggerArmorRunic(caster, 20);
        expect(caster.hp).toBe(hp); expect(rng.randomNumbersGenerated).toBe(before);
    });

    it('zero/negative reflection level never rolls; guaranteed monster reflection does not consume RNG', () => {
        const g = scene(); armor(g, 0);
        const rolls = vi.spyOn(rng, 'randPercent');
        expect(projectileReflects(g.player)).toBe(false);
        expect(projectileReflects(monster(g, 8, 5, 'stone_guardian'))).toBe(true);
        expect(rolls).not.toHaveBeenCalled();
    });

    it('immunity armor reflects only its enemy class, using the original caster; no roll or armor autoID', () => {
        const g = scene(), caster = monster(g, 8), a = armor(g);
        a.runicType = 'immunity'; a.vorpalEnemy = 'animal';
        const rolls = vi.spyOn(rng, 'randPercent');
        expect(projectileReflects(g.player, caster)).toBe(true);
        expect(projectileReflects(g.player, null)).toBe(false);
        a.vorpalEnemy = 'dragon'; expect(projectileReflects(g.player, caster)).toBe(false);
        a.vorpalEnemy = 'animal'; caster.isAlly = true;
        expect(projectileReflects(g.player, caster)).toBe(false);
        caster.isAlly = false;
        const r = g.castMonsterBolt(caster, g.player, 'SLOW_2')!;
        expect(recipients(r)).toEqual([caster]); expect(g.player.hasStatus('slowed')).toBe(false);
        expect(a.runicKnown).toBeFalsy(); expect(rolls).not.toHaveBeenCalled();
    });

    it('reflectors skip cell effects while the returned branch exposes terrain in travel order', () => {
        const g = scene(); monster(g, 8, 5, 'stone_guardian');
        const ignite = vi.spyOn(g.environment, 'ignite');
        zap(g);
        expect(ignite.mock.calls.map(c => c[0])).toEqual([5, 6, 7, 7, 6, 5, 4]);
    });

    it('W-8 reverses the W-4 split assumption: player-reflected fire damages the bystander but does not split', () => {
        const g = scene(), golem = monster(g, 8, 5, 'golem'), jelly = monster(g, 8, 8, 'pink_jelly');
        const cast = prepareZap(g, 'staff_of_fire');
        vi.spyOn(rng, 'randPercent').mockReturnValueOnce(true).mockReturnValueOnce(false);
        vi.spyOn(rng, 'randRange').mockImplementation((lo, hi) => hi === 39 ? 16 : lo);
        const r = cast();
        expect(recipients(r)).toEqual([jelly]); expect(golem.hp).toBe(100);
        // CE Items.c:5210-5213: !alreadyReflected || caster != &player.
        // The former [47,47] asserted old constant damage AND missed this guard.
        expect(g.monsters.filter(m => m.typeId === 'pink_jelly').map(m => m.hp)).toEqual([97]);
        expect((jelly.statusDurations as Record<string, number>).burning).toBe(7);
    });

    it('a moved or dead occupant is not a stale hit on the return path', () => {
        const g = scene(), first = monster(g, 6), guardian = monster(g, 10, 5, 'stone_guardian');
        const world = { caster: g.player, creatureAt: (p: Pos) => [g.player, ...g.monsters].find(c => c.hp > 0 && c.loc.x === p.x && c.loc.y === p.y) };
        const r = traceBolt(g.grid, getBoltForItem('staff_of_lightning')!, g.player.loc, guardian.loc, world, {
            onCell: (_p, hit) => { if (hit?.creature === first) first.loc.y = 8; },
        });
        expect(recipients(r)).toEqual([first, g.player]); expect(r.hits[0]!.pos).toEqual({ x: 6, y: 5 });
        expect(boltLine(g.grid, g.player.loc, guardian.loc)).toContainEqual({ x: 17, y: 5 });
    });
});
