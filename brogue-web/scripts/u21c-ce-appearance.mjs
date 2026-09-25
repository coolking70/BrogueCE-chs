/** Generate the R-1 terrain goldens from CE sources, never from web visuals.
 * Run: node scripts/u21c-ce-appearance.mjs
 * CE tile identities for web-only names are explicit below; all other names match.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const ce = readFileSync(resolve(root, 'BrogueCE-master/src/brogue/Globals.c'), 'utf8');
const base = readFileSync(resolve(root, 'BrogueCE-master/src/brogue/GlobalsBase.c'), 'utf8');
const glyphSource = readFileSync(resolve(root, 'BrogueCE-master/src/platform/platformdependent.c'), 'utf8');
const unicodeSource = readFileSync(resolve(root, 'BrogueCE-master/src/platform/platform.h'), 'utf8');
const gridSource = readFileSync(resolve(root, 'brogue-web/src/engine/Map/Grid.ts'), 'utf8');
const aliases = {
    WATER_SHALLOW: 'SHALLOW_WATER', WATER_DEEP: 'DEEP_WATER', BOG: 'MUD',
    STAIRS_UP: 'UP_STAIRS', STAIRS_DOWN: 'DOWN_STAIRS', CHARRED_FLOOR: 'ASH',
    SIGN: 'MACHINE_GLYPH', RESET_PLATE: 'MACHINE_PRESSURE_PLATE_USED',
    PRESSURE_PLATE: 'MACHINE_PRESSURE_PLATE',
    TRAP: 'GAS_TRAP_POISON', ALTAR: 'ALTAR_INERT', WEB: 'SPIDERWEB',
    BLOOD: 'RED_BLOOD', ANCIENT_SPIRIT_GRASS: 'GRASS',
};
const required = (condition, message) => { if (!condition) throw Error(message); };
const enumBody = gridSource.match(/export enum TerrainType\s*\{([\s\S]*?)\n\}/)?.[1];
required(enumBody, 'TerrainType enum absent');
const names = enumBody.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '').split(',').map(s => s.trim().replace(/\s*=.*$/, '')).filter(Boolean);
required(names.length === 137 && new Set(names).size === names.length, `Unexpected TerrainType set: ${names.length}`);

const colors = new Map();
for (const source of [ce, base]) {
    for (const m of source.matchAll(/const color\s+(\w+)\s*=\s*\{\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,/g)) {
        colors.set(m[1], [Number(m[2]), Number(m[3]), Number(m[4])]);
    }
}
const unicode = new Map([...unicodeSource.matchAll(/^#define\s+(U_\w+)\s+0x([\da-fA-F]+)/gm)].map(m => [m[1], String.fromCodePoint(parseInt(m[2], 16))]));
const glyphs = new Map();
for (const m of glyphSource.matchAll(/case\s+(G_\w+):\s*return\s+(U_\w+|'(?:\\.|[^'\\])*')\s*;/g)) {
    const value = m[2].trim();
    let glyph;
    try { glyph = value.startsWith('U_') ? unicode.get(value) : Function(`return ${value}`)(); }
    catch { throw Error(`Unparseable glyph ${m[1]}: ${value}`); }
    glyphs.set(m[1], glyph);
}
for (const m of glyphSource.matchAll(/((?:case\s+G_\w+:\s*){2,})return\s+(U_\w+|'(?:\\.|[^'\\])*')\s*;/g)) {
    const value = m[2].trim();
    const glyph = value.startsWith('U_') ? unicode.get(value) : Function(`return ${value}`)();
    for (const label of m[1].matchAll(/case\s+(G_\w+):/g)) glyphs.set(label[1], glyph);
}
const tiles = new Map();
const lines = ce.split('\n');
for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*\/\*([A-Z][A-Z0-9_]+),?\*\/\s*\{\s*([^,]+),\s*([^,]+),\s*([^,]+),/);
    if (m) tiles.set(m[1], { glyph: m[2].trim(), fore: m[3].trim(), back: m[4].trim(), line: i + 1 });
}
const dynamic = new Map();
for (const m of ce.matchAll(/\{\s*&([A-Za-z]+Start(?:Color)?)\s*,\s*&([A-Za-z]+End(?:Color)?)\s*\}/g)) {
    dynamic.set(m[1].replace(/Start(?:Color)?$/, ''), [m[1], m[2]]);
}
const color = symbol => {
    if (symbol === '0') return null;
    const name = symbol.replace(/^&/, '');
    const parts = colors.get(name) ?? colors.get(dynamic.get(name)?.[0]);
    required(parts, `Unknown CE color ${symbol}`);
    // CE's default depth is one (RogueMain.c); dynamic colors interpolate
    // start/end components with integer weight trunc(100 / AMULET_LEVEL=26).
    const pair = dynamic.get(name);
    const values = pair ? parts.map((v, i) => Math.trunc((v * 97 + colors.get(pair[1])[i] * 3) / 100)) : parts;
    return '#' + values.map(v => Math.trunc(Math.max(0, Math.min(100, v)) * 255 / 100).toString(16).padStart(2, '0')).join('');
};
const result = {};
for (const name of names) {
    const tileName = aliases[name] ?? name;
    const tile = tiles.get(tileName);
    required(tile, `No CE tile for ${name} -> ${tileName}`);
    const char = tile.glyph === '0' ? '' : tile.glyph.startsWith("'") ? tile.glyph.slice(1, -1) : glyphs.get(tile.glyph);
    required(char !== undefined, `Unknown glyph ${tile.glyph} for ${name}`);
    const foreground = color(tile.fore);
    const background = color(tile.back);
    result[name] = {
        ceTile: tileName, ceLine: tile.line, char,
        color: foreground ?? '#000000',
        bgColor: background === null ? null : parseInt(background.slice(1), 16),
    };
}
const output = resolve(root, 'brogue-web/src/test/fixtures/u21c-ce-terrain.json');
const generated = JSON.stringify(result, null, 2) + '\n';
if (process.argv.includes('--check')) {
    required(readFileSync(output, 'utf8') === generated, 'CE appearance goldens are stale; regenerate from CE sources');
    console.log(`Verified ${names.length} CE terrain expectations`);
} else {
    writeFileSync(output, generated, 'utf8');
    console.log(`Wrote ${names.length} CE terrain expectations to ${output}`);
}
