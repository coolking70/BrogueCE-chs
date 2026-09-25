import { describe, expect, it } from 'vitest';
import { createHeadlessGame } from './harness';
import { ItemLoader } from '../engine/Items/ItemLoader';
import { ringBonus, turnsForFullRegenInThousandths } from '../engine/Items/RingBonuses';
import { equippedWisdomBonus, ringWisdomRechargeIncrement } from '../engine/Items/ArcanaRecharge';
import { CombatSystem } from '../engine/Combat/Combat';
import { Monster } from '../entities/Monster';
import { TerrainType } from '../engine/Map/Grid';

function ring(id: string, e: number, identified = true) {
    const item = ItemLoader.spawnRing(id, -1, -1)!;
    item.enchantment = e;
    item.identified = identified;
    return item;
}

describe('U15b CE ring equipment to consumer values', () => {
    it('uses actual and effective E, with timesEnchanted only capping unknown positive rings', () => {
        const r = ring('ring_of_wisdom', 4, false);
        expect(equippedWisdomBonus([r])).toBe(1);
        expect(ringWisdomRechargeIncrement(equippedWisdomBonus([r]))).toBe(12);
        r.timesEnchanted = 2;
        expect(equippedWisdomBonus([r])).toBe(3);
        r.identified = true;
        expect(equippedWisdomBonus([r])).toBe(4);
        r.identified = false;
        r.enchantment = -3;
        expect(equippedWisdomBonus([r])).toBe(-3);
    });

    it('applies both awareness rings to passive and manual search strength', () => {
        const g = createHeadlessGame(23);
        g.player.equip(ring('ring_of_awareness', 3, true));
        g.player.equip(ring('ring_of_awareness', -1, false));
        expect((g as any).awarenessBonus()).toBe(40);
        expect(Math.max(60, (g as any).awarenessBonus() + 30)).toBe(70);
        g.player.ringLeft = ring('ring_of_awareness', -2);
        g.player.ringRight = null;
        expect((g as any).awarenessBonus()).toBe(-40);
    });

    it('feeds stealth E into the CE range with fourfold cursed penalty', () => {
        const g = createHeadlessGame(25);
        const baseline = (g as any).calculateStealthRange();
        g.player.equip(ring('ring_of_stealth', 3));
        expect((g as any).calculateStealthRange()).toBe(Math.max(2, baseline - 3));
        g.player.ringLeft = ring('ring_of_stealth', -2);
        expect((g as any).calculateStealthRange()).toBe(baseline + 8);
    });

    it('uses CE fixed point regeneration table at negative, zero and positive E', () => {
        expect(turnsForFullRegenInThousandths(0)).toBe(302000);
        expect(turnsForFullRegenInThousandths(2)).toBe(170750);
        expect(turnsForFullRegenInThousandths(-2)).toBe(535331);
        const g = createHeadlessGame(26);
        const p = g.player;
        p.hp = 1;
        const base = (p as any).regenRatePerTurn();
        p.equip(ring('ring_of_regeneration', 2));
        expect((p as any).regenRatePerTurn()).toBeGreaterThan(base);
        p.ringLeft = ring('ring_of_regeneration', -2);
        expect((p as any).regenRatePerTurn()).toBeLessThan(base);
    });

    it('transfers 5% per E on direct damage, including minimum one and negative self harm', () => {
        const g = createHeadlessGame(27);
        const p = g.player;
        const defender = Object.create(Monster.prototype) as Monster;
        defender.hp = 20;
        defender.behaviorFlags = new Set();
        p.hp = 10;
        p.equip(ring('ring_of_transference', 2));
        CombatSystem.transferMonsterHealth(p, defender, 7);
        expect(p.hp).toBe(11);
        p.ringLeft = ring('ring_of_transference', -2);
        CombatSystem.transferMonsterHealth(p, defender, 7);
        expect(p.hp).toBe(10);
        p.ringLeft = ring('ring_of_transference', 4);
        CombatSystem.transferMonsterHealth(p, defender, 15);
        expect(p.hp).toBe(13);
    });

    it('reveals and darkens within CE clairvoyance radius without RNG', () => {
        const g = createHeadlessGame(28);
        g.monsters = [];
        g.player.loc = { x: 20, y: 20 };
        for (let x = 15; x <= 25; x++) for (let y = 15; y <= 25; y++) {
            g.grid.setTerrain(x, y, TerrainType.FLOOR);
        }
        g.grid.setTerrain(21, 20, TerrainType.WALL);
        const cell = g.grid.getCell(22, 20)!;
        const nearby = g.grid.getCell(20, 21)!;
        (g as any).updateVision();
        expect(cell.isVisible).toBe(false);
        expect(nearby.isVisible).toBe(true);
        g.player.equip(ring('ring_of_clairvoyance', 2));
        (g as any).updateVision();
        expect(cell.isVisible).toBe(true);
        expect(cell.isClairvoyantVisible).toBe(true);
        g.player.ringLeft = ring('ring_of_clairvoyance', -2);
        (g as any).updateVision();
        expect(nearby.isVisible).toBe(false);
    });

    it('adds equipped bonuses for two rings and caps unknown positive E independently', () => {
        const a = ring('ring_of_clairvoyance', 3, false);
        const b = ring('ring_of_clairvoyance', -2, false);
        expect(ringBonus([a, b], 'ring_of_clairvoyance')).toBe(-1);
        a.identified = true;
        expect(ringBonus([a, b], 'ring_of_clairvoyance')).toBe(1);
    });

    it('preserves timesEnchanted in the item snapshot and admits a carried ring for enchanting', () => {
        const g = createHeadlessGame(29);
        const r = ring('ring_of_regeneration', 4, false);
        r.timesEnchanted = 2;
        g.player.inventory.addItem(r);
        expect(g.canEnchantTarget(r)).toBe(true);
        const bridge = g as any;
        const saved = bridge.serializeItem(r);
        expect(saved.timesEnchanted).toBe(2);
        expect(ringBonus([bridge.deserializeItem(saved)], 'ring_of_regeneration')).toBe(3);
    });
});
