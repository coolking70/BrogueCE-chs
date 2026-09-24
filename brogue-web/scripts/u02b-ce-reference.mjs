// Compile verbatim CE RNG functions and initializeRogue's seed/stair draw block.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
const dir='ai_docs/reports/u-02b-evidence';
const math=fs.readFileSync('../BrogueCE-master/src/brogue/Math.c','utf8');
const main=fs.readFileSync('../BrogueCE-master/src/brogue/RogueMain.c','utf8');
const rng=math.slice(math.indexOf('typedef uint32_t u4;'),math.indexOf('    // Fixed-point arithmetic'));
const seedBlock=main.slice(main.indexOf('        if (rogue.seed >> 32)'),main.indexOf('        levels[i].monsters ='));
const stairBlock=main.slice(main.indexOf('        do {\n            levels[i].downStairsLoc.x'),main.indexOf('\n    // initialize the waypoints list')).replace(/\n    }\s*$/, '');
const source=`#include <stdint.h>\n#include <stdio.h>\n#include <stdlib.h>\n#include <time.h>\n#include <assert.h>\n#define RNG_SUBSTANTIVE 0\n#define RNG_COSMETIC 1\n#define brogueAssert assert\n#define DCOLS 79\n#define DROWS 29\ntypedef struct {short x,y;} pos;\nstruct { int RNG; uint64_t seed; } rogue;\nunsigned long randomNumbersGenerated;\nstruct {int deepestLevel;} constants={40}, *gameConst=&constants;\nstruct {uint64_t levelSeed; pos upStairsLoc,downStairsLoc;} levels[41];\nshort distanceBetween(pos a,pos b){int x=abs(a.x-b.x),y=abs(a.y-b.y);return x>y?x:y;}\n${rng}\nint main(int argc,char **argv){\n rogue.seed=strtoull(argv[1],NULL,10); seedRandomGenerator(rogue.seed);\n printf("{\\"seed\\":\\"%llu\\",\\"initial\\":[",(unsigned long long)rogue.seed);\n for(int j=0;j<2;j++){ranctx r=RNGState[j];printf("%s[%u,%u,%u,%u]",j?",":"",r.a,r.b,r.c,r.d);}\n printf("],\\"raw64\\":[");\n for(int j=0;j<8;j++){uint64_t v=rand_64bits();printf("%s\\"%llu\\"",j?",":"",(unsigned long long)v);}\n seedRandomGenerator(rogue.seed); randomNumbersGenerated=0;\n levels[0].upStairsLoc=(pos){(DCOLS-1)/2-1,DROWS-2};\n printf("],\\"levels\\":[");\n for(int i=0;i<41;i++){\n${seedBlock}\n${stairBlock}\n printf("%s{\\"levelSeed\\":\\"%llu\\",\\"visited\\":false,\\"upStairsLoc\\":{\\"x\\":%d,\\"y\\":%d},\\"downStairsLoc\\":{\\"x\\":%d,\\"y\\":%d}}",i?",":"",(unsigned long long)levels[i].levelSeed,levels[i].upStairsLoc.x,levels[i].upStairsLoc.y,levels[i].downStairsLoc.x,levels[i].downStairsLoc.y);\n }\n ranctx r=RNGState[0];printf("],\\"count\\":%lu,\\"afterTable\\":[%u,%u,%u,%u]}\\n",randomNumbersGenerated,r.a,r.b,r.c,r.d);\n}\n`;
fs.writeFileSync(`${dir}/ce-reference.c`,source);
execFileSync('cc',['-std=c99','-O2',`${dir}/ce-reference.c`,'-o','/tmp/u02b-ce-reference']);
const rows=['7','424242','777','20260913','31337','4294967296','1099511627783','9007199254740993','18446744073709551615'].map(seed=>JSON.parse(execFileSync('/tmp/u02b-ce-reference',[seed],{encoding:'utf8'})));
fs.writeFileSync(`${dir}/ce-reference.json`,JSON.stringify(rows,null,2)+'\n');
fs.writeFileSync(`${dir}/ce-sources.json`,JSON.stringify(Object.fromEntries(['Math.c','RogueMain.c','Monsters.c','Recordings.c','Rogue.h','Globals.c','../variants/GlobalsBrogue.c'].map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync('../BrogueCE-master/src/brogue/'+f)).digest('hex')])),null,2)+'\n');
console.log(`${rows.length} CE seeds, 41 seed/stair records each`);
