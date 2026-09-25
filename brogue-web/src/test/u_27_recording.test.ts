import { describe, expect, it } from 'vitest';
import { createHeadlessGame } from './harness';
import { ItemCategory } from '../engine/Items/Item';

describe('U27 command recording', () => {
    it('replays turns and inventory commands with both RNG streams checked', () => {
        const game = createHeadlessGame(27027);
        game.handlePlayerAction('wait');
        const food = game.player.inventory.items.find(item => item.category === ItemCategory.FOOD);
        expect(food).toBeDefined();
        game.executeItemCommand('eat', food!);
        const recording = game.exportRecording();
        expect(recording.version).toBe(2);
        expect(recording.events.every(e => e.rng && e.turn !== undefined && e.decisions)).toBe(true);
        expect(game.loadReplay(recording)).toBe(true);
        while (game.replayCursor < recording.events.length && !game.replayError) game.replayStep();
        expect(game.replayError).toBeNull();
        expect(game.replayCursor).toBe(recording.events.length);
    });

    it('rejects legacy recordings and reports the first changed checkpoint', () => {
        const game = createHeadlessGame(27028);
        game.handlePlayerAction('wait');
        game.handlePlayerAction('wait');
        const recording = game.exportRecording();
        expect(game.loadReplay({ ...recording, version: 1 })).toBe(false);
        recording.events[1]!.tick += 1;
        expect(game.loadReplay(recording)).toBe(true);
        game.replayStep();
        expect(game.replayError).toBeNull();
        game.replayStep();
        expect(game.replayError).toContain('OOS at command 2');
        expect(game.replayCursor).toBe(1);
        game.animationEnabled = true;
        game.replaySeek(2);
        expect(game.replayError).toContain('OOS at command 2');
        expect(game.replayCursor).toBe(1);
    });

    it('rejects exporting a partial recording after a save is loaded', () => {
        const game = createHeadlessGame(27029);
        game.handlePlayerAction('wait');
        const snapshot = game.toSnapshot();
        expect(game.loadSnapshot(snapshot)).toBe(true);
        expect(() => game.exportRecording()).toThrow('fresh new game');
    });

    it('records mouse travel and its autonomous steps as separate checked events', () => {
        const game = createHeadlessGame(27030);
        const { x, y } = game.player.loc;
        const destination = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]
            .find(([nx, ny]) => game.grid.getCell(nx!, ny!)?.isPassable && !game.getMonsterAt(nx!, ny!));
        expect(destination).toBeDefined();
        game.executeCommand('mouse_travel', { x: destination![0]!, y: destination![1]! });
        while (game.autoPath.length) game.stepAutoPath();
        const recording = game.exportRecording();
        expect(recording.events.map(event => event.action)).toEqual(['mouse_travel', 'auto_step']);
        expect(game.loadReplay(recording)).toBe(true);
        while (game.replayCursor < recording.events.length && !game.replayError) game.replayStep();
        expect(game.replayError).toBeNull();
    });

    it('replays a refused then accepted food confirmation without asking again', () => {
        const game = createHeadlessGame(27031);
        const food = game.player.inventory.items.find(item => item.category === ItemCategory.FOOD)!;
        game.onConfirmRequest = () => false;
        game.executeItemCommand('eat', food);
        expect(game.player.inventory.items).toContain(food);
        game.onConfirmRequest = () => true;
        game.executeItemCommand('eat', food);
        const recording = game.exportRecording();
        expect(recording.events.map(event => event.decisions)).toEqual([[false], [true]]);
        expect(game.loadReplay(recording)).toBe(true);
        game.onConfirmRequest = () => { throw new Error('replay opened a confirmation dialog'); };
        game.replayStep();
        game.replayStep();
        expect(game.replayError).toBeNull();
        expect(game.replayCursor).toBe(2);
    });
});
