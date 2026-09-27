from pathlib import Path
import json, shutil, subprocess, time
root=Path.cwd();out=root/'ai_docs/reports/x2k-evidence';tmp=Path('/private/tmp/x2k-negative');tmp.mkdir(exist_ok=True)
for name in ['src']:
 shutil.copytree(root/name,tmp/name,dirs_exist_ok=True)
for name in ['package.json','package-lock.json','vite.config.ts','tsconfig.json','tsconfig.app.json','tsconfig.node.json']:shutil.copy2(root/name,tmp/name)
for name in ['node_modules','ai_docs']:
 if not (tmp/name).exists():(tmp/name).symlink_to(root/name,target_is_directory=True)
mutants=[
 ('restored_df','src/entities/Monster.ts',"        this.deathDFType = form.id === 'vampire' ? 36 /* DF_BLOOD_EXPLOSION */ : 0;",'        // omit catalog DF reset','restored vampire info'),
 ('deferred','src/entities/Monster.ts','        notifyMonsterDeath(this);','        // deferred death','drops before the DF'),
 ('drop_order','src/engine/Core/Game.ts','            this.makeMonsterDropItem(m);\n            this.triggerDeathFeatures(m);','            this.triggerDeathFeatures(m);\n            this.makeMonsterDropItem(m);','drops before the DF'),
 ('dying_occupancy','src/engine/Core/Game.ts','(m.hp > 0 || (dyingMonsters.has(m) && !m.deathProcessed))','m.hp > 0','drops before the DF'),
 ('falling_df','src/engine/Core/Game.ts','if (m.hp > 0 || m.falling || m.administrativeDeath) continue;','if (m.hp > 0) continue;','falling suppresses DF'),
 ('administrative','src/engine/Core/Game.ts','if (administrative) {','if (false) {','silent administrative death'),
 ('corner','src/engine/Movement/CreaturePlacement.ts','costs[x]![y] = -2;','costs[x]![y] = -1;','original C'),
 ('power','src/engine/Core/Game.ts','b.totalPowerCount - a.totalPowerCount','a.totalPowerCount - b.totalPowerCount','selects highest power'),
 ('catalog','src/engine/Core/Game.ts',"form?.abilityFlags?.includes('MA_ENTER_SUMMONS')","form && candidate.hasAbility('MA_ENTER_SUMMONS')",'catalog ENTER_SUMMONS'),
 ('rebind','src/engine/Core/MonsterLifecycle.ts','for (const monster of raw) owners.set(monster, owner);','// omit existing entries on restore','binds restored monsters')]
rows=[]
for name,file,old,new,test in mutants:
 p=tmp/file;original=p.read_text();assert old in original,(name,file);p.write_text(original.replace(old,new,1))
 start=time.time()
 try:
  with (out/f'negative-{name}.txt').open('w') as log:
   r=subprocess.run(['npm','test','--','src/test/x2k_lifecycle.test.ts','--testNamePattern',test,'--maxWorkers=1','--reporter=json',f'--outputFile={out}/negative-{name}.json'],cwd=tmp,stdout=log,stderr=subprocess.STDOUT)
  data=json.loads((out/f'negative-{name}.json').read_text());rows.append({'name':name,'exit':r.returncode,'failed':data['numFailedTests'],'seconds':time.time()-start})
 finally:p.write_text(original)
(out/'negative-summary.json').write_text(json.dumps(rows,indent=2)+'\n');print(json.dumps(rows,indent=2));assert all(r['exit']!=0 and r['failed']>0 for r in rows)
