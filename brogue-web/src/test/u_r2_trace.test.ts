import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHeadlessGame } from './harness';
import { ItemLoader } from '../engine/Items/ItemLoader';
import { Item } from '../engine/Items/Item';
import { logger } from '../engine/Systems/Logger';
import { timeSystem } from '../engine/Systems/Time';
import { rng } from '../engine/Random';
import { Monster, type MonsterData } from '../entities/Monster';
import monsters from '../data/monsters.json';
import { TerrainType } from '../engine/Map/Grid';

const fixture = new URL('../../ai_docs/reports/u-r2-trace.json', import.meta.url);

function trace(kind: string, make: () => Item | null, commands: (game: ReturnType<typeof createHeadlessGame>, item: Item, snap: (step: string) => void) => void) {
    const game = createHeadlessGame(27027, 'test');
    game.monsters = [];
    const item = make();
    if (!item) throw new Error(`missing ${kind}`);
    game.player.inventory.addItem(item);
    const rows: unknown[] = [];
    const snap = (step: string) => rows.push({
        step,
        player: { loc: { ...game.player.loc }, hp: game.player.hp, maxHp: game.player.maxHp,
            status: { ...game.player.statusDurations }, strength: game.player.strength },
        resources: game.player.inventory.items.map(i => ({ id: i.id, category: i.category, quantity: i.quantity,
            charges: i.charges, cooldown: i.cooldownRemaining, enchantment: i.enchantment,
            timesUsed: i.timesUsed, identified: i.identified })),
        floor: game.items.map(i => ({ id: i.id, loc: i.loc, quantity: i.quantity })),
        monsters: game.monsters.map(m => ({ id: m.id, loc: m.loc, hp: m.hp, status: m.statusDurations })),
        log: logger.getState(), tick: timeSystem.currentTick, turn: game.absoluteTurnNumber,
        pending: { confirm: game.pendingUseConfirm?.id ?? null, identify: game.pendingIdentify,
            enchant: game.pendingEnchantment, arcana: game.pendingArcana?.cursor ?? null },
        rng: rng.getState(),
        commandLog: game.exportRecording().events.map(e => ({ action: e.action, data: e.data, decisions: e.decisions })),
    });
    snap('initial');
    commands(game, item, snap);
    return { kind, rows };
}

describe('UR2 fixed command traces', () => {
    it('matches the pre-refactor state after each item command', () => {
        const traces = [
            trace('potion', () => ItemLoader.spawnPotion('potion_of_healing', -1, -1), (g, i, snap) => {
                g.player.hp -= 8;
                g.executeItemCommand('quaff', i); snap('quaff');
            }),
            trace('scroll', () => ItemLoader.spawnScroll('scroll_of_identify', -1, -1), (g, i, snap) => {
                g.executeItemCommand('read', i); snap('read');
            }),
            trace('wand-cancel-and-use', () => ItemLoader.spawnWand('wand_of_slowness', -1, -1), (g, i, snap) => {
                g.executeItemCommand('use', i); snap('aim');
                g.executeCommand('cancel_target'); snap('cancel');
                g.executeItemCommand('use', i);
                g.executeCommand('move', 3); snap('retarget');
                g.executeCommand('confirm_target'); snap('confirm');
            }),
            trace('charm', () => ItemLoader.spawnCharm('charm_of_health', -1, -1), (g, i, snap) => {
                g.player.hp -= 8;
                g.executeItemCommand('use', i); snap('use');
                g.executeItemCommand('use', i); snap('cooldown');
            }),
            trace('throw-stack', () => ItemLoader.spawnWeapon('dart', -1, -1), (g, i, snap) => {
                i.quantity = 3;
                g.executeItemCommand('throw', i); snap('aim');
                g.executeCommand('throw-target', undefined, () => g.throwItemAt(i, g.player.loc.x + 2, g.player.loc.y)); snap('throw');
            }),
            trace('refused-potion', () => ItemLoader.spawnPotion('potion_of_incineration', -1, -1), (g, i, snap) => {
                ItemLoader.identifyItemKind(i);
                g.executeItemCommand('quaff', i); snap('pending');
                g.executeItemCommand('cancel'); snap('refused');
            }),
            trace('empty-wand', () => ItemLoader.spawnWand('wand_of_slowness', -1, -1), (g, i, snap) => {
                i.charges = 0;
                i.identified = false;
                g.executeItemCommand('use', i);
                g.setArcanaTarget(g.player.loc.x + 2, g.player.loc.y);
                g.executeCommand('confirm_target'); snap('empty');
            }),
            trace('reflected-staff', () => ItemLoader.spawnStaff('staff_of_poison', -1, -1), (g, i, snap) => {
                for (let x = 4; x <= 9; x++) g.grid.setTerrain(x, 5, TerrainType.FLOOR);
                g.player.loc = { x: 5, y: 5 };
                const guardianData = (monsters as MonsterData[]).find(m => m.id === 'stone_guardian')!;
                g.monsters.push(new Monster(8, 5, guardianData));
                g.executeItemCommand('use', i);
                g.setArcanaTarget(8, 5);
                g.executeCommand('confirm_target'); snap('reflected');
            }),
        ];
        if (process.env.UR2_CAPTURE === '1') writeFileSync(fixture, JSON.stringify(traces, null, 2) + '\n');
        else expect(traces).toEqual(JSON.parse(readFileSync(fixture, 'utf8')));
    });
});
