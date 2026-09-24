/**
 * src/engine/Random.ts
 * Deterministic RNG ported from Brogue's Math.c
 */
import { normalizeSeed, type SeedInput } from './Seed';

export enum RNGType {
    RNG_SUBSTANTIVE = 0,
    RNG_COSMETIC = 1,
    NUMBER_OF_RNGS = 2
}

class Ranctx {
    public a: number = 0;
    public b: number = 0;
    public c: number = 0;
    public d: number = 0;
}

/** v1 deliberately identifies the pre-U02b low-32-bit seeding algorithm. */
export interface RandomState {
    version: 1;
    algorithm: 'brogue-web-ranval32-low32-v1';
    streams: [{ a: number; b: number; c: number; d: number }, { a: number; b: number; c: number; d: number }];
    currentRNG: RNGType.RNG_SUBSTANTIVE | RNGType.RNG_COSMETIC;
    randomNumbersGenerated: number;
    cosmeticNumbersGenerated: number;
}

export class Random {
    private rngStates: Ranctx[] = [new Ranctx(), new Ranctx()];
    private currentRNG: RNGType = RNGType.RNG_SUBSTANTIVE;

    // A 32-bit unsigned integer maximum
    private readonly RAND_MAX_COMBO = 4294967295;

    // Used to track how many substantive numbers generated
    public randomNumbersGenerated: number = 0;
    // Logical nondegenerate randRange calls, just like the substantive counter.
    public cosmeticNumbersGenerated: number = 0;

    constructor(seed: SeedInput = 0) {
        this.seedRandomGenerator(seed);
    }

    public setRNG(type: RNGType) {
        if (type !== RNGType.RNG_SUBSTANTIVE && type !== RNGType.RNG_COSMETIC) throw new RangeError('Invalid RNG stream');
        this.currentRNG = type;
    }

    public getState(): RandomState {
        return {
            version: 1, algorithm: 'brogue-web-ranval32-low32-v1',
            streams: [{ ...this.rngStates[0]! }, { ...this.rngStates[1]! }],
            currentRNG: this.currentRNG as RandomState['currentRNG'],
            randomNumbersGenerated: this.randomNumbersGenerated,
            cosmeticNumbersGenerated: this.cosmeticNumbersGenerated,
        };
    }

    public static isState(value: unknown): value is RandomState {
        if (!value || typeof value !== 'object') return false;
        const s = value as RandomState;
        const counter = (n: number) => Number.isSafeInteger(n) && n >= 0;
        return s.version === 1 && s.algorithm === 'brogue-web-ranval32-low32-v1'
            && (s.currentRNG === RNGType.RNG_SUBSTANTIVE || s.currentRNG === RNGType.RNG_COSMETIC)
            && counter(s.randomNumbersGenerated) && counter(s.cosmeticNumbersGenerated)
            && Array.isArray(s.streams) && s.streams.length === 2
            && [s.streams[0], s.streams[1]].every(r => r && ['a', 'b', 'c', 'd'].every(k => {
                const n = r[k as keyof typeof r];
                return Number.isInteger(n) && n >= 0 && n <= 0xffffffff;
            }));
    }

    /** Validate first, then copy: neither export nor import shares live state. No draws/reseeding. */
    public setState(state: RandomState): void {
        if (!Random.isState(state)) throw new RangeError('Unsupported or malformed RNG state');
        this.rngStates = state.streams.map(s => Object.assign(new Ranctx(), s));
        this.currentRNG = state.currentRNG;
        this.randomNumbersGenerated = state.randomNumbersGenerated;
        this.cosmeticNumbersGenerated = state.cosmeticNumbersGenerated;
    }

    private rot(x: number, k: number): number {
        // Javascript bitwise operators treat operands as 32-bit signed integers.
        // We use >>> 0 to ensure logical unsigned shift/conversion back to unsigned 32-bit.
        return (((x << k) | (x >>> (32 - k))) >>> 0);
    }

    private ranval(x: Ranctx): number {
        // Use >>> 0 to enforce 32-bit unsigned integer arithmetic in JS
        const e = (x.a - this.rot(x.b, 27)) >>> 0;
        x.a = (x.b ^ this.rot(x.c, 17)) >>> 0;
        x.b = (x.c + x.d) >>> 0;
        x.c = (x.d + e) >>> 0;
        x.d = (e + x.a) >>> 0;
        return x.d;
    }

    private raninit(x: Ranctx, seed: number) {
        x.a = 0xf1ea5eed;
        x.b = seed >>> 0;
        x.c = seed >>> 0;
        x.d = seed >>> 0;

        // U02a preserves the current sequence. CE's high-word XOR belongs to U02b.

        for (let i = 0; i < 20; ++i) {
            this.ranval(x);
        }
    }

    public seedRandomGenerator(seed: SeedInput = 0): string {
        let fullSeed = normalizeSeed(seed);
        if (fullSeed === '0') {
            // JS time is in MS. Divide by 1000 to get roughly UNIX epoch. 
            // In Math.c, it's: seed = time(NULL) - 1352700000;
            fullSeed = normalizeSeed(Math.floor(Date.now() / 1000) - 1352700000);
        }

        // Preserve all 64 bits in storage; only this algorithm boundary takes the low word.
        const lowSeed = Number(BigInt(fullSeed) & 0xffffffffn);

        this.raninit(this.rngStates[RNGType.RNG_SUBSTANTIVE]!, lowSeed);
        this.raninit(this.rngStates[RNGType.RNG_COSMETIC]!, lowSeed);

        this.randomNumbersGenerated = 0;
        this.cosmeticNumbersGenerated = 0;
        return fullSeed;
    }

    private range(n: number, rng: RNGType): number {
        // n is a long in C, representing interval
        const div = Math.floor(this.RAND_MAX_COMBO / n);
        let r: number;

        do {
            r = Math.floor(this.ranval(this.rngStates[rng]!) / div);
        } while (r >= n);

        return r;
    }

    public randRange(lowerBound: number, upperBound: number): number {
        if (upperBound <= lowerBound) {
            return lowerBound;
        }

        if (this.currentRNG === RNGType.RNG_SUBSTANTIVE) {
            this.randomNumbersGenerated++;
        } else {
            this.cosmeticNumbersGenerated++;
        }

        const interval = upperBound - lowerBound + 1;
        return lowerBound + this.range(interval, this.currentRNG);
    }

    public randPercent(percent: number): boolean {
        const clamped = Math.max(0, Math.min(percent, 100));
        return this.randRange(0, 99) < clamped;
    }

    public randClumpedRange(lowerBound: number, upperBound: number, clumpFactor: number): number {
        if (upperBound <= lowerBound) {
            return lowerBound;
        }
        if (clumpFactor <= 1) {
            return this.randRange(lowerBound, upperBound);
        }

        let total = 0;
        const numSides = Math.floor((upperBound - lowerBound) / clumpFactor);

        let i = 0;
        const remainder = (upperBound - lowerBound) % clumpFactor;

        for (i = 0; i < remainder; i++) {
            total += this.randRange(0, numSides + 1);
        }

        for (; i < clumpFactor; i++) {
            total += this.randRange(0, numSides);
        }

        return total + lowerBound;
    }

    // A "fair" shuffle (Fisher-Yates)
    public shuffleList<T>(list: T[]): void {
        const length = list.length;
        for (let i = 0; i < length - 1; i++) {
            const r = this.randRange(i, length - 1);
            if (i !== r) {
                const buf = list[r]!;
                list[r] = list[i]!;
                list[i] = buf;
            }
        }
    }

    /**
     * Parse and roll a standard D&D D-notation dice string like "1d4" বা "2d6+2"
     */
    public rollD(diceStr: string): number {
        if (!diceStr) return 0;
        const match = diceStr.toLowerCase().match(/^(\d+)d(\d+)(?:\+(\d+))?$/);
        if (!match) return 0;

        const count = parseInt(match[1] || '0', 10);
        const sides = parseInt(match[2] || '0', 10);
        const bonus = parseInt(match[3] || '0', 10);

        let total = 0;
        for (let i = 0; i < count; i++) {
            total += this.randRange(1, sides);
        }
        return total + bonus;
    }
}

// Export a robust singleton RNG that replicates Math.c's global RNG state
export const rng = new Random();
