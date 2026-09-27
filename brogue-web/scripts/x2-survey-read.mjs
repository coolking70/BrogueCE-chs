import fs from 'node:fs';
import path from 'node:path';
if(process.argv[2]==='--grep'){
  const re=new RegExp(process.argv[3]);
  const walk=p=>fs.statSync(p).isDirectory()?fs.readdirSync(p).flatMap(n=>walk(path.join(p,n))):[p];
  for(const file of process.argv.slice(4).flatMap(walk).filter(p=>/\.(ts|vue|json|md|c|h|mjs)$/.test(p)))fs.readFileSync(file,'utf8').split('\n').forEach((s,i)=>{if(re.test(s))console.log(`${file.replaceAll('\\','/')}:${i+1}:${s.trimEnd()}`);});
  process.exit(0);
}
for (const spec of process.argv.slice(2)) {
  const match = spec.match(/^(.*?)(?::(\d+)(?:-(\d+))?)?$/);
  const [,file,start,end] = match;
  const lines = fs.readFileSync(file,'utf8').split('\n');
  const from = start ? Number(start)-1 : 0;
  const to = end ? Number(end) : start ? Math.min(from+80,lines.length) : lines.length;
  console.log(lines.slice(from,to).map((s,i)=>`${file}:${from+i+1}:${s.replace(/\r$/, '')}`).join('\n'));
}
