/** Merge hygiene: a 3-way apply once committed conflict markers into a locale
 * archive that nothing parsed. Every JSON under src must parse, and no source
 * file may carry conflict markers. */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('..', import.meta.url));
function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p, out);
        else if (/\.(ts|vue|json)$/.test(name)) out.push(p);
    }
    return out;
}
const MARKER = /^(<{7}|>{7}) (ours|theirs|HEAD|[0-9a-f]{7,})|^={7}$/m;

describe('repo hygiene', () => {
    const files = walk(SRC);
    it('has no merge conflict markers in src', () => {
        expect(files.filter(f => MARKER.test(readFileSync(f, 'utf8')))).toEqual([]);
    });
    it('every JSON file under src parses', () => {
        const bad = files.filter(f => f.endsWith('.json')).filter(f => {
            try { JSON.parse(readFileSync(f, 'utf8')); return false; } catch { return true; }
        });
        expect(bad).toEqual([]);
    });
});
