import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { defineConfig } from 'vitest/config';
const out = 'ai_docs/reports/x2e-evidence';
const stage = process.env.X2E_FLAVOR_STAGE ?? 'pool';
const sources = JSON.parse(gunzipSync(fs.readFileSync(`${out}/sources-${stage}.json.gz`)).toString());
export default defineConfig({
    plugins: [{ name: 'x2e-flavor-premise-proof', enforce: 'pre', load(id) {
        const file = path.relative(process.cwd(), id);
        if (process.env.X2E_FLAVOR_ORIGINAL === '1' && file === 'src/engine/Items/itemFlavors.test.ts')
            return fs.readFileSync(`${out}/itemFlavors-original.test.ts.txt`, 'utf8');
        // Source snapshots also retain colocated tests; use the current guard
        // unless this run explicitly requests its original premise.
        if (file.endsWith('.test.ts')) return;
        if (!(file in sources)) return;
        let source = sources[file];
        if (process.env.X2E_FLAVOR_BAD_BIRTH === '1' && file === 'src/engine/Items/ItemLoader.ts') {
            if (!source.includes('charm.identified = true;')) throw Error('Missing birth mutation');
            source = source.replace('charm.identified = true;', 'charm.identified = false;');
        }
        return source;
    } }],
    test: { testTimeout: 900000, hookTimeout: 120000 },
});
