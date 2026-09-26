// Parse only the local CE authority; no web catalog imports.
import fs from 'node:fs';import crypto from 'node:crypto';
const file='../BrogueCE-master/src/variants/GlobalsBrogue.c',source=fs.readFileSync(file,'utf8'),lines=source.split('\n');
const number=s=>Number(s.trim().replace('DEEPEST_LEVEL-1','39').replace('DEEPEST_LEVEL','40').replace('AMULET_LEVEL','26'));
const targets=[1,2,6,7,26,28,47,52,55];
let ce=0,active=false,current;const machines=[];
for(let i=0;i<lines.length;i++){
 const line=lines[i];if(line.startsWith('const blueprint blueprintCatalog_Brogue'))active=true;if(!active)continue;if(line.startsWith('};'))break;
 if(/^    \{"/.test(line)){
  ce++;current=null;if(!targets.includes(ce))continue;
  const m=lines[i+1].match(/\{([^}]+)\},\s*\{([^}]+)\},\s*(\d+),\s*(\d+),\s*([^,]+),\s*([^\{]+)\{/);if(!m)throw Error(line);
  current={ce,name:line.match(/"([^"]+)"/)[1],line:i+1,depthRange:m[1].split(',').map(number),roomSize:m[2].split(',').map(number),frequency:+m[3],featureCount:+m[4],flags:m[6].match(/BP_\w+/g)??[],features:[]};machines.push(current);
 }else if(current&&/^        \{/.test(line))current.features.push({line:i+1,literal:line.trim(),flags:line.match(/MF_\w+/g)??[]});
}
let ai=-1;active=false;const autogen=[];
for(let i=0;i<lines.length;i++){
 const l=lines[i];if(l.startsWith('const autoGenerator autoGeneratorCatalog_Brogue'))active=true;if(!active)continue;if(l.startsWith('};'))break;
 if(!/^    \{/.test(l))continue;ai++;
 const f=l.slice(l.indexOf('{')+1,l.lastIndexOf('}')).split(',').map(s=>s.trim());
 autogen.push({index:ai,line:i+1,terrain:f[0],machine:f[3],foundation:f.slice(4,6),minDepth:number(f[6]),maxDepth:number(f[7]),frequency:number(f[8]),minNumberIntercept:number(f[9]),minNumberSlope:number(f[10]),maxNumber:number(f[11])});
}
const headerFile='../BrogueCE-master/src/brogue/Rogue.h',header=fs.readFileSync(headerFile,'utf8');
const block=header.slice(header.indexOf('enum machineTypes'),header.indexOf('enum machineTypes')+6500);
const types=(block.slice(0,block.indexOf('};')).match(/\bMT_\w+/g)??[]);
for(const m of machines)m.machineType=types[m.ce-1];
const out={file,sha256:crypto.createHash('sha256').update(source).digest('hex'),headerFile,headerSHA256:crypto.createHash('sha256').update(header).digest('hex'),machines,autogen};
fs.writeFileSync('src/test/fixtures/u19e-ce-catalog.json',JSON.stringify(out,null,2)+'\n');console.log(machines.length,'machines',autogen.length,'autoGen rows');
