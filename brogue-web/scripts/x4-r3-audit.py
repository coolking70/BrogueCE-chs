"""Read-only final/source-reader inventory; run from brogue-web."""
import hashlib
import json
from pathlib import Path
import re
import subprocess

out = Path('ai_docs/reports/x4-r3-evidence')
out.mkdir(parents=True, exist_ok=True)


def write(name, value):
    (out / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')


readers = []
for path in sorted(Path('src').rglob('*.test.ts')):
    text = path.read_text(encoding='utf-8')
    hits = [{'line': i, 'source': line.strip()} for i, line in enumerate(text.splitlines(), 1)
            if re.search(r'readFileSync|readFile\(|readdirSync|createSourceFile|parseSfc', line)]
    if hits:
        readers.append({'file': str(path).replace('\\', '/'), 'sourceReadSites': hits,
                        'mentionsR3': sorted(set(re.findall(r'CreatureFeatures|IncendiaryDart|AggravationScroll|Monster\.ts|ItemLoader\.ts|consumables\.json|monsters\.json|zh_CN\.json', text)))})
write('source-reader-inventory.json', readers)
consumers = []
for path in map(Path, ['src/engine/Core/Game.ts', 'src/entities/Monster.ts', 'src/engine/Combat/Combat.ts']):
    hits = [{'line': i, 'source': line.strip()} for i, line in enumerate(path.read_text(encoding='utf-8').splitlines(), 1)
            if re.search(r'spawnBlood\(|takeDamage\(|\.hp -=|absorbShieldDamage\(|DF_ROT_GAS_PUFF|aggravateMonsters\(|resolveThrownWeapon\(', line)]
    consumers.append({'file': str(path).replace('\\', '/'), 'sites': hits})
write('r6-consumer-inventory.json', consumers)
initial = out / 'initial-state.json'
if initial.exists():
    state = json.loads(initial.read_text())
    game_hash = hashlib.sha256(Path('src/engine/Core/Game.ts').read_bytes()).hexdigest()
    status = subprocess.check_output(['git', 'status', '--porcelain', '-z'], text=True).split('\0')
    paths = [row[3:] for row in status if row and not row.endswith('/')]
    workspace = Path.cwd().parent
    changed = [workspace / path for path in paths if (workspace / path).is_file()]
    # Include new text modules/scripts/report even before git lists directory leaves.
    changed.extend(p for root in [Path('src'), Path('scripts'), out] for p in root.rglob('*')
                   if p.is_file() and ('x4-r3' in str(p) or 'x4_r3' in str(p)
                                      or p.name in ['CreatureFeatures.ts', 'IncendiaryDart.ts', 'AggravationScroll.ts']))
    text_paths = [p for p in set(changed) if p.suffix in ['.ts', '.json', '.md', '.mjs', '.py', '.log', '.patch']]
    check = subprocess.run(['git', 'diff', '--check'], capture_output=True, text=True)
    write('final-audit.json', {
        'head': subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip(),
        'originalHead': state['head'], 'gameSHA256': game_hash, 'gameUnchanged': game_hash == state['game'],
        'staged': subprocess.check_output(['git', 'diff', '--cached', '--name-only'], text=True).splitlines(),
        'diffCheckExit': check.returncode, 'diffCheckOutput': check.stdout + check.stderr,
        'crlfFiles': [str(p) for p in text_paths if b'\r\n' in p.read_bytes()],
        'largeEvidence': [str(p) for p in out.rglob('*') if p.is_file() and p.stat().st_size > 1000000],
        'newPNGs': [str(p) for p in set(changed) if p.suffix.lower() == '.png'],
        'ceInputUnchanged': all(hashlib.sha256(Path(p).read_bytes()).hexdigest() == digest
                                for p, digest in json.loads((out / 'ce-source-hashes.json').read_text(encoding='utf-8')).items()),
        'productionSHA256': {p: hashlib.sha256(Path(p).read_bytes()).hexdigest() for p in state['production'] + state['added']},
        'fixturesSHA256': {p: hashlib.sha256(Path(p).read_bytes()).hexdigest() for p in state['fixtures']},
        'sourceReadingTestFiles': len(readers),
    })
print(f'Inventoried {len(readers)} source-reading test files; audit written to {out}')
