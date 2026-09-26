import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '..');
const repo = path.resolve(root, '..');
const evidence = path.join(root, 'ai_docs/reports/x-1-evidence');
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const write = (name, value) => { fs.mkdirSync(evidence, { recursive: true }); fs.writeFileSync(path.join(evidence, name), JSON.stringify(value, null, 2) + '\n'); };
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
const rel = p => path.relative(root, p).replaceAll('\\', '/');
const mode = process.argv[2];
if (mode === 'digest') {
  for (const file of ['targeted-results.json','extra-results.json']) {
    const r=JSON.parse(fs.readFileSync(path.join(evidence,file))); console.log(JSON.stringify({file,files:r.testResults.length,passed:r.numPassedTests,failed:r.numFailedTests,pending:r.numPendingTests}));
  }
  const r=JSON.parse(fs.readFileSync(path.join(evidence,'runtime-observations.json')));
  console.log(JSON.stringify({retiredBlueprints:r.retiredBlueprints,charmKinds:r.charmKinds,charmDetails:r.charmDetails}));
  const files=fs.readdirSync(path.join(root,'ai_docs/reports')).filter(n=>/^u-.*\.report\.md$/.test(n));
  for(const f of files){const lines=fs.readFileSync(path.join(root,'ai_docs/reports',f),'utf8').split(/\r?\n/);console.log(f+': '+lines.flatMap((s,i)=>/^#{1,3} .*边界|^#{1,3} .*保留|^#{1,3} .*限制|^#{1,3} .*遗留/.test(s)?[`${i+1} ${s}`]:[]).join('; '));}
}
if (mode === 'before' || mode === 'after') {
  const files = JSON.parse(fs.readFileSync(path.join(evidence, 'tracked-files.json'), 'utf8'));
  const hashes = Object.fromEntries(files.map(f => [f, fs.existsSync(path.join(repo, f)) ? hash(fs.readFileSync(path.join(repo, f))) : null]));
  write(`tracked-${mode}.json`, hashes);
  if (mode === 'after') {
    const before = JSON.parse(fs.readFileSync(path.join(evidence, 'tracked-before.json')));
    const changed = Object.keys(before).filter(f => before[f] !== hashes[f]);
    write('tracked-comparison.json', { count: files.length, changed });
    console.log(JSON.stringify({ count: files.length, changed }));
  } else console.log(`Captured ${files.length} tracked files`);
}
if (mode === 'inventory') {
  const reports = walk(path.join(root, 'ai_docs/reports')).filter(p => /[/\\]u-[^/\\]+\.report\.md$/.test(p));
  const boundaries = reports.map(p => {
    const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);
    return { file: rel(p), lines: lines.flatMap((text, i) => /保留|不在本轮|未完成|未闭合|未核实|下一轮|后续|边界|暂不|不覆盖|未实现|延后|未承接/.test(text) ? [{ line: i + 1, text }] : []) };
  });
  write('report-boundaries.json', boundaries);
  const symbols = [];
  for (const p of walk(path.join(root, 'src')).filter(p => p.endsWith('.ts') && !p.endsWith('.test.ts'))) {
    const source = ts.createSourceFile(p, fs.readFileSync(p, 'utf8'), ts.ScriptTarget.Latest, true);
    const visit = node => {
      if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isClassDeclaration(node)) && node.name) symbols.push({ file: rel(p), name: node.name.getText(source), start: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, end: source.getLineAndCharacterOfPosition(node.end).line + 1 });
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  write('symbols.json', symbols);
  console.log(JSON.stringify({ reports: reports.length, boundaryLines: boundaries.reduce((n, r) => n + r.lines.length, 0), symbols: symbols.length }));
}
if (mode === 'read') {
  const file = process.argv[3], start = Number(process.argv[4] || 1), end = Number(process.argv[5] || 999999);
  const lines = fs.readFileSync(path.resolve(root, file), 'utf8').split(/\r?\n/);
  console.log(lines.slice(start - 1, end).map((s, i) => `${start + i}: ${s}`).join('\n'));
}
if (mode === 'search') {
  const re = new RegExp(process.argv[3], 'i');
  const dir = path.resolve(root, process.argv[4] || 'src');
  const files = fs.statSync(dir).isFile() ? [dir] : walk(dir);
  for (const p of files.filter(p => /\.(ts|vue|json|md|c|h)$/.test(p))) {
    const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) if (re.test(lines[i])) console.log(`${rel(p)}:${i + 1}: ${lines[i]}`);
  }
}
if (mode === 'boundaries') {
  const reports = JSON.parse(fs.readFileSync(path.join(evidence, 'report-boundaries.json')));
  for (const report of reports.filter(r => new RegExp(process.argv[3] || '.').test(r.file))) console.log(report.file + '\n' + report.lines.map(l => `${l.line}: ${l.text}`).join('\n'));
}
if (mode === 'symbols') {
  const symbols = JSON.parse(fs.readFileSync(path.join(evidence, 'symbols.json')));
  for (const s of symbols.filter(s=>new RegExp(process.argv[3] || '.', 'i').test(s.name) && new RegExp(process.argv[4] || '.').test(s.file))) console.log(`${s.file}:${s.start}-${s.end} ${s.name}`);
}
if (mode === 'scopes') {
  const files = fs.readdirSync(path.join(root,'ai_docs/reports')).filter(n=>/^u-.*\.report\.md$/.test(n) && new RegExp(process.argv[3] || '.').test(n));
  for(const file of files) {
    const lines=fs.readFileSync(path.join(root,'ai_docs/reports',file),'utf8').split(/\r?\n/);
    console.log(file);
    let active=false;
    lines.forEach((line,i)=>{ if (/^#{1,3} /.test(line)) active=/边界|后续|限制|新发现|遗留|范围自检/.test(line); if(active) console.log(`${i+1}: ${line}`); });
  }
}
if (mode === 'guards') {
  const files=walk(path.join(root,'src')).filter(p=>p.endsWith('.test.ts') && new RegExp(process.argv[3]||'.').test(rel(p)));
  const results=[];
  for(const file of files) {
    const src=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);
    const cases=[];
    const visit=node=>{
      if(ts.isCallExpression(node) && /^(it|test)(\.(each|skip|todo))?$/.test(node.expression.getText(src)) && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) {
        const assertions=[];
        const scan=n=>{if(ts.isCallExpression(n) && /^expect\(/.test(n.getText(src)) && ts.isPropertyAccessExpression(n.expression)) assertions.push({line:src.getLineAndCharacterOfPosition(n.getStart(src)).line+1,text:n.getText(src).replace(/\s+/g,' ')}); ts.forEachChild(n,scan);};
        ts.forEachChild(node,scan);
        cases.push({name:node.arguments[0].text,line:src.getLineAndCharacterOfPosition(node.getStart(src)).line+1,assertions});
      }
      ts.forEachChild(node,visit);
    };
    visit(src);
    results.push({file:rel(file),cases});
  }
  write('guard-review-'+(process.argv[5]||'latest')+'.json',results);
  for(const r of results) { console.log(r.file); for(const c of r.cases.filter(c=>new RegExp(process.argv[4]||'.','i').test(c.name)).slice(0,Number(process.argv[6]||1))) console.log(`${c.line}: ${c.name}\n`+c.assertions.map(a=>`${a.line}: ${a.text}`).join('\n')); }
}
