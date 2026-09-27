import { rng, Random, RNGType } from '../Random';
import type { LightSourceDef } from '../Map/LightCatalog';

/** CE's light sampling formula, deliberately on the cosmetic stream (X2m).
 * Base updateVision/level generation must never draw from either RNG stream. */
export function cosmeticDraw<T>(draw: (random: Random) => T, random = rng): T {
    const previous = random.getState().currentRNG;
    random.setRNG(RNGType.RNG_COSMETIC);
    try { return draw(random); } finally { random.setRNG(previous); }
}

// Idle rendering has its own continuation of the cosmetic stream. Browser
// frame counts must not change the command-recording RNG checkpoint, nor the
// subsequent flare samples that contribute persistent exploration knowledge.
const displayStreams = new WeakMap<object, Random>();
export function displayRandom(owner: object): Random {
    let random = displayStreams.get(owner);
    if (!random) {
        random = new Random(); random.setState(rng.getState());
        random.setRNG(RNGType.RNG_COSMETIC); displayStreams.set(owner, random);
    }
    return random;
}

export function sampleLight(source: LightSourceDef, coefficient = 100000, random = rng): LightSourceDef {
    return cosmeticDraw(random => {
        // Light.c drawFlareFrame scales the radius with full precision, but
        // applyColorScalar uses the integer percentage, including random parts.
        const scale = (n: number) => Math.trunc(n * Math.trunc(coefficient / 1000) / 100);
        const c = source.color;
        const radius = random.randClumpedRange(
            Math.trunc(source.radius.lowerBound * coefficient / 100000),
            Math.trunc(source.radius.upperBound * coefficient / 100000), source.radius.clumpFactor);
        const shared = random.randRange(0, scale(c.rand));
        return { ...source, radius: { lowerBound: radius, upperBound: radius, clumpFactor: 1 }, color: {
            red: scale(c.red) + shared + random.randRange(0, scale(c.redRand)),
            green: scale(c.green) + shared + random.randRange(0, scale(c.greenRand)),
            blue: scale(c.blue) + shared + random.randRange(0, scale(c.blueRand)),
            redRand: 0, greenRand: 0, blueRand: 0, rand: 0,
        } };
    }, random);
}

export interface Flare {
    x: number;
    y: number;
    kind: number;
    coeff: number;
    change: number;
}

interface FlareState {
    turn: number;
    frame: number;
    /** Sample once in simulation order; presentation never consumes RNG. */
    samples?: LightSourceDef[];
}

// Presentation cache, keyed by the queue entry: discarded with the queue on
// level travel/load/reset. Keep animation bookkeeping out of the event payload.
const states = new WeakMap<Flare, FlareState>();
export function flareState(flare: Flare, turn = 0): FlareState {
    let state = states.get(flare);
    if (!state) { state = { turn, frame: -1 }; states.set(flare, state); }
    return state;
}

export function prepareFlare(flare: Flare, source: LightSourceDef): void {
    const state = flareState(flare);
    if (state.samples) return;
    state.samples = [];
    let coeff = flare.coeff, change = flare.change;
    while (true) {
        coeff += Math.trunc(change * 100);
        change = Math.trunc(change * 12 / 10);
        // CE casts coeff/1000 to short before comparing to the zero limit.
        if (Math.trunc(coeff / 1000) < 0) break;
        state.samples.push(sampleLight(source, coeff));
    }
}
