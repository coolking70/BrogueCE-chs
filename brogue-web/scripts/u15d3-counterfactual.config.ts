import fs from 'node:fs';
import { defineConfig } from 'vitest/config';
const variant = process.env.U15D3_VARIANT;
export default defineConfig({ plugins: [{ name: 'u15d3-isolated-mutation', enforce: 'pre', load(id) {
    if (!id.endsWith('/src/engine/Items/ItemLoader.ts')) return;
    let s = fs.readFileSync(id, 'utf8');
    const replace = (before: string, after: string) => {
        if (!s.includes(before)) throw Error(`Missing mutation ${variant}`);
        s = s.replace(before, after);
    };
    for (const [tag, value] of [
        ['W_MULTIPLICITY', 'multiplicity'], ['W_SLOWING', 'slowing'], ['W_PLENTY', 'plenty'],
        ['A_MULTIPLICITY', 'multiplicity'], ['A_BURDEN', 'burden'],
        ['A_VULNERABILITY', 'vulnerability'], ['A_IMMOLATION', 'immolation'],
    ]) if (variant === tag) {
        const line = s.split('\n').find(l => l.includes(`// ${tag}`))!;
        replace(line, line.replace(`'${value}'`, 'null'));
    }
    if (variant === 'weapon-pool') replace('this.CE_NUMBER_GOOD_WEAPON_ENCHANT_KINDS - 1', 'this.CE_NUMBER_GOOD_WEAPON_ENCHANT_KINDS - 2');
    if (variant === 'armor-pool') replace('this.CE_NUMBER_ARMOR_ENCHANT_KINDS - 1', 'this.CE_NUMBER_ARMOR_ENCHANT_KINDS - 2');
    if (variant === 'weapon-threshold') replace('if (v > this.damageLowerBound', 'if (v >= this.damageLowerBound');
    if (variant === 'armor-threshold') replace('rng.randRange(0, 95) > (armor.armor', 'rng.randRange(0, 95) >= (armor.armor');
    if (variant === 'throwing-strip') replace('weapon.runicType = undefined;', '// omitted throwing strip');
    if (variant === 'curse-sign') replace('weapon.enchantment *= -1;', 'weapon.enchantment *= 1;');
    if (variant === 'no-runic-bit') s = s.replaceAll("weapon.flags = [...(weapon.flags ?? []), 'ITEM_RUNIC'];", '');
    if (variant === 'vorpal-depth') replace('depth <= c.maxDepth', 'depth < c.maxDepth');
    if (variant === 'vorpal-extra-draw') replace('let maxFreq = 0;', 'rng.randRange(0, 99); let maxFreq = 0;');
    if (variant === 'vorpal-frequency') replace("{ name: 'turret',      frequency: 5,", "{ name: 'turret',      frequency: 10,");
    return s;
} }], test: { testTimeout: 120_000 } });
