import { describe, expect, it } from 'vitest';
import { Game } from '../engine/Core/Game';
import { LightKind } from '../engine/Map/LightCatalog';
import { TerrainType } from '../engine/Map/Grid';
import { visibleMonsterRows } from '../engine/UI/MonsterSidebar';

describe('U21c transient display', () => {
    it('paints a radius-six flare and removes its light when it expires', () => {
        const game = new Game();
        const { x, y } = game.player.loc;
        for (let dx = -6; dx <= 6; dx++) for (let dy = -6; dy <= 6; dy++) {
            if (game.grid.isValidPos(x + dx, y + dy)) game.grid.setTerrain(x + dx, y + dy, TerrainType.FLOOR);
        }
        const before = { ...game.visualLightAt(x, y)! };
        game.createFlare(x, y, LightKind.SCROLL_ENCHANTMENT_LIGHT);
        expect(game.tickFlareAnimation(10)).toBe(true);
        expect(game.visualLightAt(x, y)!.r).toBeGreaterThan(before.r);
        expect(game.visualLightAt(x + 5, y)!.r).toBeGreaterThan(game.lightMap.lightAt(x + 5, y)!.r);
        expect(game.tickFlareAnimation(1000)).toBe(true);
        expect(game.visualLightAt(x, y)).toEqual(before);
    });

    it('requests one clean render when the last projectile frame ends', () => {
        const game = new Game();
        game.pendingBoltFrames = [{ x: 1, y: 1, char: '*', color: 0xffffff, durationMs: 10 }];
        game.boltAnimStartTime = Date.now() - 100;
        expect(game.tickBoltAnimation()).toBe(true);
        expect(game.getCurrentBoltFrame()).toBeNull();
        expect(game.tickBoltAnimation()).toBe(false);
    });

    it('shows only monsters that pass U21a identity visibility', () => {
        const game = new Game();
        const monster = game.monsters[0]!;
        expect(monster).toBeDefined();
        monster.loc = { x: game.player.loc.x + 1, y: game.player.loc.y };
        game.grid.getCell(monster.loc.x, monster.loc.y)!.isVisible = true;
        expect(visibleMonsterRows(game.player, game.grid, [monster])).toHaveLength(1);
        monster.setStatusDuration('invisible', 10);
        expect(visibleMonsterRows(game.player, game.grid, [monster])).toHaveLength(0);
    });
});
