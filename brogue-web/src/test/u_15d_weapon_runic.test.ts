import { describe, expect, it, vi } from 'vitest';
import { CombatSystem } from '../engine/Combat/Combat';
import { Player } from '../entities/Player';
import { Monster, MonsterState, type MonsterData } from '../entities/Monster';
import { Item, ItemCategory } from '../engine/Items/Item';
import { rng } from '../engine/Random';
import monsters from '../data/monsters.json';
import { createHeadlessGame } from './harness';
import { TerrainType } from '../engine/Map/Grid';
import { serializeItem, deserializeItem } from '../engine/Core/EntitySnapshot';
import { monsterIsInClass } from '../engine/Combat/MonsterClass';
import { runicWeaponChance, weaponParalysisDuration, weaponSlowDuration,
    weaponConfusionDuration, weaponImageCount, weaponImageDuration,
    weaponForceDistance } from '../engine/Combat/CombatFormulas';

// Golden values from CE PowerTables.c:99-104,220-345, for a 3..4 damage
// weapon (adjustedBaseDamage=3). Each row exercises different enchant levels.
describe('U15d CE weapon runic golden values', () => {
    it.each([
        ['speed', 13, 36, 59], ['quietus', 5, 15, 27],
        ['paralyzing', 6, 17, 31], ['multiplicity', 12, 34, 56],
        ['slowing', 11, 32, 53], ['confusion', 9, 26, 45],
        ['force', 12, 34, 56],
    ])('%s chance at enchant 1/3/6', (kind, c1, c3, c6) => {
        const weapon = { damageMin: 3, damageMax: 4 };
        expect([1, 3, 6].map(e => runicWeaponChance(e, kind as string, weapon)))
            .toEqual([c1, c3, c6]);
    });

    it('slaying uses the target class; harmful runics use fixed 15%', () => {
        expect(runicWeaponChance(6, 'slaying', { damageMin: 3, damageMax: 4 })).toBe(0);
        expect(runicWeaponChance(1, 'mercy')).toBe(15);
        expect(runicWeaponChance(6, 'plenty')).toBe(15);
        expect(monsterIsInClass('rat', 'animal')).toBe(true);
        expect(monsterIsInClass('rat', 'undead')).toBe(false);
        expect(monsterIsInClass('revenant', 'undead')).toBe(true);
        expect(monsterIsInClass('revenant', 'infernal')).toBe(true);
        expect(monsterIsInClass('goblin_warlord', 'goblin')).toBe(true);
    });

    it('counterfactual: CE table runics at E10 are not the legacy 15% fallback', () => {
        const dagger = { damageMin: 3, damageMax: 4 };
        expect(runicWeaponChance(10, 'multiplicity', dagger)).toBe(74);
        expect(runicWeaponChance(10, 'slowing', dagger)).toBe(72);
    });

    it('effect magnitudes follow CE integer truncation', () => {
        expect([1, 3, 6].map(weaponParalysisDuration)).toEqual([2, 3, 5]);
        expect([1, 3, 6].map(weaponConfusionDuration)).toEqual([3, 4, 9]);
        expect([1, 3, 6].map(weaponSlowDuration)).toEqual([3, 8, 21]);
        expect([1, 3, 6].map(weaponImageCount)).toEqual([1, 1, 2]);
        expect([1, 3, 6].map(weaponImageDuration)).toEqual([3, 3, 3]);
        expect([1, 3, 6].map(weaponForceDistance)).toEqual([4, 8, 14]);
    });

    it.each(['speed', 'quietus', 'paralyzing', 'multiplicity', 'slowing',
        'confusion', 'force', 'mercy', 'plenty'])('%s: one runic RNG draw after a live hit', kind => {
        const player = new Player(4, 4);
        const weapon = new Item('dagger', '/', 0xffffff, ItemCategory.WEAPON);
        weapon.damage = '1d1'; weapon.strengthRequired = 12;
        weapon.runicType = kind;
        player.equippedWeapon = weapon;
        const rat = new Monster(5, 4, (monsters as MonsterData[]).find(m => m.id === 'rat')!);
        rat.hp = rat.maxHp = 100;
        rat.state = MonsterState.WANDERING;
        const percent = vi.spyOn(rng, 'randPercent').mockReturnValue(true);
        try {
            const result = CombatSystem.attack(player, rat);
            expect(result.hit).toBe(true);
            expect(result.triggeredRunic).toBe(kind);
            expect(percent).toHaveBeenCalledTimes(1);
        } finally { percent.mockRestore(); }
    });

    it('slaying misses other classes without consuming the runic RNG', () => {
        const player = new Player(4, 4);
        const weapon = new Item('dagger', '/', 0xffffff, ItemCategory.WEAPON);
        weapon.damage = '1d1'; weapon.strengthRequired = 12;
        weapon.runicType = 'slaying'; weapon.vorpalEnemy = 'undead';
        player.equippedWeapon = weapon;
        const rat = new Monster(5, 4, (monsters as MonsterData[]).find(m => m.id === 'rat')!);
        rat.state = MonsterState.WANDERING;
        const percent = vi.spyOn(rng, 'randPercent');
        try {
            const result = CombatSystem.attack(player, rat);
            expect(result.hit).toBe(true);
            expect(result.triggeredRunic).toBeUndefined();
            expect(percent).not.toHaveBeenCalled();
        } finally { percent.mockRestore(); }
    });

    it('slaying always triggers on its class with one runic RNG draw', () => {
        const player = new Player(4, 4);
        const weapon = new Item('dagger', '/', 0xffffff, ItemCategory.WEAPON);
        weapon.damage = '1d1'; weapon.strengthRequired = 12;
        weapon.runicType = 'slaying'; weapon.vorpalEnemy = 'animal';
        player.equippedWeapon = weapon;
        const rat = new Monster(5, 4, (monsters as MonsterData[]).find(m => m.id === 'rat')!);
        rat.state = MonsterState.WANDERING;
        const percent = vi.spyOn(rng, 'randPercent').mockReturnValue(true);
        try {
            expect(CombatSystem.attack(player, rat).triggeredRunic).toBe('slaying');
            expect(percent).toHaveBeenCalledOnce();
            expect(percent).toHaveBeenCalledWith(100);
        } finally { percent.mockRestore(); }
    });

    it('fatal contact only rolls speed or multiplicity', () => {
        for (const kind of ['quietus', 'speed', 'multiplicity']) {
            const player = new Player(4, 4);
            const weapon = new Item('dagger', '/', 0xffffff, ItemCategory.WEAPON);
            weapon.damage = '1d1'; weapon.strengthRequired = 12;
            weapon.runicType = kind; player.equippedWeapon = weapon;
            const rat = new Monster(5, 4, (monsters as MonsterData[]).find(m => m.id === 'rat')!);
            rat.hp = 1; rat.state = MonsterState.WANDERING;
            const percent = vi.spyOn(rng, 'randPercent').mockReturnValue(true);
            try {
                const result = CombatSystem.attack(player, rat);
                expect(rat.hp).toBe(0);
                expect(result.triggeredRunic).toBe(kind === 'quietus' ? undefined : kind);
                expect(percent).toHaveBeenCalledTimes(kind === 'quietus' ? 0 : 1);
            } finally { percent.mockRestore(); }
        }
    });

    it('speed grants a free action and mercy heals half maximum HP', () => {
        const game = createHeadlessGame(151);
        const target = new Monster(5, 4, (monsters as MonsterData[]).find(m => m.id === 'rat')!);
        const weapon = new Item('dagger', '/', 0xffffff, ItemCategory.WEAPON);
        game.player.equippedWeapon = weapon;
        const effect = (kind: string) => (game as unknown as {
            applyWeaponRunicEffect(target: Monster, damage: number, kind: string): void
        }).applyWeaponRunicEffect(target, 3, kind);
        game.player.ticksUntilTurn = 100;
        const hp = target.hp;
        effect('speed');
        expect(game.player.ticksUntilTurn).toBe(-1);
        expect(target.hp).toBe(hp);
        target.maxHp = 10; target.hp = 2;
        effect('mercy');
        expect(target.hp).toBe(7);
    });

    it('multiplicity creates timed negatable allies; plenty clones the defender', () => {
        const game = createHeadlessGame(152);
        game.monsters.length = 0;
        for (let x = 2; x <= 8; x++) for (let y = 2; y <= 8; y++)
            game.grid.setTerrain(x, y, TerrainType.FLOOR, '.', 0x888888);
        game.player.loc = { x: 4, y: 4 };
        const target = new Monster(5, 4, (monsters as MonsterData[]).find(m => m.id === 'rat')!);
        game.monsters.push(target);
        const weapon = new Item('dagger', '/', 0xffffff, ItemCategory.WEAPON);
        weapon.enchantment = 6; weapon.strengthRequired = game.player.effectiveStrength;
        game.player.equippedWeapon = weapon;
        const effect = (kind: string) => (game as unknown as {
            applyWeaponRunicEffect(target: Monster, damage: number, kind: string): void
        }).applyWeaponRunicEffect(target, 3, kind);
        effect('multiplicity');
        const images = game.monsters.filter(m => m.typeId === 'spectral_blade');
        expect(images).toHaveLength(2);
        for (const image of images) {
            expect(image.isAlly).toBe(true);
            expect(image.boundToPlayer).toBe(true);
            expect(image.getStatusDuration('lifespan_remaining')).toBe(3);
            expect(image.diesIfNegated()).toBe(true);
        }
        weapon.flags = ['ITEM_ATTACKS_QUICKLY'];
        effect('multiplicity');
        const quickImages = game.monsters.filter(m => m.typeId === 'spectral_blade').slice(2);
        expect(quickImages).toHaveLength(2);
        quickImages[0]!.refreshSpeeds();
        expect(quickImages[0]!.attackSpeed).toBe(50);
        effect('plenty');
        expect(game.monsters.filter(m => m.typeId === 'rat')).toHaveLength(2);
        weapon.runicType = 'slaying'; weapon.vorpalEnemy = 'animal';
        const restored = deserializeItem(serializeItem(weapon));
        expect(restored.vorpalEnemy).toBe('animal');
    });

    it('paralysis, slowing, and confusion end at CE durations', () => {
        const game = createHeadlessGame(153);
        const rat = new Monster(5, 4, (monsters as MonsterData[]).find(m => m.id === 'rat')!);
        const weapon = new Item('dagger', '/', 0xffffff, ItemCategory.WEAPON);
        weapon.enchantment = 6; weapon.strengthRequired = game.player.effectiveStrength;
        game.player.equippedWeapon = weapon;
        const effect = (kind: string) => (game as unknown as {
            applyWeaponRunicEffect(target: Monster, damage: number, kind: string): void
        }).applyWeaponRunicEffect(rat, 3, kind);
        effect('paralyzing');
        expect(rat.getStatusDuration('paralyzed')).toBe(5);
        rat.setStatusDuration('hasted', 7);
        effect('slowing');
        expect(rat.getStatusDuration('slowed')).toBe(21);
        expect(rat.getStatusDuration('hasted')).toBe(0);
        effect('confusion');
        expect(rat.getStatusDuration('confused')).toBe(9);
    });

    it('quietus and slaying kill; force travels up to CE distance', () => {
        const game = createHeadlessGame(154);
        game.monsters.length = 0;
        for (let x = 2; x <= 20; x++) for (let y = 2; y <= 8; y++)
            game.grid.setTerrain(x, y, TerrainType.FLOOR, '.', 0x888888);
        game.player.loc = { x: 4, y: 4 };
        const weapon = new Item('dagger', '/', 0xffffff, ItemCategory.WEAPON);
        weapon.enchantment = 3; weapon.strengthRequired = game.player.effectiveStrength;
        game.player.equippedWeapon = weapon;
        const effect = (target: Monster, kind: string) => (game as unknown as {
            applyWeaponRunicEffect(target: Monster, damage: number, kind: string): void
        }).applyWeaponRunicEffect(target, 3, kind);
        const rat = () => new Monster(5, 4, (monsters as MonsterData[]).find(m => m.id === 'rat')!);
        const first = rat(); game.monsters.push(first);
        effect(first, 'force');
        expect(first.x).toBe(13); // CE distance(3)=8
        const second = rat(); game.monsters.push(second);
        effect(second, 'quietus');
        expect(second.hp).toBe(0);
        const third = rat(); game.monsters.push(third);
        effect(third, 'slaying');
        expect(third.hp).toBe(0);
    });
});
