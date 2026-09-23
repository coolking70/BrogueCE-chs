import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';
const dir='ai_docs/reports/w-18-evidence';fs.mkdirSync(dir,{recursive:true});
const source=fs.readFileSync('../BrogueCE-master/src/brogue/PowerTables.c','utf8');
const fn=source.match(/^short staffEntrancementDuration\(fixpt enchant\).*$/m)?.[0];if(!fn)throw Error('CE function missing');
const c=`#include <stdio.h>\n#include <stdint.h>\ntypedef int64_t fixpt;\n#define FP_FACTOR 65536\n${fn}\nint main(void){for(int e=0;e<=50;e++)printf("%d %d\\n",e*65536,staffEntrancementDuration(e*65536));\nint partial[]={1,21845,21846,65535,65537,152917};for(unsigned i=0;i<sizeof(partial)/sizeof(partial[0]);i++)printf("%d %d\\n",partial[i],staffEntrancementDuration(partial[i]));}\n`;
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'w18-ce-'));try{fs.writeFileSync(`${tmp}/golden.c`,c);execFileSync('clang',['-std=c11','-Wall','-Werror',`${tmp}/golden.c`,'-o',`${tmp}/golden`]);fs.writeFileSync(`${dir}/ce-entrancement.c`,c);fs.writeFileSync(`${dir}/ce-entrancement.txt`,execFileSync(`${tmp}/golden`));}finally{fs.rmSync(tmp,{recursive:true,force:true});}
