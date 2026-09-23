/** CE PowerTables.c:45-46. Integer division, and a STRICT 20% boundary.
 * Even 0% and 100% attempts call rand_percent at the effect site (Math.c:62).
 */
export function wandDominate(target: { hp: number; maxHp: number }): number {
    return target.hp * 5 < target.maxHp ? 100
        : Math.max(0, Math.trunc(100 * (target.maxHp - target.hp) / target.maxHp));
}
