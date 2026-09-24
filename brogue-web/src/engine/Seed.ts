/** JSON/UI representation of an unsigned 64-bit seed. Never pass it through Number. */
export type SeedInput = string | bigint | number;
export const MAX_SEED = 18446744073709551615n;

export function normalizeSeed(seed: SeedInput): string {
    if (typeof seed === 'number' && (!Number.isSafeInteger(seed) || seed < 0)) {
        throw new RangeError('Numeric seeds must be nonnegative safe integers; use a decimal string for uint64.');
    }
    if (typeof seed === 'string' && !/^\d+$/.test(seed.trim())) {
        throw new RangeError('Seed must be an unsigned decimal integer.');
    }
    const value = BigInt(typeof seed === 'string' ? seed.trim() : seed);
    if (value < 0n || value > MAX_SEED) throw new RangeError('Seed is outside uint64.');
    return value.toString();
}

export function isSeed(seed: unknown): seed is string {
    if (typeof seed !== 'string') return false;
    try { return normalizeSeed(seed) === seed; } catch { return false; }
}
