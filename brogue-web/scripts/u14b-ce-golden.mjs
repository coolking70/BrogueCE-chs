// Compile original CE functions unmodified, using minimal struct/global stubs.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const dir='ai_docs/reports/u-14b-evidence'; fs.mkdirSync(dir,{recursive:true});
const read=n=>fs.readFileSync(`../BrogueCE-master/src/brogue/${n}`,'utf8');
const fn=(s,sig)=>{const a=s.indexOf(sig);assert(a>=0);let i=s.indexOf('{',a)+1,d=1;for(;d;i++){if(s[i]==='{')d++;if(s[i]==='}')d--;}return s.slice(a,i);};
const combat=read('Combat.c'),power=read('PowerTables.c');
const source=`#include <stdio.h>
#include <stdbool.h>
typedef long long fixpt;
#define FP_BASE 16
#define FP_FACTOR (1LL << FP_BASE)
#define min(a,b) ((a)<(b)?(a):(b))
#define max(a,b) ((a)>(b)?(a):(b))
#define clamp(x,lo,hi) min(max(x,lo),hi)
#define LAST_INDEX(a) (sizeof(a)/sizeof(a[0])-1)
enum { WEAPON=1, ARMOR=2, STATUS_DONNING=0 };
typedef struct {short lowerBound,upperBound,clumpFactor;} randomRange;
typedef struct {int category,strengthRequired,enchant1,armor;randomRange damage;} item;
typedef struct {struct {short accuracy,defense;randomRange damage;} info;short weaknessAmount,status[1];} creature;
creature player;
struct {int strength;item *weapon,*armor;} rogue;
${fn(power,'fixpt damageFraction(')}
${fn(power,'fixpt accuracyFraction(')}
${fn(combat,'fixpt strengthModifier(')}
${fn(combat,'fixpt netEnchant(')}
${fn(combat,'fixpt monsterDamageAdjustmentAmount(')}
${fn(combat,'short monsterAccuracyAdjusted(')}
${fn(combat,'short monsterDefenseAdjusted(')}
${fn(read('Items.c'),'void recalculateEquipmentBonuses(')}
int main(void) {
 item weapon={.category=WEAPON,.strengthRequired=17,.enchant1=2,.damage={10,20,2}};
 item armor={.category=ARMOR,.strengthRequired=17,.enchant1=2,.armor=40};
 rogue.strength=18;rogue.weapon=&weapon;rogue.armor=&armor;
 for(int w=0;w<=10;w++) for(int d=0;d<=4;d++) {
  player.status[STATUS_DONNING]=d;
  creature m={.info={.accuracy=120,.defense=160},.weaknessAmount=w};
  player.weaknessAmount=w;recalculateEquipmentBonuses();
  printf("%d %d %lld %d %d %lld %lld %d %d %d %d\\n",w,d,monsterDamageAdjustmentAmount(&m),monsterAccuracyAdjusted(&m),monsterDefenseAdjusted(&m),strengthModifier(&weapon),netEnchant(&weapon),player.info.damage.lowerBound,player.info.damage.upperBound,player.info.defense,12+2*max(rogue.strength-player.weaknessAmount-12,2));
 }
}
`;
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'u14b-ce-'));
try {
 fs.writeFileSync(`${tmp}/golden.c`,source); execFileSync('clang',['-std=c11','-Wall','-Werror',`${tmp}/golden.c`,'-o',`${tmp}/golden`]);
 const out=execFileSync(`${tmp}/golden`,{encoding:'utf8'});
 const keys=['weakness','donning','damageFP','accuracy','defense','strengthModifierFP','netEnchantFP','weaponLow','weaponHigh','playerDefense','throwDistance'];
 const rows=out.trim().split('\n').map(l=>Object.fromEntries(l.split(' ').map((v,i)=>[keys[i],Number(v)])));
 fs.writeFileSync(`${dir}/ce-donning.c`,source);fs.writeFileSync(`${dir}/ce-donning.json`,JSON.stringify(rows,null,2)+'\n');console.log(`${rows.length} original CE golden rows`);
} finally {fs.rmSync(tmp,{recursive:true,force:true});}
