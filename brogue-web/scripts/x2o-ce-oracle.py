#!/usr/bin/env python3
"""Independent CE-only parser and exhaustive C randClump oracle. No web data input."""
from pathlib import Path
import re, json, hashlib, subprocess, tempfile, sys
root = Path(__file__).resolve().parent.parent
ce = root.parent / 'BrogueCE-master/src'
out = root / 'ai_docs/reports/x2o-evidence'
files = [ce/'variants/GlobalsBrogue.c', ce/'brogue/Globals.c', ce/'brogue/Rogue.h', ce/'brogue/Math.c']
v, g, h, math = [f.read_text() for f in files]
def clean(s):
    return re.sub(r'"(?:\\.|[^"\\])*"|/\*.*?\*/|//[^\n]*', lambda m: m[0] if m[0].startswith('"') else '', s, flags=re.S)
def split(s):
    parts=[]; begin=0; depth=0; quoted=False; escape=False
    for i,c in enumerate(s):
        if quoted:
            if escape: escape=False
            elif c=='\\': escape=True
            elif c=='"': quoted=False
        elif c=='"': quoted=True
        elif c in '{(': depth+=1
        elif c in '})': depth-=1
        elif c==',' and depth==0: parts.append(s[begin:i].strip()); begin=i+1
    if s[begin:].strip(): parts.append(s[begin:].strip())
    return parts
def body(s): return s.strip()[1:-1]
def catalog(name, source):
    block=source[source.index(name):]; block=block[block.index('{')+1:block.index('\n};')]
    return split(clean(block))
def num(s):
    for k,value in defines.items(): s=re.sub(r'\b'+k+r'\b',value,s)
    assert re.fullmatch(r'[\d\s+\-]+',s),s
    return sum(int(x) for x in re.findall(r'[+\-]?\s*\d+',s.replace(' ','')))
defines=dict(re.findall(r'^#define\s+(AMULET_LEVEL|DEEPEST_LEVEL)\s+(\d+)',v,re.M))
monster_names=re.findall(r'\{\s*0,\s*"([^"]+)"',g[g.index('creatureType monsterCatalog['):g.index('creatureType monsterCatalog[')+g[g.index('creatureType monsterCatalog['):].index('\n};')])
enums=split(clean(re.search(r'enum monsterTypes\s*\{(.*?)\};',h,re.S)[1]))
enums=[x.strip().split('=')[0].strip() for x in enums if 'NUMBER_MONSTER_KINDS' not in x]
assert len(enums)==len(monster_names)
names=dict(zip(enums,[x.upper().replace(' ','_') for x in monster_names]))
hordes=[]
for i,row in enumerate(catalog('const hordeType hordeCatalog_Brogue[]',v)):
    f=split(body(row)); n=int(f[1]); species=split(body(f[2])); ranges=split(body(f[3]))
    members=[]
    for j in range(n):
        r=list(map(num,split(body(ranges[j])))); assert len(r)==3
        members.append(dict(type=names[species[j]],lower=r[0],upper=r[1],clumpFactor=r[2]))
    hordes.append(dict(index=i,leader=names[f[0]],members=members,literal=row))
blueprints=[]
for i,row in enumerate(catalog('const blueprint blueprintCatalog_Brogue[]',v)):
    if i==0: assert row=='{0}'; continue
    f=split(body(row));blueprints.append(dict(ceBlueprintId=i,name=json.loads(f[0].replace(chr(92)+chr(10), "")),depthRange=list(map(num,split(body(f[1]))))))
assert len(hordes)==175 and len(blueprints)==71
sources={str(f.relative_to(root.parent)):hashlib.sha256(f.read_bytes()).hexdigest() for f in files}
golden=dict(sources=sources,hordes=hordes,blueprints=blueprints)
# Extract both exact CE functions; enumerate all possible rand_range result tapes.
start=math.index('short randClump(');end=math.index('// Test a random roll',start)
functions=math[start:end]
c=r'''#include <stdio.h>
#include <stdlib.h>
#include <setjmp.h>
typedef struct {short lowerBound, upperBound, clumpFactor;} randomRange;
short randClumpedRange(short, short, short);
static jmp_buf probe;
static int tape[32], lows[32], highs[32], length, cursor, first;
static short needLow, needHigh;
short rand_range(short lo, short hi) {
    if(cursor==length) {needLow=lo; needHigh=hi; longjmp(probe,1);}
    lows[cursor]=lo; highs[cursor]=hi;
    int result=tape[cursor++];
    if(result<lo || result>hi) abort();
    return result;
}
'''+functions+r'''
static randomRange range;
static void explore(void) {
    cursor=0;
    if(setjmp(probe)) {
        int lo=needLow, hi=needHigh;
        for(int v=lo;v<=hi;v++) {tape[length++]=v; explore(); --length;}
        return;
    }
    int value=randClump(range);
    if(!first) printf(","); first=0;
    printf("{\"value\":%d,\"calls\":[",value);
    for(int i=0;i<cursor;i++) printf("%s[%d,%d,%d]",i?",":"",lows[i],highs[i],tape[i]);
    printf("]}");
}
int main(int argc,char **argv) {
    if(argc!=4) return 1;
    range=(randomRange){atoi(argv[1]),atoi(argv[2]),atoi(argv[3])};
    first=1;printf("[");explore();printf("]\n");return 0;
}
'''
# longjmp target is reset on every recursive explore; each outer call has already
# branched before recursion and does not invoke randClump again.
ranges=sorted({(m['lower'],m['upper'],m['clumpFactor']) for x in hordes for m in x['members']} | {(7,4,2),(1,4,0),(1,2,4)})
with tempfile.TemporaryDirectory(prefix='x2o-oracle-') as tmp:
    src=Path(tmp)/'oracle.c';exe=Path(tmp)/'oracle';src.write_text(c)
    subprocess.run(['cc','-std=c99','-O0','-Wall','-Wextra',str(src),'-o',str(exe)],check=True)
    oracle=[dict(range=r,cases=json.loads(subprocess.check_output([str(exe),*map(str,r)]))) for r in ranges]
for name,obj in [('src/test/fixtures/x2o-ce-catalog.json',golden),('src/test/fixtures/x2o-clump-oracle.json',oracle)]:
    target=root/name; data=json.dumps(obj,ensure_ascii=False,indent=2)+'\n'
    if '--check' in sys.argv: assert target.read_text()==data, f'Stale {name}'
    else: target.write_text(data)
if '--check' not in sys.argv:
    (out/'ce-oracle.c').write_text(c)
    (out/'ce-oracle-provenance.json').write_text(json.dumps(dict(sources=sources,functions=functions,ranges=len(ranges),cases=sum(len(x['cases']) for x in oracle)),indent=2)+'\n')
print(f'{len(hordes)} hordes / {sum(len(x["members"]) for x in hordes)} members / {len(blueprints)} blueprints / {len(ranges)} ranges / {sum(len(x["cases"]) for x in oracle)} exhaustive C paths')
