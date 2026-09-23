/** CE PowerTables.c:57-59 and Math.c:272-287. Fixed-point fp_pow keeps
 * the multiplication remainder and rounds once; Math.pow(1.4, E-2) differs
 * even at E=3 (181, not 182). Result is tenths of an HP, not turns. */
export function staffProtection(enchantment: number): number {
    const fp = 65536n;
    let base = fp * 140n / 100n;
    let exponent = Math.trunc(enchantment) - 2;
    if (exponent < 0) {
        base = fp * fp / base;
        exponent = -exponent;
    }
    let result = fp, remainder = 0n;
    while (exponent-- > 0) {
        result = result * base + remainder * base / fp;
        remainder = result % fp;
        result /= fp;
    }
    result += remainder >= fp / 2n ? 1n : 0n;
    return Number(130n * result / fp);
}
