"""Compile unmodified CE iterator functions against a minimal list harness."""
from pathlib import Path
import hashlib, json, subprocess, tempfile
root = Path(__file__).resolve().parents[1]
out = root / 'ai_docs/reports/x3a-evidence'
source = (root.parent / 'BrogueCE-master/src/brogue/Monsters.c').read_text()
body = source[source.index('creatureIterator iterateCreatures('):source.index('void prependCreature(')]
preamble = '''#include <stdio.h>
#define MB_HAS_DIED 1
typedef int boolean;
typedef struct { int id; int bookkeepingFlags; } creature;
typedef struct creatureListNode { creature *creature; struct creatureListNode *nextCreature; } creatureListNode;
typedef struct { creatureListNode *head; } creatureList;
typedef struct { creatureList *list; creatureListNode *next; } creatureIterator;
'''
main = '''int main(void) {
 puts("[");
 for (int mask = 0; mask < 256; mask++) {
  creature c[8]; creatureListNode n[8];
  for (int i = 0; i < 8; i++) { c[i] = (creature){i, (mask >> i) & 1}; n[i] = (creatureListNode){&c[i], i < 7 ? &n[i+1] : NULL}; }
  creatureList list = { n }; creatureIterator it = iterateCreatures(&list);
  printf("{\\"mask\\":%d,\\"ids\\":[", mask); int count = 0;
  while (hasNextCreature(it)) { creature *c = nextCreature(&it); printf("%s%d", count++ ? "," : "", c->id); }
  printf("]}%s\\n", mask < 255 ? "," : "");
 }
 puts("]");
}
'''
out.mkdir(parents=True, exist_ok=True)
code = preamble + body + main
(out / 'ce-iterator.c').write_text(code)
with tempfile.TemporaryDirectory(prefix='x3a-ce-') as tmp:
 binary = Path(tmp) / 'iterator'
 subprocess.run(['clang', '-std=c99', '-Wall', '-Wextra', '-Werror', str(out / 'ce-iterator.c'), '-o', str(binary)], check=True)
 rows = json.loads(subprocess.check_output([str(binary)]))
(out / 'ce-iterator.json').write_text(json.dumps(rows, indent=2) + '\n')
(out / 'ce-iterator-source.json').write_text(json.dumps({'source':'BrogueCE-master/src/brogue/Monsters.c:925-949', 'sha256':hashlib.sha256(body.encode()).hexdigest(), 'cases':len(rows), 'scope':'Original CE functions, immutable-list death masks; not a linked-list mutation oracle.'}, indent=2) + '\n')
print(f'CE iterator: {len(rows)} death masks')
