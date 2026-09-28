"""Extract X4-R3 fields directly from the checked-in CE C source (read-only).
Run from brogue-web; --write-data installs only the three species fields.
"""
import hashlib
import json
from pathlib import Path
import re
import sys

ce = Path('../BrogueCE-master/src')
out = Path('ai_docs/reports/x4-r3-evidence')
out.mkdir(parents=True, exist_ok=True)
header = (ce / 'brogue/Rogue.h').read_text(encoding='utf-8')
globals_c = (ce / 'brogue/Globals.c').read_text(encoding='utf-8')


def enumeration(name):
    body = re.search(r'enum ' + name + r'\s*\{(.*?)\}', header, re.S)[1]
    body = re.sub(r'//[^\n]*|/\*.*?\*/', '', body, flags=re.S)
    result, value = {}, -1
    for token in body.split(','):
        if not token.strip():
            continue
        parts = token.strip().split('=')
        value = int(parts[1].strip()) if len(parts) > 1 else value + 1
        result[parts[0].strip()] = value
    return result


def write(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')


df = enumeration('dungeonFeatureTypes')
body = globals_c.split('creatureType monsterCatalog[NUMBER_MONSTER_KINDS] = {', 1)[1].split('\n};', 1)[0]
rows = []
for line in body.splitlines():
    if not re.match(r'\s*\{0,\s*"', line):
        continue
    flat = re.sub(r'\{[^{}]*\}', 'DAMAGE', line, count=1)
    fields = [field.strip() for field in flat.split(',')]
    blood, chance, feature = fields[11], fields[14], fields[15]
    assert blood == '0' or blood in df, blood
    assert feature == '0' or feature in df, feature
    rows.append(dict(name=fields[1].strip('"'), bloodType=df.get(blood, 0), DFChance=int(chance),
                     DFType=df.get(feature, 0), ceBlood=blood, ceDF=feature))
assert len(rows) == 68
web_path = Path('src/data/monsters.json')
web = json.loads(web_path.read_text(encoding='utf-8'))
assert len(web) == 67
for actual, expected in zip(web, rows[1:]):
    assert actual['name'].lower() == expected['name'].lower(), (actual['id'], expected)
    expected['webId'] = actual['id']
    if '--write-data' in sys.argv:
        actual.update({key: expected[key] for key in ['bloodType', 'DFChance', 'DFType']})
    else:
        assert all(actual.get(key) == expected[key] for key in ['bloodType', 'DFChance', 'DFType']), actual['id']
if '--write-data' in sys.argv:
    web_path.write_text(json.dumps(web, ensure_ascii=False, indent=4) + '\n', encoding='utf-8', newline='\n')

loader = Path('src/engine/Items/ItemLoader.ts').read_text(encoding='utf-8')
names = re.findall(r"category: '(SCROLL|POTION)', ceKind: '([^']+)'", loader)
enums = {'SCROLL': enumeration('scrollKind'), 'POTION': enumeration('potionKind')}
kind_audit = [{'category': cat, 'ceKind': name, 'valid': name in enums[cat], 'index': enums[cat].get(name)} for cat, name in names]
write(out / 'ce-species-fields.json', rows)
write(out / 'ce-kind-audit.json', kind_audit)
write(out / 'ce-source-hashes.json', {str(p): hashlib.sha256(p.read_bytes()).hexdigest()
      for p in [ce / 'brogue/Rogue.h', ce / 'brogue/Globals.c', ce / 'brogue/Items.c',
                ce / 'brogue/Combat.c', ce / 'brogue/Time.c', ce / 'brogue/Monsters.c', ce / 'variants/GlobalsBrogue.c']})
assert len(kind_audit) == 30 and all(row['valid'] for row in kind_audit)
print('CE audit: 68 species, 30 real item enums; all matched')
