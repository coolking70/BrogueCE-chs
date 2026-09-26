import { describe, expect, it } from 'vitest';
import { createHeadlessGame } from './harness';

function finishAnimation(game: ReturnType<typeof createHeadlessGame>) {
    for (let i = 0; i < 100 && game.isAdvancing; i++) game.stepAdvancement();
    expect(game.isAdvancing).toBe(false);
}

describe('X2a recording checkpoints', () => {
    it('commits after the animated turn and matches synchronous recording, replay and seek', () => {
        const animated = createHeadlessGame(424242);
        animated.animationEnabled = true;
        animated.handlePlayerAction('wait');
        expect(animated.isAdvancing).toBe(true);
        expect(animated.recordedInputEvents).toHaveLength(1);
        expect(animated.recordedInputEvents[0]!.turn).toBe(0);
        expect(() => animated.exportRecording()).toThrow('advancing');
        finishAnimation(animated);
        const recording = animated.exportRecording();
        expect(recording.events).toHaveLength(1);
        expect(recording.events[0]!.turn).toBe(1);

        const synchronous = createHeadlessGame(424242);
        synchronous.handlePlayerAction('wait');
        expect(recording.events).toEqual(synchronous.exportRecording().events);

        expect(animated.loadReplay(recording)).toBe(true);
        animated.replayStep();
        expect(animated.replayCursor).toBe(0);
        finishAnimation(animated);
        expect(animated.replayCursor).toBe(1);
        expect(animated.replayError).toBeNull();
        animated.replaySeek(1);
        expect(animated.replayCursor).toBe(1);
        expect(animated.replayError).toBeNull();

        recording.events[0]!.tick++;
        expect(animated.loadReplay(recording)).toBe(true);
        animated.replaySeek(1);
        expect(animated.replayError).toContain('OOS at command 1');
    });

    it('records reference screen closes through the command boundary', () => {
        const game = createHeadlessGame(424243);
        game.handlePlayerAction('discoveries');
        expect(game.referenceScreen).toBe('discoveries');
        game.executeCommand('escape');
        expect(game.referenceScreen).toBeNull();
        game.handlePlayerAction('wait');
        const recording = game.exportRecording();
        expect(recording.events.map(event => event.action)).toEqual(['discoveries', 'escape', 'wait']);
        expect(game.loadReplay(recording)).toBe(true);
        game.replaySeek(3);
        expect(game.replayCursor).toBe(3);
        expect(game.replayError).toBeNull();
        expect(game.referenceScreen).toBeNull();
    });

    it('keeps a slow-turn checkpoint pending through the intermediate animation frame', () => {
        const game = createHeadlessGame(424244);
        game.animationEnabled = true;
        expect(game.player.applyStatus('slowed', 30)).toBe(true);
        game.handlePlayerAction('wait');
        expect(game.isAdvancing).toBe(true);
        expect(game.stepAdvancement()).toBe(true);
        expect(game.pendingPauseMs).toBe(25);
        expect(game.recordedInputEvents).toHaveLength(1);
        expect(game.recordedInputEvents[0]!.turn).toBe(0);
        finishAnimation(game);
        expect(game.recordedInputEvents).toHaveLength(1);

        const synchronous = createHeadlessGame(424244);
        expect(synchronous.player.applyStatus('slowed', 30)).toBe(true);
        synchronous.handlePlayerAction('wait');
        expect(game.exportRecording().events).toEqual(synchronous.exportRecording().events);
    });

    it('keeps every checkpoint equal across a mixed animated and synchronous command sequence', () => {
        const collect = (animated: boolean) => {
            const game = createHeadlessGame(424245);
            game.animationEnabled = animated;
            const act = (name: string, data?: unknown) => {
                game.handlePlayerAction(name, data);
                if (animated) finishAnimation(game);
            };
            act('wait');
            act('search');
            const origin = { ...game.player.loc };
            const delta = [[1, 0], [-1, 0], [0, 1], [0, -1]].find(([dx, dy]) =>
                game.grid.getCell(game.player.x + dx!, game.player.y + dy!)?.isPassable
                && !game.getMonsterAt(game.player.x + dx!, game.player.y + dy!));
            expect(delta).toBeDefined();
            act('move', { x: delta![0], y: delta![1] });
            act('toggle_inventory');
            act('escape');
            const food = game.player.inventory.items.find(item => item.category === 4)!;
            game.onConfirmRequest = () => false;
            game.executeItemCommand('eat', food);
            game.onConfirmRequest = () => true;
            game.executeItemCommand('eat', food);
            if (animated) finishAnimation(game);
            act('discoveries');
            act('escape');
            game.executeCommand('mouse_travel', origin);
            while (game.autoPath.length) game.stepAutoPath();
            act('stairs_down');
            return game.exportRecording().events;
        };
        const animated = collect(true);
        expect(animated.map(e => e.action)).toContain('auto_step');
        expect(animated).toEqual(collect(false));
    });
});
