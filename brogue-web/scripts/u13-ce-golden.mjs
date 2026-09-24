// Compile unedited local CE functions; the harness supplies only structs/globals
// and an exhaustive mixed-radix rand_range, not replacement combat formulas.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
const dir = 'ai_docs/reports/u-13-evidence';
fs.mkdirSync(dir, { recursive: true });
const read = n => fs.readFileSync(`../BrogueCE-master/src/brogue/${n}`, 'utf8');
const fn = (s, sig) => {
    const start = s.indexOf(sig); assert(start >= 0, sig);
    const o = s.indexOf('{', start); let depth = 1, i = o + 1;
    for (; depth; i++) { if (s[i] === '{') depth++; if (s[i] === '}') depth--; }
    return s.slice(start, i);
};
const ranges = [[1,2,1],[3,7,2],[9,13,2],[3,4,2],[10,15,3],[25,50,4],[0,10,3],[3,11,3],[0,0,0],[7,7,4],[9,3,2]];
const combat = read('Combat.c'), power = read('PowerTables.c'), header = read('Rogue.h');
const c = `#include <stdio.h>
#include <stdbool.h>
#include <string.h>
${header.match(/^typedef .* fixpt;/m)[0]}
${header.match(/^#define FP_BASE .*$/m)[0]}
${header.match(/^#define FP_FACTOR .*$/m)[0]}
#define min(a,b) ((a)<(b)?(a):(b))
#define max(a,b) ((a)>(b)?(a):(b))
#define clamp(x,lo,hi) min(max(x,lo),hi)
#define LAST_INDEX(a) (sizeof(a)/sizeof(a[0])-1)
typedef bool boolean;
enum { WEAPON=1, ARMOR=2, ITEM_RUNIC=4, W_SLAYING=5 };
enum { STATUS_STUCK, STATUS_PARALYZED, STATUS_DONNING };
enum { MB_CAPTIVE=1, MB_SEIZED=2, MB_SEIZING=4 };
typedef struct {short lowerBound, upperBound, clumpFactor;} randomRange;
typedef struct {int category, strengthRequired, enchant1, flags, enchant2, vorpalEnemy, armor; randomRange damage;} item;
typedef struct {struct {short accuracy, defense; randomRange damage;} info; short weaknessAmount, status[3]; int bookkeepingFlags;} creature;
creature player;
struct {int strength; item *weapon, *armor;} rogue;
boolean monsterIsInClass(creature *m, int c) {(void)m;(void)c;return false;}
long tuple; int calls, lows[16], highs[16];
long rand_range(long lo, long hi) {
    lows[calls]=lo; highs[calls++]=hi;
    if(hi<=lo)return lo;
    long n=lo+tuple%(hi-lo+1); tuple/=hi-lo+1; return n;
}
${fn(read('Math.c'), 'short randClumpedRange(')}
${fn(read('Math.c'), 'short randClump(')}
${fn(read('Math.c'), 'boolean rand_percent(')}
${fn(power, 'fixpt damageFraction(')}
${fn(power, 'fixpt accuracyFraction(')}
${fn(power, 'fixpt defenseFraction(')}
${fn(combat, 'fixpt strengthModifier(')}
${fn(combat, 'fixpt netEnchant(')}
${fn(combat, 'fixpt monsterDamageAdjustmentAmount(')}
${fn(combat, 'short monsterDefenseAdjusted(')}
${fn(combat, 'short monsterAccuracyAdjusted(')}
${fn(combat, 'short hitProbability(')}
${fn(combat, 'boolean attackHit(')}
${fn(read('Items.c'), 'void recalculateEquipmentBonuses(')}
int main(void) {
    int accuracies[]={-1,0,1,50,75,88,100,125,5000,32767};
    int defenses[]={-32768,-1,0,1,2,3,5,10,12,20,32,100,500,1000,32767};
    for(int a=0;a<10;a++)for(int d=0;d<15;d++) {
        creature attacker={0},defender={0};attacker.info.accuracy=accuracies[a];defender.info.defense=defenses[d];
        printf("H %d %d 999 %d\\n",accuracies[a],defenses[d],hitProbability(&attacker,&defender));
    }
    item weapon={.category=WEAPON};rogue.weapon=&weapon;rogue.strength=12;weapon.strengthRequired=12;player.info.accuracy=100;
    for(int e=-20;e<=50;e++)for(int d=0;d<15;d++) {
        weapon.enchant1=e;creature defender={0};defender.info.defense=defenses[d];
        printf("H 100 %d %d %d\\n",defenses[d],e,hitProbability(&player,&defender));
    }
    for(int q=-80;q<=200;q++)printf("F %g %lld %lld\\n",q/4.0,(long long)accuracyFraction(q*FP_FACTOR/4),(long long)damageFraction(q*FP_FACTOR/4));
    for(int d=-205;d<=505;d++)printf("D %d %lld\\n",d,(long long)defenseFraction(d*FP_FACTOR));
    int base[][3]={{1,2,1},{3,4,1},{3,11,3},{25,35,3}},enchants[]={-20,-1,0,1,10,50};
    item armor={.category=ARMOR,.strengthRequired=12,.armor=30};rogue.armor=&armor;
    for(int b=0;b<4;b++)for(int e=0;e<6;e++)for(int strength=9;strength<=15;strength++) {
        weapon.damage=(randomRange){base[b][0],base[b][1],base[b][2]};
        weapon.enchant1=armor.enchant1=enchants[e];rogue.strength=strength;
        recalculateEquipmentBonuses();
        printf("E %d %d %d %d %d %d %d %d\\n",base[b][0],base[b][1],base[b][2],enchants[e],strength,player.info.damage.lowerBound,player.info.damage.upperBound,player.info.defense);
    }
    int ranges[][3]={${ranges.map(r=>`{${r}}`).join(',')}};
    for(int i=0;i<${ranges.length};i++) {
        int lo=ranges[i][0],hi=ranges[i][1],cl=ranges[i][2],counts[256]={0};calls=0;tuple=0;
        randClumpedRange(lo,hi,cl);long total=1;int dice=calls;
        printf("R %d %d %d %d",lo,hi,cl,dice);
        for(int j=0;j<dice;j++){total*=highs[j]-lows[j]+1;printf(" %d %d",lows[j],highs[j]);}
        for(long n=0;n<total;n++){tuple=n;calls=0;counts[randClumpedRange(lo,hi,cl)]++;}
        printf(" %ld",total);for(int v=lo;v<=max(lo,hi);v++)printf(" %d",counts[v]);printf("\\n");
    }
}
`;
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'u13-ce-'));
try {
    fs.writeFileSync(`${tmp}/golden.c`,c);
    execFileSync('clang',['-std=c11','-Wall','-Werror',`${tmp}/golden.c`,'-o',`${tmp}/golden`]);
    const output=execFileSync(`${tmp}/golden`,{encoding:'utf8'});
    const result={hits:[],fractions:[],defenses:[],equipment:[],ranges:[]};
    for(const line of output.trim().split('\n')) {
        const [kind,...raw]=line.split(' '), v=raw.map(Number);
        if(kind==='H')result.hits.push({accuracy:v[0],defense:v[1],enchant:v[2]===999?null:v[2],hit:v[3]});
        if(kind==='F')result.fractions.push({enchant:v[0],accuracy:v[1],damage:v[2]});
        if(kind==='D')result.defenses.push({defense:v[0],fraction:v[1]});
        if(kind==='E')result.equipment.push({lo:v[0],hi:v[1],clump:v[2],enchant:v[3],strength:v[4],scaledLo:v[5],scaledHi:v[6],defense:v[7]});
        if(kind==='R') {
            const [lo,hi,clump,dice,...tail]=v;
            const row={lo,hi,clump,dice:Array.from({length:dice},(_,i)=>tail.slice(i*2,i*2+2)),combinations:tail[dice*2],weights:tail.slice(dice*2+1)};
            assert.equal(row.weights.reduce((a,b)=>a+b,0),row.combinations);result.ranges.push(row);
        }
    }
    fs.writeFileSync(`${dir}/ce-combat.c`,c);
    fs.writeFileSync(`${dir}/ce-combat.json`,JSON.stringify(result,null,2)+'\n');
    console.log(JSON.stringify(Object.fromEntries(Object.entries(result).map(([k,v])=>[k,v.length]))));
} finally {fs.rmSync(tmp,{recursive:true,force:true});}
