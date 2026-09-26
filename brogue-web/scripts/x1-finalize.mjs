import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const root=path.resolve(import.meta.dirname,'..');
const evidence=path.join(root,'ai_docs/reports/x-1-evidence');
const report=path.join(root,'ai_docs/reports/x-1-survey.report.md');
const walk=p=>fs.readdirSync(p,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(p,e.name)):[path.join(p,e.name)]);
const files=[report,...fs.readdirSync(path.join(root,'scripts')).filter(n=>n.startsWith('x1-')).map(n=>path.join(root,'scripts',n)),...walk(evidence)];
const texts=files.filter(p=>/\.(json|md|mjs|txt)$/.test(p));
const normalized=[];
for(const p of texts){const before=fs.readFileSync(p,'utf8');const after=before.replace(/^\uFEFF/,'').replaceAll('\r\n','\n').replaceAll('\r','\n');if(before!==after){fs.writeFileSync(p,after);normalized.push(path.relative(root,p).replaceAll('\\','/'));}}
const body=fs.readFileSync(report,'utf8');
const missingK=Array.from({length:42},(_,i)=>`K${String(i+1).padStart(2,'0')}`).filter(k=>!new RegExp(`^\\| ${k}(?: |（)`, 'm').test(body));
const missingD=Array.from({length:27},(_,i)=>`D${String(i+1).padStart(2,'0')}`).filter(k=>!new RegExp(`^\\| ${k} `, 'm').test(body));
const reports=fs.readdirSync(path.join(root,'ai_docs/reports')).filter(n=>/^u-.*\.report\.md$/.test(n));
const missingReports=reports.filter(n=>!body.includes(`[${n}]`));
const missingLinks=[...body.matchAll(/\]\(([^)]+)\)/g)].map(m=>m[1]).filter(s=>!s.startsWith('http')&&!s.includes('#')).filter(s=>!fs.existsSync(path.resolve(path.dirname(report),s))&&s!=='x-1-evidence/delivery-check.json');
const crlf=texts.filter(p=>fs.readFileSync(p).includes(Buffer.from('\r\n')));
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const comparison=JSON.parse(fs.readFileSync(path.join(evidence,'tracked-comparison.json')));
const result={trackedComparison:comparison,reportCount:reports.length,kEntries:42,dEntries:27,missingK,missingD,missingReports,missingLinks,
  textFileCount:texts.length,crlfFiles:crlf,normalized,reportSha256:hash(report),
  scope:'Only new x-1 report, scripts/x1-*, and x-1-evidence; no existing tracked content changed; no baseline capture or commit',
  files:files.filter(p=>!p.endsWith('delivery-check.json')).map(p=>({file:path.relative(root,p).replaceAll('\\','/'),sha256:hash(p)}))};
fs.writeFileSync(path.join(evidence,'delivery-check.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({...result,files:result.files.length}));
if(missingK.length||missingD.length||missingReports.length||missingLinks.length||crlf.length||comparison.changed.length)process.exitCode=1;
