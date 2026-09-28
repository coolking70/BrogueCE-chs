"""One-time R1 additions derived from the checked-in CE source (LF output)."""
from pathlib import Path
import importlib.util
import json
import re
import sys

sys.dont_write_bytecode = True

spec = importlib.util.spec_from_file_location('ce', Path(__file__).with_name('x4-r1-ce-catalog.py'))
ce = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ce)
data = ce.read_catalog()
root = ce.ROOT / 'brogue-web'
names = 'BLOODFLOWER_POD HEALING_CLOUD HAY URINE JUNK BURNED_CARPET GREEN_BLOOD PURPLE_BLOOD ACID_SPLATTER WORM_BLOOD UNICORN_POOP GUARDIAN_GLOW FLAMEDANCER_FIRE DART_EXPLOSION CREATURE_FIRE'.split()
dfs = 'DF_RED_BLOOD DF_GREEN_BLOOD DF_PURPLE_BLOOD DF_WORM_BLOOD DF_ACID_BLOOD DF_ASH_BLOOD DF_EMBER_BLOOD DF_ECTOPLASM_BLOOD DF_RUBBLE_BLOOD DF_FLAMEDANCER_CORONA DF_SALAMANDER_FLAME DF_UNICORN_POOP DF_SILENT_GLYPH_GLOW DF_GUARDIAN_STEP DF_MIRROR_TOTEM_STEP DF_BLOODFLOWER_POD_BURST DF_DART_EXPLOSION DF_STENCH_BURN DF_CREATURE_FIRE'.split()


def read(path): return (root / path).read_text(encoding='utf-8')
def write(path, text): (root / path).write_text(text, encoding='utf-8', newline='\n')
def inject(path, marker, rows):
    text = read(path)
    assert marker in text
    write(path, text.replace(marker, marker + '\n    // X4-R1: CE world catalog additions.\n' + '\n'.join(rows) + '\n', 1))


text = read('src/engine/Map/TerrainType.ts')
assert '    BLOODFLOWER_POD,' not in text
write('src/engine/Map/TerrainType.ts', text.replace('\n}', '\n    // X4-R1: append only; saved terrain identities remain stable.\n    ' + ', '.join(names) + ',\n}'))
tiles = {n: data['arrays']['tileCatalog'][data['enums']['tileType'][n]] for n in names}
def zero_string(value): return "''" if value == '0' else repr(value)
rows = []
for n, row in tiles.items():
    f = row['fields']
    rows.append(f"    [TerrainType.{n}]: e({f[10]}, {f[11]}, {f[4]}, {zero_string(f[5])}, {zero_string(f[6])}, {zero_string(f[7])}, {f[8]}, false, LightKind.{f[9]}), // CE :{row['line']}")
inject('src/engine/Map/TerrainCatalog.ts', 'export const TERRAIN_FLAGS: Record<TerrainType, TerrainFlagsEntry> = {', rows)
text = read('src/engine/Map/TerrainCatalog.ts').replace("100, 'DF_PLAIN_FIRE', '', 'DF_BLOODFLOWER_PODS_GROW', 0", "20, 'DF_PLAIN_FIRE', '', 'DF_BLOODFLOWER_PODS_GROW', 100")
text = text.replace('export const T_CAUSES_HEALING              = Fl(18); // :1942 每回合回 20%', 'export const T_CAUSES_HEALING              = Fl(18); // :1942; Time.c:645-657 uses (maxHP / 15) * ticks / 100, minimum 1')
write('src/engine/Map/TerrainCatalog.ts', text)
inject('src/engine/Map/Grid.ts', 'export const DRAW_PRIORITY: Record<TerrainType, number> = {', [f"    [TerrainType.{n}]: {r['fields'][3]}," for n,r in tiles.items()])
text = read('src/engine/Map/Grid.ts')
marker = re.search(r'export const TERRAIN_HOME_LAYER[^\n]*= \{',text)[0]
inject('src/engine/Map/Grid.ts', marker, [f"    [TerrainType.{n}]: DungeonLayer.{'GAS' if n == 'HEALING_CLOUD' else 'SURFACE'}," for n in names])
text = read('src/engine/Map/Grid.ts')
text = text.replace('[TerrainType.BLOODFLOWER_STALK]: 20,', '[TerrainType.BLOODFLOWER_STALK]: 10, // CE Globals.c:513; POD(11) must not overwrite its stalk.')
text = text.replace('    TerrainType.PILOT_LIGHT, // CE Globals.c:343; fire can occupy the DUNGEON layer.',
                    '    TerrainType.PILOT_LIGHT, // CE Globals.c:343; fire can occupy the DUNGEON layer.\n' + '\n'.join(f'    TerrainType.{n},' for n in ['FLAMEDANCER_FIRE','DART_EXPLOSION','CREATURE_FIRE']))
text = re.sub(r' \* CE 其余火地形（[\s\S]*?\n \*/', ' * X4-R1：FLAMEDANCER_FIRE / DART_EXPLOSION / CREATURE_FIRE\n * （Globals.c:494/497/499）。集合顺序与追加后的 TerrainType 一致。\n */', text, count=1)
write('src/engine/Map/Grid.ts', text)
inject('src/engine/Map/DungeonFeatureCatalog.ts', 'export enum DF {', [f"    {n} = {data['enums']['dungeonFeatureTypes'][n]}," for n in dfs])
rows = []
for n in dfs:
    i = data['enums']['dungeonFeatureTypes'][n]
    row = data['arrays']['dungeonFeatureCatalog'][i]
    f = row['fields'] + ['0'] * (11 - len(row['fields']))
    tile = 'BLOOD' if f[0] == 'RED_BLOOD' else f[0]
    subsequent = 'null' if f[10] == '0' else f'DF.{f[10]}'
    description = "''" if f[5] == '0' else f[5]
    value = f"df(DF.{n}, {row['line']}, '{f[0]}', TerrainType.{tile}, DungeonLayer.{f[1]}, {f[2]}, {f[3]}, {f[4]}, '', null, {subsequent}, {description})"
    if f[6] != '0': value = "{ ..." + value + f", lightFlare: '{f[6]}'" + " }"
    rows.append(f'    [DF.{n}]: {value},')
inject('src/engine/Map/DungeonFeatureCatalog.ts', 'export const DUNGEON_FEATURE_CATALOG: Readonly<Partial<Record<DF, DungeonFeatureEntry>>> = {', rows)
text = read('src/engine/Map/DungeonFeatureCatalog.ts')
for n, old, new in [('URINE','BLOOD','URINE'),('BLOODFLOWER_POD','BLOODFLOWER_STALK','BLOODFLOWER_POD'),('HAY','GRASS','HAY'),('JUNK','BONES','JUNK'),('BURNED_CARPET','ASH','BURNED_CARPET')]:
    text = text.replace(f"ceTile: '{n}', tile: TerrainType.{old},", f"ceTile: '{n}', tile: TerrainType.{new},")
write('src/engine/Map/DungeonFeatureCatalog.ts', text)

# Base glyph/RGB and all eight color channels come from CE, not another web tile.
ce_root = ce.ROOT / 'BrogueCE-master/src'
colors = {}
for file in ['brogue/Globals.c','brogue/GlobalsBase.c']:
    for n, body in re.findall(r'const color\s+(\w+)\s*=\s*\{([^}]+)\}', (ce_root/file).read_text(encoding='utf-8')):
        parts = body.replace('true','1').replace('false','0').split(',')
        if len(parts) == 8: colors[n] = [int(p.strip()) for p in parts]
unicode = {n:chr(int(h,16)) for n,h in re.findall(r'^#define\s+(U_\w+)\s+0x([\da-fA-F]+)', (ce_root/'platform/platform.h').read_text(encoding='utf-8'),re.M)}
glyphs = {}
for labels, value in re.findall(r'((?:case\s+G_\w+:\s*)+)return\s+(U_\w+|\'(?:\\.|[^\'\\])*\')\s*;', (ce_root/'platform/platformdependent.c').read_text(encoding='utf-8')):
    for n in re.findall(r'case\s+(G_\w+):',labels): glyphs[n] = unicode[value] if value.startswith('U_') else value[1:-1]
rows, color_rows, golden = [], [], {}
for n,row in tiles.items():
    f = row['fields']
    char = '' if f[0] == '0' else f[0][1:-1] if f[0].startswith("'") else glyphs[f[0]]
    refs = [None if v == '0' else v.removeprefix('&') for v in f[1:3]]
    def rgb(ref): return None if ref is None else '#' + ''.join(f'{int(max(0,min(100,v))*255/100):02x}' for v in colors[ref][:3])
    fg,bg = map(rgb,refs)
    appearance = dict(char=char,color=fg or '#000000',bgColor=None if bg is None else int(bg[1:],16))
    if fg is None: appearance['transparentFore'] = True
    golden[n] = dict(ceLine=row['line'], appearance=appearance, colors=refs, fields=f)
    rows.append(f'    [TerrainType.{n}]: {json.dumps(appearance,ensure_ascii=False)}, // CE :{row["line"]}')
    color_rows.append(f'    [TerrainType.{n}]: {json.dumps(refs)},')
inject('src/engine/UI/TerrainAppearanceCatalog.ts', 'export const TERRAIN_APPEARANCES: Record<TerrainType, BaseTerrainAppearance> = {', rows)
inject('src/engine/UI/TerrainColorCatalog.ts', 'export const TERRAIN_COLOR_NAMES: Record<TerrainType, readonly [string | null, string | null]> = {', color_rows)
out = root/'ai_docs/reports/x4-r1-evidence'
out.mkdir(exist_ok=True)
(out/'ce-additions.json').write_text(json.dumps({'tiles':golden,'dfs':{n:data['arrays']['dungeonFeatureCatalog'][data['enums']['dungeonFeatureTypes'][n]] for n in dfs}},ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
print(f'Added {len(names)} terrain and {len(dfs)} DF identities; fixed six substitute mappings.')
