import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
const root = path.resolve(import.meta.dirname, '..');
const target = fs.mkdtempSync(path.join(os.tmpdir(), 'brogue-x1-'));
const project = path.join(target, 'brogue-web');
fs.mkdirSync(project);
for (const name of ['src', 'public', 'scripts', 'node_modules', 'ai_docs', 'package.json', 'package-lock.json', 'index.html', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json', 'vite.config.ts']) {
  fs.cpSync(path.join(root, name), path.join(project, name), { recursive: true, filter: source => !source.replaceAll('\\', '/').includes('/x-1-evidence') });
}
fs.cpSync(path.join(root, '../BrogueCE-master'), path.join(target, 'BrogueCE-master'), { recursive: true });
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
const hash = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const inputs = walk(path.join(root, 'src')).concat(walk(path.join(root, 'public')), ['package.json','package-lock.json','index.html','tsconfig.json','tsconfig.app.json','tsconfig.node.json','vite.config.ts'].map(n=>path.join(root,n)));
const differences = inputs.filter(p => hash(p) !== hash(path.join(project, path.relative(root,p)))).map(p=>path.relative(root,p));
fs.writeFileSync(path.join(root, 'ai_docs/reports/x-1-evidence/validation-stage.json'), JSON.stringify({ project, inputCount: inputs.length, differences, createdAt: new Date().toISOString() }, null, 2)+'\n');
console.log(project);
