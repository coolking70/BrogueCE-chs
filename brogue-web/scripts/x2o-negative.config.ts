import fs from 'node:fs';
import { defineConfig } from 'vitest/config';
const variant = process.env.X2O_VARIANT;
const variants = ['ordinary-uniform', 'summon-uniform', 'lost-clump', 'wrong-depth', 'wrong-remainder'];
if (!variant || !variants.includes(variant)) throw Error('Unknown X2o negative');
export default defineConfig({ plugins: [{ name: 'x2o-isolated-negative', enforce: 'pre', load(id) {
    if (id.endsWith('/Game.ts') && variant.endsWith('uniform')) {
        const source = fs.readFileSync(id, 'utf8');
        const target = 'rng.randClumpedRange(member.minCount, member.maxCount, member.clumpFactor)';
        let seen = 0;
        const altered = source.replaceAll(target, m => ++seen === (variant === 'ordinary-uniform' ? 1 : 2) ? 'rng.randRange(member.minCount, member.maxCount)' : m);
        if (seen !== 2) throw Error('Expected two consumers'); return altered;
    }
    if (id.endsWith('/hordes.json') && variant === 'lost-clump') {
        const rows = JSON.parse(fs.readFileSync(id,'utf8'));
        for (const h of rows) for (const m of h.members) m.clumpFactor = 1;
        return JSON.stringify(rows);
    }
    if (id.endsWith('/blueprints.json') && variant === 'wrong-depth') {
        const rows = JSON.parse(fs.readFileSync(id,'utf8'));
        rows.find((b: any) => b.ceBlueprintId === 65).depthRange[1] = 40;
        return JSON.stringify(rows);
    }
    if (id.endsWith('/Random.ts') && variant === 'wrong-remainder') {
        const source = fs.readFileSync(id,'utf8');
        const changed = source.replace('this.randRange(0, numSides + 1)', 'this.randRange(0, numSides)');
        if (changed === source) throw Error('Missing clump remainder'); return changed;
    }
} }], test: { testTimeout: 900000, hookTimeout: 120000 } });
