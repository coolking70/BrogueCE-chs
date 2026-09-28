import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import i18next from 'i18next';
import { createHeadlessGame } from './harness';
import { type Game } from '../engine/Core/Game';
import { TerrainType as T, DungeonLayer as L } from '../engine/Map/Grid';
import { spawnDungeonFeature, catalogFeature } from '../engine/Map/DungeonFeature';
import { DF } from '../engine/Map/DungeonFeatureCatalog';
import { ItemLoader } from '../engine/Items/ItemLoader';
import { Monster, MonsterState, type MonsterData } from '../entities/Monster';
import monsters from '../data/monsters.json';
import { logger } from '../engine/Systems/Logger';
import { rng } from '../engine/Random';

afterEach(() => vi.restoreAllMocks());

function scene(game = createHeadlessGame(44002, 'test')) {
    game.monsters = []; game.dormantMonsters = []; game.items = [];
    game.visibleMonsters.clear(); game.visibleItems.clear();
    for (let x = 0; x < game.grid.width; x++) for (let y = 0; y < game.grid.height; y++) {
        game.grid.setTerrain(x, y, x && y && x < game.grid.width - 1 && y < game.grid.height - 1 ? T.FLOOR : T.WALL);
    }
    game.player.loc = { x: 10, y: 10 };
    (game as any).updateVision();
    game.updateFlavorText();
    return game;
}
function settle(game: Game) {
    for (let n = 0; n < 100 && game.isAdvancing; n++) game.stepAdvancement();
    expect(game.isAdvancing).toBe(false);
}
function snapshot(game: Game) {
    const { savedAt: _, ...state } = game.toSnapshot();
    return structuredClone(state);
}
const terrainName = (game: Game, terrain: T): string => (game as any).getTerrainName(terrain);
const standing = (terrain: string) => i18next.t('df.flavor', { terrain, defaultValue: 'You are standing on {{terrain}}.' });

describe('X4b CE flavorMessage display/archive boundary', () => {
    it.each([false, true])('tramples foliage and opens a door without log entries (animated=%s)', animated => {
        const g = scene(); g.animationEnabled = animated;
        g.grid.setTerrain(11, 10, T.FOLIAGE);
        g.grid.setTerrain(12, 10, T.DOOR);
        const log = vi.spyOn(logger, 'log');
        for (const [x, terrain] of [[11, T.TRAMPLED_FOLIAGE], [12, T.OPEN_DOOR]] as const) {
            g.executeCommand('move', { x: 1, y: 0 }); settle(g);
            expect(g.player.loc).toEqual({ x, y: 10 });
            expect(g.grid.getCell(x, 10)!.terrain).toBe(terrain);
            expect(g.flavorText).toBe(standing(terrainName(g, terrain)));
        }
        expect(log).not.toHaveBeenCalled();
        g.executeCommand('move', { x: 1, y: 0 }); settle(g);
        expect(g.flavorText).toBe(standing(terrainName(g, T.FLOOR)));
        g.flavorText = 'stale'; g.executeCommand('wait'); settle(g);
        expect(g.flavorText).toBe(standing(terrainName(g, T.FLOOR)));
        expect(log).not.toHaveBeenCalled();
    });

    it('DF changes refresh immediately only under the grounded player; describe still logs', () => {
        const g = scene(), log = vi.spyOn(logger, 'log');
        const feature = { ...catalogFeature(DF.DF_OPEN_DOOR), description: '', subsequentDF: 0 };
        spawnDungeonFeature(g.grid, 10, 10, feature, false);
        expect(g.flavorText).toBe(standing(terrainName(g, T.OPEN_DOOR)));
        expect(log).not.toHaveBeenCalled();
        g.flavorText = 'sentinel';
        spawnDungeonFeature(g.grid, 11, 10, feature, false);
        expect(g.flavorText).toBe('sentinel');
        g.player.setStatusDuration('levitating', 10);
        g.grid.setTerrain(10, 10, T.FLOOR);
        spawnDungeonFeature(g.grid, 10, 10, feature, false);
        expect(g.flavorText).toBe('sentinel');
        spawnDungeonFeature(g.grid, 12, 10, { ...feature, description: 'The test mechanism moves.' }, false);
        expect(log).toHaveBeenCalledWith('The test mechanism moves.');
    });

    it('automatic travel clears inspection and finishes with the destination description', () => {
        const g = scene(); g.grid.setTerrain(11, 10, T.GRASS);
        g.updateHover(9, 10);
        g.executeCommand('mouse_travel', { x: 11, y: 10 });
        expect(g.hoveredText).toBe('');
        g.stepAutoPath();
        expect(g.player.loc).toEqual({ x: 11, y: 10 }); expect(g.autoPath).toEqual([]);
        expect(g.flavorText).toBe(standing(terrainName(g, T.GRASS)));
        g.flavorText = 'stale';
        g.autoPath = [{ x: 12, y: 10 }];
        g.grid.setTerrain(12, 10, T.WALL);
        const c = g.grid.getCell(12, 10)!;
        c.rememberedLayers = [...c.layers]; c.rememberedTerrain = T.WALL;
        g.stepAutoPath();
        expect(g.autoPath).toEqual([]);
        expect(g.flavorText).toBe(standing(terrainName(g, T.GRASS)));
    });

    it('retains combat, pickup and item discovery messages in the archive', () => {
        const g = scene(), log = vi.spyOn(logger, 'log');
        const rat = new Monster(11, 10, (monsters as MonsterData[]).find(m => m.id === 'rat')!);
        rat.state = MonsterState.HUNTING; rat.ticksUntilTurn = 100000; rat.hp = rat.maxHp = 100;
        g.monsters.push(rat);
        g.executeCommand('move', { x: 1, y: 0 });
        expect(log.mock.calls.some(([text]) => /You (hit|missed|backstab)/.test(text))).toBe(true);
        g.monsters = [];
        const item = ItemLoader.spawnPotion('potion_of_strength', 10, 10)!;
        g.items.push(item);
        g.onRenderRequested = () => {}; (g as any).needsRender = true; g.update();
        expect(log.mock.calls.some(([text]) => text.includes('You notice a'))).toBe(true);
        g.executeCommand('pickup');
        expect(g.player.inventory.items).toContain(item);
        expect(log.mock.calls.some(([text]) => text.includes('You picked up'))).toBe(true);
        expect(logger.messages.some(m => m.text.includes('You picked up'))).toBe(true);
    });

    it('refresh/hover are read-only for saves, both RNG streams and recordings; load/new run rebuild display', () => {
        const g = scene(), before = snapshot(g), random = rng.getState(), recording = g.exportRecording();
        const saved = g.toSnapshot();
        for (let i = 0; i < 8; i++) { g.updateFlavorText(); g.updateHover(11, 10); g.clearHover(); }
        expect(snapshot(g)).toEqual(before); expect(rng.getState()).toEqual(random);
        expect(g.exportRecording().events).toEqual(recording.events);
        expect(JSON.stringify(saved)).not.toContain('flavorText');
        g.flavorText = 'stale'; g.updateHover(12, 10);
        expect(g.loadSnapshot(saved)).toBe(true);
        expect(g.flavorText).toBe(standing(terrainName(g, T.FLOOR)));
        expect(g.hoveredText).toBe(''); expect(snapshot(g)).toEqual(before);
        g.flavorText = 'stale'; g.startNewGame({ seed: 44002, mode: 'test' });
        expect(g.flavorText).not.toBe('stale'); expect(g.flavorText).not.toBe('');
    });

    it('uses gas terrain and reuses location description for levitation without overwriting hover', () => {
        const g = scene();
        g.grid.setTerrainLayer(10, 10, L.GAS, T.POISON_GAS);
        g.updateFlavorText(); expect(g.flavorText).toBe(standing(terrainName(g, T.POISON_GAS)));
        g.player.setStatusDuration('levitating', 10);
        g.updateHover(10, 10); const location = g.hoveredText;
        g.updateHover(9, 10); const hover = g.hoveredText;
        const random = rng.getState(); g.updateFlavorText();
        expect(g.flavorText).toBe(location); expect(g.hoveredText).toBe(hover);
        expect(rng.getState()).toEqual(random);
    });

    it('replays terrain transitions with interleaved display refresh and hover at zero OOS', () => {
        const setup = (g?: Game) => {
            const game = scene(g); game.grid.setTerrain(11, 10, T.FOLIAGE); game.grid.setTerrain(12, 10, T.DOOR); return game;
        };
        const g = setup();
        g.executeCommand('move', { x: 1, y: 0 });
        g.executeCommand('move', { x: 1, y: 0 });
        g.executeCommand('wait');
        const recording = g.exportRecording(), expected = snapshot(g), random = rng.getState();
        expect(JSON.stringify(recording)).not.toContain('flavorText');
        expect(g.loadReplay(recording)).toBe(true); setup(g);
        for (let n = 0; n < recording.events.length; n++) {
            g.updateHover(9, 10); g.updateFlavorText(); g.clearHover();
            g.replayStep(true); expect(g.replayError).toBeNull();
        }
        expect(g.replayCursor).toBe(recording.events.length);
        expect(g.player.loc).toEqual(expected.player.loc);
        expect(rng.getState()).toEqual(random);
        expect(g.flavorText).toBe(standing(terrainName(g, T.OPEN_DOOR)));
    });

    it('desktop and compact HUD put inspection before flavor, on the existing secondary line', () => {
        const sidebar = readFileSync('src/components/Sidebar.vue', 'utf8');
        const hud = readFileSync('src/ui/useGameHud.ts', 'utf8');
        const strip = readFileSync('src/components/MessageStrip.vue', 'utf8');
        expect(sidebar).toContain('activeGame.hoveredText || activeGame.flavorText');
        expect(hud).toContain('game.hoveredText || game.flavorText');
        expect(strip).toContain('class="strip-hover"');
        expect(strip).toContain('useGameHud(props.lines)');
    });
});
