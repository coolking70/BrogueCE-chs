import { vi } from 'vitest';
import * as features from '../engine/Combat/CreatureFeatures';
import { rng } from '../engine/Random';

/** Observe real blood DF costs without changing any roll or terrain effect. */
export function withBloodRng<T>(action: () => T) {
    const original = features.spawnCreatureBlood;
    let draws = 0, calls = 0;
    const spy = vi.spyOn(features, 'spawnCreatureBlood').mockImplementation((...args) => {
        const before = rng.randomNumbersGenerated;
        try { calls++; return original(...args); }
        finally { draws += rng.randomNumbersGenerated - before; }
    });
    try { return { result: action(), get draws() { return draws; }, get calls() { return calls; } }; }
    finally { spy.mockRestore(); }
}
