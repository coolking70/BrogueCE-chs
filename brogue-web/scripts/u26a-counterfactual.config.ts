import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { defineConfig } from 'vitest/config';
const variant = process.env.U26A_VARIANT ?? '';
export default defineConfig({ plugins: [{ name: 'u26a-counterfactual', enforce: 'pre', load(id) {
    if (!/\/src\/.*\.(ts|json)$/.test(id)) return;
    const file = path.relative(process.cwd(), id);
    if (variant === 'head') {
        try { return execFileSync('git', ['show', `HEAD:brogue-web/${file}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); }
        catch { return; }
    }
    let s = fs.readFileSync(id, 'utf8');
    const replace = (a: string, b: string) => { if (!s.includes(a)) throw Error(`Missing ${variant}`); s = s.replace(a, b); };
    if (file.endsWith('/LoopMap.ts') && variant === 'doors26') replace('export const DEEPEST_LEVEL = 40;', 'export const DEEPEST_LEVEL = 26;');
    if (file.endsWith('/Architect.ts') && variant === 'profile40') replace('const AMULET_LEVEL = 26;', 'const AMULET_LEVEL = 40;');
    if (file.endsWith('/ItemLoader.ts')) {
        if (variant === 'quota') replace('[3, 3, 3, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1] as const', '[2, 3, 3, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1] as const');
        if (variant === 'origin') replace('gem.originDepth = depth;', 'gem.originDepth = 26;');
        if (variant === 'gem-rng') replace('gem.originDepth = depth;', 'gem.originDepth = depth; rng.randRange(1, 100);');
    }
    if (file.endsWith('/Game.ts')) {
        if (variant === 'ordinary') replace('if (depth > AMULET_LEVEL) return ItemLoader.spawnGem(depth, pos.x, pos.y);', '');
        if (variant === 'drop-single') replace(' && item.category !== ItemCategory.GEM;', ';');
        if (variant === 'water-single') replace(' && chosen.category !== ItemCategory.GEM)', ')');
        if (variant === 'portal') replace('if (hasAmulet) this.triggerGameOver(true, undefined, true);', 'if (hasAmulet) this.triggerGameOver(true);');
    }
    if (file.endsWith('/Inventory.ts')) {
        if (variant === 'merge-depths') replace('return a.originDepth === b.originDepth;', 'return true;');
        if (variant === 'gem-slots') replace(' || item.category === ItemCategory.GEM', '');
    }
    if (file.endsWith('/GenerationCoordinator.ts')) {
        if (variant === 'food-quota') replace('if (deep && isFood) numItems++;', '');
        if (variant === 'metered') replace('if (!deep) ItemLoader.incrementMeteredItems', 'ItemLoader.incrementMeteredItems');
    }
    return s;
} }], test: { testTimeout: 900000, hookTimeout: 120000 } });
