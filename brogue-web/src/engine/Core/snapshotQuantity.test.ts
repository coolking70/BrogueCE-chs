/**
 * src/engine/Core/snapshotQuantity.test.ts — 存读档 quantity 往返回归
 *
 * Item.quantity（开局飞镖 ×15）此前未纳入 GameSnapshotItem 序列化，
 * 读档后 15 支飞镖会回落为 1。本文件锁定两件事：
 *   1. toSnapshot → loadSnapshot 往返后 quantity 不丢；
 *   U01：旧存档兼容不再是需求，保留数量往返守卫。
 */
import { describe, it, expect } from 'vitest';
import { createHeadlessGame } from '../../test/harness';
import { ItemCategory, type Item } from '../Items/Item';

function findDart(items: Item[]): Item {
    const dart = items.find(i => i.category === ItemCategory.WEAPON && i.name === 'Dart');
    if (!dart) throw new Error('背包中未找到飞镖');
    return dart;
}

describe('存读档 quantity 往返（开局飞镖 ×15）', () => {
    it('toSnapshot → loadSnapshot 往返后飞镖 quantity 仍为 15', () => {
        const game = createHeadlessGame(20260914);
        expect(findDart(game.player.inventory.items).quantity).toBe(15);

        const snapshot = game.toSnapshot();
        // 序列化点：快照里的飞镖条目本身要带 quantity
        const dartInSnapshot = snapshot.player.inventory.find(
            (s) => s.category === ItemCategory.WEAPON && s.name === 'Dart'
        );
        expect(dartInSnapshot).toBeDefined();
        expect(dartInSnapshot!.quantity).toBe(15);

        // 反序列化点：loadSnapshot 覆盖全新实例后 quantity 保持
        const reloaded = createHeadlessGame(1); // 状态会被 loadSnapshot 完整覆盖
        expect(reloaded.loadSnapshot(snapshot)).toBe(true);
        expect(findDart(reloaded.player.inventory.items).quantity).toBe(15);
    });


});
