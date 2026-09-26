import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { createHeadlessGame } from './harness';
import { rng } from '../engine/Random';
import { logger } from '../engine/Systems/Logger';
import { setMachineObservationHook, type MachineTrace } from '../engine/Generator/MachineObservation';

const fixture = new URL('../../ai_docs/reports/u-r3-trace.json.gz', import.meta.url);
const seeds = [424242, 777, 20260913, 31337];

function capture(seed: number) {
    const observations: MachineTrace[] = [];
    const game = createHeadlessGame(seed);
    setMachineObservationHook(trace => observations.push(JSON.parse(JSON.stringify(trace)) as MachineTrace));
    game.startNewGame({ seed, mode: 'normal' });
    const generate = (game as unknown as { generateDepth(up: boolean, first: boolean, fell?: boolean): void }).generateDepth.bind(game);
    const row = () => {
        const snapshot = game.toSnapshot();
        snapshot.savedAt = 0;
        const hash = createHash('sha256').update(JSON.stringify({ snapshot, rng: rng.getState(), log: logger.getState(), observations })).digest('hex');
        return { hash, depth: game.depth, monsters: game.monsters.length, items: game.items.length, observations: observations.length };
    };
    const depths = [row()];
    for (let depth = 2; depth <= 26; depth++) {
        game.depth = depth;
        generate(false, false);
        depths.push(row());
    }
    const saved = game.toSnapshot();
    game.depth = 25; generate(true, false);
    const revisit = row();
    game.depth = 26; generate(false, false);
    const returnTo26 = row();
    expect(game.loadSnapshot(saved)).toBe(true);
    const loaded = row();
    setMachineObservationHook(null);
    const falling = createHeadlessGame(seed);
    const fallGenerate = (falling as unknown as { generateDepth(up: boolean, first: boolean, fell?: boolean): void }).generateDepth.bind(falling);
    falling.depth = 2;
    fallGenerate(false, false, true);
    const fallSnapshot = falling.toSnapshot();
    fallSnapshot.savedAt = 0;
    const fall = createHash('sha256').update(JSON.stringify({ snapshot: fallSnapshot, rng: rng.getState(), log: logger.getState() })).digest('hex');
    return { depths, revisit, returnTo26, loaded, fall };
}

describe('UR3 complete generation and revisit trace', () => {
    it('matches HEAD for four drift seeds through D26 and cached/save return', () => {
        const result = Object.fromEntries(seeds.map(seed => [seed, capture(seed)]));
        if (process.env.UR3_CAPTURE === '1') writeFileSync(fixture, gzipSync(JSON.stringify(result)));
        else expect(result).toEqual(JSON.parse(gunzipSync(readFileSync(fixture)).toString('utf8')));
    }, 300000);
});
