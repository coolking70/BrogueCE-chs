import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createHeadlessGame } from './harness';
import { DungeonLayer, TerrainType } from '../engine/Map/Grid';
import { GasType } from '../engine/Environment/Gas';
import { logger } from '../engine/Systems/Logger';
import { timeSystem } from '../engine/Systems/Time';
import { rng } from '../engine/Random';

const fixture = new URL('../../ai_docs/reports/u-r4-trace.json.gz', import.meta.url);

type Scenario = 'slowed-environment' | 'hasted' | 'fall' | 'death';

function trace(kind: Scenario, animated: boolean) {
    const game = createHeadlessGame(27027, 'test');
    game.monsters.length = 0;
    game.items.length = 0;
    for (let x = 2; x <= 12; x++) for (let y = 2; y <= 8; y++)
        game.grid.setTerrain(x, y, TerrainType.FLOOR);
    game.player.loc = { x: 4, y: 5 };
    if (kind === 'slowed-environment') {
        game.grid.setTerrainLayer(9, 5, DungeonLayer.SURFACE, TerrainType.PLAIN_FIRE);
        game.environment.addGas(10, 5, GasType.POISON, 1000);
        game.player.applyStatus('slowed', 20);
    } else if (kind === 'hasted') {
        game.player.applyStatus('hasted', 20);
    } else if (kind === 'fall') {
        game.grid.setTerrain(5, 5, TerrainType.CHASM);
    } else {
        game.grid.setTerrainLayer(4, 5, DungeonLayer.SURFACE, TerrainType.PLAIN_FIRE);
        game.player.hp = 1;
    }
    game.animationEnabled = animated;

    const rows: unknown[] = [];
    const events: { text: string; color?: string }[] = [];
    const priv = game as unknown as { objectiveTimeBlock(): void };
    const originalBlock = priv.objectiveTimeBlock.bind(game);
    const originalLog = logger.log.bind(logger);
    logger.log = (text: string, color?: string) => { events.push({ text, color }); originalLog(text, color); };
    const snap = (step: string) => {
        // Snapshots reject a suspended generator; this read-only checkpoint temporarily
        // clears the guard and restores it before the next scheduler instruction.
        const advancing = game.isAdvancing;
        game.isAdvancing = false;
        try {
            const state = game.toSnapshot();
            state.savedAt = 0;
            rows.push({
                step,
                state,
                log: logger.getState(), events: [...events],
                tick: timeSystem.currentTick, rng: rng.getState(),
                recording: game.exportRecording().events,
            });
        } finally { game.isAdvancing = advancing; }
    };
    priv.objectiveTimeBlock = () => {
        originalBlock();
        snap('objective');
    };
    try {
        const commands: ReadonlyArray<readonly [string, unknown]> = kind === 'fall'
            ? [['move', { x: 1, y: 0 }]]
            : kind === 'death' ? [['wait', undefined]]
            : [['wait', undefined], ['search', undefined], ['move', { x: 1, y: 0 }], ['wait', undefined]];
        for (const [action, data] of commands) {
            game.handlePlayerAction(action, data, 'player');
            for (let n = 0; game.isAdvancing && n < 100; n++) game.stepAdvancement();
            expect(game.isAdvancing).toBe(false);
        }
        snap('final');
    } finally {
        priv.objectiveTimeBlock = originalBlock;
        delete (logger as { log?: unknown }).log;
    }
    return { rows, depth: game.depth, dead: game.isGameOver || game.player.hp <= 0 };
}

describe('UR4 objective block trace', () => {
    it('matches HEAD for complete snapshots, events, tick, both RNG streams and command log', () => {
        const scenarios: Scenario[] = ['slowed-environment', 'hasted', 'fall', 'death'];
        const result = Object.fromEntries(scenarios.map(kind => [kind, {
            continuous: trace(kind, false), animated: trace(kind, true),
        }])) as Record<Scenario, { continuous: ReturnType<typeof trace>; animated: ReturnType<typeof trace> }>;
        if (process.env.UR4_CAPTURE === '1') writeFileSync(fixture, gzipSync(JSON.stringify(result)));
        else expect(result).toEqual(JSON.parse(gunzipSync(readFileSync(fixture)).toString('utf8')));
        const withoutRecording = (rows: unknown[]) => rows.map(row => {
            const { recording: _recording, ...state } = row as Record<string, unknown>;
            const snapshot = state.state as { run: Record<string, unknown> };
            const { recordedInputEvents: _events, recordedInputIndex: _index, ...run } = snapshot.run;
            state.state = { ...snapshot, run };
            return state;
        });
        for (const kind of scenarios) {
            const objectiveRows = (rows: unknown[]) => rows.filter(row =>
                (row as { step: string }).step === 'objective');
            expect(withoutRecording(objectiveRows(result[kind].continuous.rows)))
                .toEqual(withoutRecording(objectiveRows(result[kind].animated.rows)));
        }
        expect(result['fall'].continuous.depth).toBe(2);
        expect(result['death'].continuous.dead).toBe(true);
    });
});
