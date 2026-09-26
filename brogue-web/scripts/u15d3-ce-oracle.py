"""Compile the local CE equipment branches, enums and lotteries, with a recorded RNG tape.

Run from brogue-web. Only rand_range is substituted: this oracle compares the
ordered logical draw requests, not the already separately tested PRNG algorithm.
"""
import hashlib
import json
from pathlib import Path
import re
import subprocess
import tempfile

out = Path('ai_docs/reports/u-15d3-evidence')
ce = Path('../BrogueCE-master/src/brogue')
items, header, glob, math = [(ce / f).read_text() for f in ['Items.c', 'Rogue.h', 'Globals.c', 'Math.c']]


def function(source, signature):
    start = source.index(signature)
    brace = source.index('{', start)
    count = 1
    end = brace + 1
    while count:
        count += (source[end] == '{') - (source[end] == '}')
        end += 1
    return source[start:end]


enums = '\n'.join(re.search(r'enum ' + name + r' \{[\s\S]*?\n};', header)[0]
                  for name in ['itemCategory', 'itemFlags', 'weaponKind', 'weaponEnchants', 'armorKind', 'armorEnchants'])
tables = []
kind_names = {}
for category, table in [('WEAPON', 'weaponTable'), ('ARMOR', 'armorTable')]:
    body = re.search(r'itemTable ' + table + r'\[[^]]+\] = \{([\s\S]*?)\n};', glob)[1]
    rows = re.findall(r'\{"([^"]+)"\s*,\s*"",\s*"",\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+),\s*\{([^}]+)\}', body)
    assert len(rows) == (15 if category == 'WEAPON' else 6)
    kind_names[category] = [r[0] for r in rows]
    tables.append('itemTable ' + table + '[] = {' + ','.join('{' + r[3] + ',{' + r[5] + '}}' for r in rows) + '};')

class_body = re.search(r'const monsterClass monsterClassCatalog[^=]+= \{([\s\S]*?)\n};', glob)[1]
classes = re.findall(r'\{"([^"]+)"\s*,\s*(\d+),\s*(-?\d+),', class_body)
assert len(classes) == 15
class_table = 'struct {char *name; short frequency, maxDepth;} monsterClassCatalog[] = {' + ','.join('{"%s",%s,%s}' % r for r in classes) + '};'
branches = items[items.index('        case WEAPON:', items.index('item *makeItemInto')):items.index('        case SCROLL:', items.index('item *makeItemInto'))]
source = r'''
#include <stdio.h>
#include <stdlib.h>
#include <stdbool.h>
#include <assert.h>
#include <string.h>
#define Fl(n) (1UL << (n))
#define brogueAssert assert
#define clamp(x,a,b) ((x)<(a)?(a):((x)>(b)?(b):(x)))
#define MONSTER_CLASS_COUNT 15
typedef bool boolean;
typedef struct {short lowerBound, upperBound, clumpFactor;} randomRange;
typedef struct {short strengthRequired; randomRange range;} itemTable;
typedef struct {randomRange damage; short strengthRequired,enchant1,enchant2,vorpalEnemy,quantity,quiverNumber,charges,armor; unsigned long flags;} item;
struct {short depthLevel;} rogue;
struct constants {short weaponKillsToAutoID,armorDelayToAutoID;} constants = {20,1000}, *gameConst = &constants;
static long tape[128], calls[128][3]; static int count, length;
long rand_range(long lo,long hi) {
    if (hi<=lo) return lo;
    assert(count<128);
    long raw=count<length?tape[count]:99, value=lo+raw%(hi-lo+1);
    calls[count][0]=lo;calls[count][1]=hi;calls[count++][2]=value;return value;
}
short chooseKind(const itemTable *t, short n) {abort();}
short randClumpedRange(short,short,short);
''' + enums + '\n' + '\n'.join(tables) + '\n' + class_table + '\n' + '\n'.join([
    function(math, 'short randClumpedRange('), function(math, 'short randClump('),
    function(math, 'boolean rand_percent('), function(items, 'static short lotteryDraw('),
    function(items, 'short chooseVorpalEnemy()'),
]) + '\nvoid equipment(item *theItem, int category, short itemKind) { const itemTable *theEntry = NULL; switch(category) {\n' + branches + '\n}}\n' + r'''
int main(void) {
    int category,kind,depth;
    while(scanf("%d %d %d %d",&category,&kind,&depth,&length)==4) {
        for(int j=0;j<length;j++)assert(scanf("%ld",&tape[j])==1);
        count=0; rogue.depthLevel=depth; item i={0}; i.quantity=1; i.vorpalEnemy=-1;
        if(category<0)i.vorpalEnemy=chooseVorpalEnemy();else equipment(&i,category?ARMOR:WEAPON,kind);
        printf("{\"enchantment\":%d,\"runicIndex\":%d,\"isCursed\":%s,\"vorpalIndex\":%d,\"quantity\":%d,\"quiverNumber\":%d,\"charges\":%d,\"strength\":%d,\"draws\":[",
            i.enchant1,(i.flags&ITEM_RUNIC)?i.enchant2:-1,(i.flags&ITEM_CURSED)?"true":"false",i.vorpalEnemy,i.quantity,i.quiverNumber,i.charges,i.strengthRequired);
        for(int j=0;j<count;j++)printf("%s[%ld,%ld,%ld]",j?",":"",calls[j][0],calls[j][1],calls[j][2]);
        puts("]}");
    }
}
'''
(out / 'ce-oracle.c').write_text(source)
requests = []


def add(category, kind, depth, tape, label):
    requests.append(dict(category=category, kind=kind, depth=depth, tape=tape, label=label))


for category in [0, 1]:
    for kind in range(15 if category == 0 else 6):
        for first in [40, 99]:
            add(category, kind, 1, [first], 'no-enchant')
        for enchant in [0, 2]:
            for curse in [33, 99]:
                add(category, kind, 1, [39, enchant, 49, curse], 'curse-without-runic')
            for idx in range(2 if category == 0 else 3):
                add(category, kind, 26, [39, enchant, 49, 32, idx], 'bad-runic')
        for threshold in range(8 if category == 0 else 96):
            for idx in range(8):
                add(category, kind, 10, [39, 2, 50, threshold, idx, 99], 'good-threshold')
        add(category, kind, 26, [0, 0, 99, 0] + [0] * 20 + [99], 'unbounded-tail')
for depth in [1, 10, 11, 12, 13, 15, 16, 17, 18, 19, 22, 23, 26]:
    total = sum(int(f) for _, f, d in classes if int(d) <= 0 or depth <= int(d))
    for ticket in range(total):
        add(-1, 0, depth, [ticket], 'vorpal-ticket')
stdin = '\n'.join(' '.join(map(str, [r['category'], r['kind'], r['depth'], len(r['tape']), *r['tape']])) for r in requests)
with tempfile.TemporaryDirectory(prefix='u15d3-ce-') as tmp:
    executable = str(Path(tmp) / 'oracle')
    subprocess.run(['cc', '-std=c11', '-O2', str(out / 'ce-oracle.c'), '-o', executable], check=True)
    result = subprocess.run([executable], input=stdin, text=True, capture_output=True, check=True)
results = [json.loads(row) for row in result.stdout.splitlines()]
assert len(results) == len(requests)
weapon_runics = re.findall(r'"([^"]+)"', re.search(r'const char weaponRunicNames[^=]+= \{([\s\S]*?)\n};', glob)[1])
armor_runics = re.findall(r'"([^"]+)"', re.search(r'const char armorRunicNames[^=]+= \{([\s\S]*?)\n};', glob)[1])
data = dict(sources={name: hashlib.sha256((ce / name).read_bytes()).hexdigest() for name in ['Items.c', 'Math.c', 'Globals.c', 'Rogue.h']},
            kinds=kind_names, weaponRunics=weapon_runics, armorRunics=armor_runics, classes=classes,
            cases=[dict(request=r, expected=v) for r, v in zip(requests, results)])
(out / 'ce-golden.json').write_text(json.dumps(data, separators=(',', ':')) + '\n')
print(f'Compiled original CE equipment branches: {len(results)} cases, {sum(len(v["draws"]) for v in results)} logical RNG requests.')
