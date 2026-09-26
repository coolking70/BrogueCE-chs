"""Compile CE's unmodified charm tables/formulas, independently of TypeScript."""
from pathlib import Path
import hashlib
import json
import re
import subprocess
import tempfile

ce = Path('../BrogueCE-master/src')
out = Path('ai_docs/reports/x2e-evidence')


def function(file, signature):
    source = (ce / file).read_text()
    start = source.index(signature)
    end = source.index('{', start) + 1
    depth = 1
    while depth:
        depth += (source[end] == '{') - (source[end] == '}')
        end += 1
    return source[start:end]


base = (ce / 'brogue/GlobalsBase.c').read_text()
variant = (ce / 'variants/GlobalsBrogue.c').read_text()
header = (ce / 'brogue/Rogue.h').read_text()
names = ['HEALTH', 'PROTECTION', 'HASTE', 'FIRE_IMMUNITY', 'INVISIBILITY', 'TELEPATHY',
         'LEVITATION', 'SHATTERING', 'GUARDIAN', 'TELEPORTATION', 'RECHARGING', 'NEGATION']
ids = ['charm_of_' + ('speed' if n == 'HASTE' else n.lower()) for n in names]
pre = r'''
#include <stdio.h>
#include <stdint.h>
#define FP_FACTOR 65536LL
#define FP_DIV(a,b) ((a)*FP_FACTOR/(b))
#define max(a,b) ((a)>(b)?(a):(b))
#define min(a,b) ((a)<(b)?(a):(b))
#define clamp(x,a,b) min(max(x,a),b)
#define LAST_INDEX(a) (sizeof(a)/sizeof((a)[0])-1)
#define CHARM_EFFECT_DURATION_INCREMENT_ARRAY_SIZE 50
typedef int64_t fixpt;
'''
parts = [pre, 'enum {' + ','.join('CHARM_' + n for n in names) + '};']
parts += [re.search(r'typedef struct charmEffectTableEntry \{.*?\} charmEffectTableEntry;', header, re.S)[0]]
parts += [re.search(r'const fixpt POW_' + n + r'_CHARM_INCREMENT\[\] = \{.*?\};', base, re.S)[0]
          for n in ['0', '120', '125']]
parts += [re.search(r'const charmEffectTableEntry charmEffectTable_Brogue\[\] = \{.*?\};', variant, re.S)[0],
          'const charmEffectTableEntry *charmEffectTable = charmEffectTable_Brogue;']
for file, sig in [('Math.c', 'fixpt fp_round('), ('Math.c', 'fixpt fp_pow('),
                  ('PowerTables.c', 'short charmHealing('), ('PowerTables.c', 'short charmShattering('),
                  ('PowerTables.c', 'short charmGuardianLifespan('), ('PowerTables.c', 'short charmNegationRadius('),
                  ('PowerTables.c', 'int charmProtection('), ('PowerTables.c', 'short charmEffectDuration('),
                  ('PowerTables.c', 'short charmRechargeDelay(')]:
    parts.append(function('brogue/' + file, sig))
parts.append(r'''
int main(void) {
  puts("["); int sep=0;
  for (int k=0; k<12; k++) for (int e=0; e<=51; e++) {
    int magnitude = k==CHARM_HEALTH ? charmHealing(e*FP_FACTOR)
      : k==CHARM_PROTECTION ? charmProtection(e*FP_FACTOR)
      : k==CHARM_SHATTERING ? charmShattering(e*FP_FACTOR)
      : k==CHARM_GUARDIAN ? charmGuardianLifespan(e*FP_FACTOR)
      : k==CHARM_NEGATION ? charmNegationRadius(e*FP_FACTOR) : 0;
    printf("%s{\"kind\":%d,\"enchant\":%d,\"duration\":%d,\"recharge\":%d,\"magnitude\":%d}",
      sep++?",\n":"",k,e,charmEffectDuration(k,e),charmRechargeDelay(k,e),magnitude);
  }
  puts("\n]");
}
''')
source = '\n'.join(parts) + '\n'
(out / 'ce-oracle.c').write_text(source)
with tempfile.TemporaryDirectory(prefix='x2e-oracle-') as tmp:
    exe = str(Path(tmp) / 'oracle')
    subprocess.run(['cc', '-std=c99', '-O0', str(out / 'ce-oracle.c'), '-o', exe], check=True)
    rows = json.loads(subprocess.check_output([exe]))
for row in rows:
    row['id'] = ids[row.pop('kind')]
result = {'sources': {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in
          [ce / f for f in ['brogue/Rogue.h', 'brogue/GlobalsBase.c', 'brogue/Math.c',
                           'brogue/PowerTables.c', 'variants/GlobalsBrogue.c']]}, 'cases': rows}
(out / 'ce-oracle.json').write_text(json.dumps(result, indent=2) + '\n')
print(f'Compiled original CE: {len(rows)} cases (12 kinds × E0–51).')
