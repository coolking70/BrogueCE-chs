// Extract and compile the unmodified CE integer formula and percentage predicate.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const dir='ai_docs/reports/w-17-evidence';fs.mkdirSync(dir,{recursive:true});
const source=fs.readFileSync('../BrogueCE-master/src/brogue/PowerTables.c','utf8');
const fn=source.match(/^short wandDominate\(creature \*monst\)[\s\S]*?;}/m)?.[0];
const percent=fs.readFileSync('../BrogueCE-master/src/brogue/Math.c','utf8').match(/boolean rand_percent\(short percent\) \{[^}]*}/)?.[0];
if(!fn||!percent)throw Error('CE functions missing');
const c=`#include <stdio.h>
typedef int boolean;
typedef struct { short currentHP; struct { short maxHP; } info; } creature;
#define max(a,b) ((a)>(b)?(a):(b))
#define min(a,b) ((a)<(b)?(a):(b))
#define clamp(a,b,c) min(c,max(b,a))
static int roll;
int rand_range(int lo, int hi) { (void)lo; (void)hi; return roll; }
${fn}
${percent}
int main(void) {
  int maxima[]={3,5,7,25,99,100,101,137};
  for (unsigned i=0;i<sizeof(maxima)/sizeof(maxima[0]);i++) {
    creature m={.info.maxHP=maxima[i]};
    for(int hp=1;hp<=maxima[i]+1;hp++) {
      m.currentHP=hp;int chance=wandDominate(&m),successes=0;
      for(roll=0;roll<100;roll++) successes+=rand_percent(chance);
      printf("%d %d %d %d\\n",hp,maxima[i],chance,successes);
    }
  }
}
`;
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'w17-ce-'));
try{fs.writeFileSync(path.join(tmp,'golden.c'),c);execFileSync('clang',['-std=c11','-Wall','-Werror',path.join(tmp,'golden.c'),'-o',path.join(tmp,'golden')]);
 fs.writeFileSync(`${dir}/ce-domination.c`,c);fs.writeFileSync(`${dir}/ce-domination.txt`,execFileSync(path.join(tmp,'golden')));
 console.log(fs.readFileSync(`${dir}/ce-domination.txt`,'utf8').split('\n').filter(s=>/^(19|20|100) 100 /.test(s)).join('\n'));
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
