// Compile the unmodified CE fixed-point function; no floating-point oracle.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const dir='ai_docs/reports/w-16-evidence';fs.mkdirSync(dir,{recursive:true});
const source=fs.readFileSync('../BrogueCE-master/src/brogue/PowerTables.c','utf8');
const fn=source.match(/^short staffBladeCount\(fixpt enchant\).*$/m)?.[0];if(!fn)throw Error('CE function missing');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'w16-ce-'));
const c='#include <stdio.h>\n#include <stdint.h>\ntypedef int64_t fixpt;\n#define FP_FACTOR 65536\n'+fn+'\nint main(void) { for(int q=0;q<=80;q++) printf("%d %d\\n",q*16384,staffBladeCount((fixpt)q*16384)); }\n';
try {fs.writeFileSync(path.join(tmp,'golden.c'),c);execFileSync('clang',['-std=c11','-Wall','-Werror',path.join(tmp,'golden.c'),'-o',path.join(tmp,'golden')]);
 const out=execFileSync(path.join(tmp,'golden'),{encoding:'utf8'});
 fs.writeFileSync(`${dir}/ce-blade-count.c`,c);fs.writeFileSync(`${dir}/ce-blade-count.txt`,out);
 console.log(out.split('\n').filter((_,i)=>[0,8,12,32,80].includes(i)).join('\n'));
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
