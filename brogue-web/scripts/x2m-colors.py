"""Extract all eight CE color fields and terrain color references. No RGB approximation."""
from pathlib import Path
import json
import re

root = Path(__file__).resolve().parents[1]
ce = root.parent / 'BrogueCE-master/src/brogue'
sources = [(ce / name).read_text(encoding='utf-8') for name in ['Globals.c', 'GlobalsBase.c']]
colors = {}
for source in sources:
    for name, body in re.findall(r'const color\s+(\w+)\s*=\s*\{([^}]+)\}', source):
        values = body.replace('false', '0').replace('true', '1').split(',')
        if len(values) == 8:
            colors[name] = [int(v.strip()) for v in values]
dynamic = {}
for start, end in re.findall(r'\{\s*&([A-Za-z]+Start(?:Color)?)\s*,\s*&([A-Za-z]+End(?:Color)?)\s*\}', sources[0]):
    dynamic[re.sub(r'Start(?:Color)?$', '', start)] = [start, end]
aliases = dict(WATER_SHALLOW='SHALLOW_WATER', WATER_DEEP='DEEP_WATER', BOG='MUD', STAIRS_UP='UP_STAIRS',
               STAIRS_DOWN='DOWN_STAIRS', CHARRED_FLOOR='ASH', SIGN='MACHINE_GLYPH', RESET_PLATE='MACHINE_PRESSURE_PLATE_USED',
               PRESSURE_PLATE='MACHINE_PRESSURE_PLATE', TRAP='GAS_TRAP_POISON', ALTAR='ALTAR_INERT', WEB='SPIDERWEB',
               BLOOD='RED_BLOOD', ANCIENT_SPIRIT_GRASS='GRASS')
tiles = {}
for name, fore, back in re.findall(r'^\s*/\*([A-Z][A-Z0-9_]+),?\*/\s*\{\s*[^,]+,\s*([^,]+),\s*([^,]+),', sources[0], re.M):
    tiles[name] = [None if c.strip() == '0' else c.strip().removeprefix('&') for c in [fore, back]]
grid = (root / 'src/engine/Map/TerrainType.ts').read_text(encoding='utf-8')
body = re.search(r'export enum TerrainType\s*\{([\s\S]*?)\n\}', grid)[1]
body = re.sub(r'/\*[\s\S]*?\*/|//[^\n]*', '', body)
names = [re.sub(r'\s*=.*', '', s.strip()) for s in body.split(',') if s.strip()]
assert all(aliases.get(n, n) in tiles for n in names)
for refs in tiles.values():
    assert all(c is None or c in colors or c in dynamic for c in refs), refs
out = ['/** Generated from CE Globals.c/GlobalsBase.c by scripts/x2m-colors.py. */',
       "import { TerrainType } from '../Map/Grid';",
       'export type TerrainColor = readonly [number, number, number, number, number, number, number, number];',
       'export const CE_COLORS: Readonly<Record<string, TerrainColor>> = {\n' + '\n'.join(f'    {name}: {json.dumps(value)},' for name, value in colors.items()) + '\n};',
       'export const CE_DEPTH_COLORS: Readonly<Record<string, readonly [string, string]>> = ' + json.dumps(dynamic, indent=2) + ';',
       'export const TERRAIN_COLOR_NAMES: Record<TerrainType, readonly [string | null, string | null]> = {']
out += [f'    [TerrainType.{name}]: {json.dumps(tiles[aliases.get(name, name)])},' for name in names]
out += ['};', '']
(root / 'src/engine/UI/TerrainColorCatalog.ts').write_text('\n'.join(out), encoding='utf-8', newline='\n')
print(f'Extracted {len(colors)} colors / {len(names)} tiles / {len(dynamic)} depth colors')
