import { describe, expect, it } from 'vitest';
import { createHeadlessGame } from './harness';
import { DungeonLayer, Grid, TerrainType } from '../engine/Map/Grid';
import { cellAppearance, rememberedItemAppearance } from '../engine/UI/Appearance';
import { restoreGrid, snapshotGrid } from '../engine/Core/LevelSnapshot';
import { ItemLoader } from '../engine/Items/ItemLoader';

const ctx = { gas: undefined, lightChannels: null, groundItem: null, carriedItem: null, hallucinating: false,
    cosmetic: { percent: () => false, pick: <T>(values: readonly T[]) => values[0]! } };

describe('U23 historical map knowledge', () => {
    it('renders and saves observed terrain and item after hidden world changes', () => {
        const grid = new Grid(3, 3);
        const cell = grid.getCell(1, 1)!;
        grid.setTerrain(1, 1, TerrainType.DOOR);
        cell.isExplored = cell.hasMemory = true;
        cell.rememberedLayers = [...cell.layers];
        cell.rememberedTerrain = cell.terrain;
        cell.rememberedItem = { name: 'old item', char: '!', color: 0xffffff };
        const before = cellAppearance(cell, ctx)?.char;
        grid.setTerrain(1, 1, TerrainType.OPEN_DOOR);
        expect(cellAppearance(cell, ctx)?.char).toBe(before);
        expect(rememberedItemAppearance(cell)?.char).toBe('!');
        const restored = restoreGrid(3, 3, snapshotGrid(grid), []);
        expect(restored.getCell(1, 1)?.rememberedTerrain).toBe(TerrainType.DOOR);
        expect(restored.getCell(1, 1)?.rememberedItem?.name).toBe('old item');
    });

    it('mapping records only dungeon and liquid, reveals a secret door and leaves granite dark', () => {
        const game = createHeadlessGame(2323);
        game.grid.setTerrain(3, 3, TerrainType.SECRET_DOOR);
        game.grid.setTerrain(4, 3, TerrainType.GRANITE);
        game.grid.setTerrain(5, 3, TerrainType.FLOOR);
        game.grid.setTerrainLayer(5, 3, DungeonLayer.SURFACE, TerrainType.WEB);
        game.grid.setTerrain(6, 3, TerrainType.GAS_TRAP_PARALYSIS_HIDDEN);
        for (const [x, y] of [[3, 3], [4, 3], [5, 3], [6, 3]] as const) {
            const cell = game.grid.getCell(x, y)!;
            cell.isVisible = cell.isExplored = cell.hasMemory = false;
        }
        const scroll = ItemLoader.spawnScroll('scroll_of_magic_mapping', -1, -1)!;
        game.player.inventory.addItem(scroll);
        game.readItem(scroll);
        const door = game.grid.getCell(3, 3)!;
        const granite = game.grid.getCell(4, 3)!;
        const floor = game.grid.getCell(5, 3)!;
        const trap = game.grid.getCell(6, 3)!;
        expect(door.isMagicMapped).toBe(true);
        expect(door.rememberedTerrain).toBe(TerrainType.DOOR);
        expect(door.isExplored).toBe(false);
        expect(granite.isMagicMapped).toBe(false);
        expect(granite.knownTrapFree).toBe(true);
        expect(floor.rememberedLayers[DungeonLayer.SURFACE]).toBe(TerrainType.NOTHING);
        expect(floor.isExplored).toBe(false);
        expect(trap.rememberedTerrain).toBe(TerrainType.GAS_TRAP_PARALYSIS);
        expect(trap.isExplored).toBe(false);
        expect(trap.knownTrapFree).toBe(false);
    });
});
