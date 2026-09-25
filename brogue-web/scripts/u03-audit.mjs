import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
const dir = 'ai_docs/reports/u-03-evidence';
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const changed = execFileSync('git',['diff','HEAD','--name-only','--relative'],{encoding:'utf8'}).trim().split('\n').filter(Boolean);
const protectedChanges = changed.filter(f => /\.test\.ts$|fixtures\/|^public\/|^src\/data\/|package.*json$|vite\.config|tsconfig/.test(f));
assert.deepEqual(protectedChanges, []);
assert.equal(execFileSync('git',['diff','HEAD','--','../BrogueCE-master'],{encoding:'utf8'}), '');
const fieldTables = {};
for (const file of ['src/engine/Core/Game.ts','src/engine/Core/LevelSnapshot.ts','src/engine/Core/EntitySnapshot.ts']) {
    const source = ts.createSourceFile(file, fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);
    for(const n of source.statements) {
        if(ts.isInterfaceDeclaration(n) && /Snapshot/.test(n.name.text)) fieldTables[n.name.text]=n.members.map(m=>m.name?.getText(source)).filter(Boolean);
        if(ts.isVariableStatement(n)) for(const d of n.declarationList.declarations) if(/_FIELDS$/.test(d.name.getText(source)))fieldTables[d.name.getText(source)]=d.initializer.getText(source);
        if(ts.isClassDeclaration(n)&&n.name.text==='Game') {
            const method=n.members.find(m=>m.name?.getText(source)==='snapshotRunState');
            const decl=method.body.statements.find(ts.isVariableStatement).declarationList.declarations[0];
            fieldTables.run=decl.initializer.properties.map(p=>p.name.getText(source));
            const fields=n.members.filter(ts.isPropertyDeclaration).filter(p=>!p.modifiers?.some(m=>m.kind===ts.SyntaxKind.StaticKeyword)).map(p=>p.name.getText(source)).sort();
            const contract=JSON.parse(fs.readFileSync('scripts/u03-state-contract.json'));
            assert.deepEqual(Object.keys(contract).sort(),fields);
            fieldTables.GameInstanceFieldCount=fields.length;
        }
    }
}
fs.writeFileSync(`${dir}/schema-fields.json`,JSON.stringify(fieldTables,null,2)+'\n');
const baseline='src/test/fixtures/generation_baseline.json';
const oldBaseline=execFileSync('git',['show',`HEAD:brogue-web/${baseline}`]);
assert.equal(hash(fs.readFileSync(baseline)),hash(oldBaseline));
const testFiles=execFileSync('git',['ls-files','src'],{encoding:'utf8'}).trim().split('\n').filter(f=>f.endsWith('.test.ts'));
const output={changed,protectedChanges,existingTestsUnchanged:testFiles.length,baselineSHA256:hash(oldBaseline),
    schemaInventorySHA256:hash(fs.readFileSync(`${dir}/schema-fields.json`)),
    ce:Object.fromEntries(['RogueMain.c','Time.c','Architect.c','Monsters.c','Rogue.h'].map(name=>[name,hash(fs.readFileSync(`../BrogueCE-master/src/brogue/${name}`))]))};
fs.writeFileSync(`${dir}/audit.json`,JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify(output,null,2));
