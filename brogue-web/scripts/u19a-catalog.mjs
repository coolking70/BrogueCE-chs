import fs from 'node:fs';import crypto from 'node:crypto';
const file='../BrogueCE-master/src/variants/GlobalsBrogue.c',source=fs.readFileSync(file,'utf8');
let ce=0,index=0,active=false;const rows=[];
for(const [i,line] of source.split('\n').entries()){
 if(line.startsWith('const blueprint blueprintCatalog_Brogue'))active=true;
 if(!active)continue;if(line.startsWith('};'))break;
 if(/^    \{"/.test(line)){ce++;index=0;}
 if(/^        \{/.test(line)){
  if(/MF_IN_(PASSABLE_)?VIEW_OF_ORIGIN/.test(line))rows.push({ce,index,line:i+1,flags:line.match(/MF_[A-Z_]+/g)??[],literal:line.trim()});
  index++;
 }
}
const result={file,sha256:crypto.createHash('sha256').update(source).digest('hex'),rows};
fs.writeFileSync('src/test/fixtures/u19a-ce-carriers.json',JSON.stringify(result,null,2)+'\n');
console.log(rows.length,'CE feature carriers');
