# Read-only concern check in an isolated source copy: inspect construction
# reservations, without changing selection, data, RNG or baseline fixtures.
from pathlib import Path
import shutil, subprocess, tempfile, json
root = Path(__file__).resolve().parents[3]
out = root / 'ai_docs/reports/x3a-evidence'
with tempfile.TemporaryDirectory(prefix='x3a-generation-roster-') as d:
 p = Path(d) / 'brogue-web'; p.mkdir()
 shutil.copytree(root/'src', p/'src')
 for name in ['package.json','package-lock.json','vite.config.ts','tsconfig.json','tsconfig.app.json','tsconfig.node.json']:
  shutil.copy2(root/name,p/name)
 for name in ['node_modules','ai_docs']:(p/name).symlink_to(root/name,target_is_directory=True)
 f=p/'src/engine/Core/GenerationCoordinator.ts';s=f.read_text();old='        const occupied = new Set(['
 assert s.count(old)==1
 probe='''        const completedDeaths = [...ports.monsters, ...ports.dormantMonsters].filter(m => m.deathProcessed);
        console.log('X3A_STAIR_ROSTER', ports.depth, ports.monsters.length, ports.dormantMonsters.length, completedDeaths.length);
        if (completedDeaths.length) throw new Error('Completed death in generation stair reservation');
'''
 f.write_text(s.replace(old,probe+old))
 with (out/'generation-roster-probe.txt').open('w') as log:
  r=subprocess.run(['npm','test','--','src/test/u_26a_deep_baseline.test.ts','--maxWorkers=1','--reporter=default','--reporter=json',f'--outputFile={out}/generation-roster-probe.json'],cwd=p,stdout=log,stderr=subprocess.STDOUT)
 text=(out/'generation-roster-probe.txt').read_text(); lines=[l for l in text.splitlines() if l.startswith('X3A_STAIR_ROSTER')]
 (out/'generation-roster-probe-summary.json').write_text(json.dumps({'exit':r.returncode,'observedStairTransactions':len(lines),'samples':lines,'scope':'Original U26a D1-40 baseline; non-reordering observation plus fail-on-completed-death. No general claim for arbitrary synthetic reservation inputs.'},indent=2)+'\n')
 print(r.returncode,len(lines));assert r.returncode==0
