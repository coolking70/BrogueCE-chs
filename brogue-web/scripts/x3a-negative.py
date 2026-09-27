"""Mutations run only in an isolated temporary source copy; existing guards stay intact."""
from pathlib import Path
import json, shutil, subprocess, tempfile
root = Path(__file__).resolve().parents[1]
out = root / 'ai_docs/reports/x3a-evidence'
mutants = [
 ('dead-activation', 'src/engine/Core/Game.ts', 'for (const monst of iterateCreatures([...this.dormantMonsters]))', 'for (const monst of [...this.dormantMonsters])', 'DF activation'),
 ('cached-visible', 'src/engine/Core/Game.ts', 'for (const m of iterateCreatures(this.visibleMonsters))', 'for (const m of this.visibleMonsters)', 'auto-explore does not'),
 ('cached-step', 'src/engine/Core/Game.ts', '            for (const m of iterateCreatures(this.visibleMonsters))', '            for (const m of this.visibleMonsters)', 'stale visible corpse'),
 ('cached-attack', 'src/engine/Core/Game.ts', 'Array.from(iterateCreatures(this.visibleMonsters))', 'Array.from(this.visibleMonsters)', 'auto-explore does not'),
 ('fear-roster', 'src/engine/Combat/MonsterAI.ts', '[g.player, ...iterateCreatures(g.monsters)]', '[g.player, ...g.monsters]', 'seed22013'),
 ('no-death-filter', 'src/engine/Core/MonsterLifecycle.ts', 'if (!creature.deathProcessed) yield creature;', 'yield creature;', 'original CE iterator|seed22013|dying DF'),
 ('hp-is-death', 'src/engine/Core/MonsterLifecycle.ts', 'if (!creature.deathProcessed) yield creature;', 'if (creature.hp > 0) yield creature;', 'original CE iterator|dying DF'),
 ('eager-filter', 'src/engine/Core/MonsterLifecycle.ts', 'for (const creature of creatures) {\n        if (!creature.deathProcessed) yield creature;', 'for (const creature of [...creatures].filter(c => !c.deathProcessed)) {\n        yield creature;', 'checks later members'),
 ('dead-follower', 'src/engine/Combat/MonsterBlink.ts', '[...iterateCreatures(g.monsters)].some(other => other.leader === m)', 'g.monsters.some(other => other.leader === m)', 'dead final follower'),
 ('dead-dormant', 'src/engine/Core/Game.ts', 'for (const follower of iterateCreatures(dormant))', 'for (const follower of dormant)', 'demotion skips'),
 ('dead-captive', 'src/engine/Core/Game.ts', 'if (isCage) for (const m of iterateCreatures(this.monsters))', 'if (isCage) for (const m of this.monsters)', 'opening a cage'),
]
rows = []
with tempfile.TemporaryDirectory(prefix='x3a-negative-') as stage:
 tmp = Path(stage) / 'brogue-web'; tmp.mkdir()
 shutil.copytree(root / 'src', tmp / 'src')
 for name in ['package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json']:
  shutil.copy2(root / name, tmp / name)
 for name in ['node_modules', 'ai_docs']:
  (tmp / name).symlink_to(root / name, target_is_directory=True)
 for name, file, old, new, test in mutants:
  p = tmp / file; original = p.read_text(); assert old in original, name
  p.write_text(original.replace(old, new, 1))
  try:
   with (out / f'negative-{name}.txt').open('w') as log:
    run = subprocess.run(['npm', 'test', '--', 'src/test/x3a_live_iteration.test.ts', '--testNamePattern', test,
       '--maxWorkers=1', '--reporter=default', '--reporter=json', f'--outputFile={out}/negative-{name}.json'], cwd=tmp, stdout=log, stderr=subprocess.STDOUT)
   result = json.loads((out / f'negative-{name}.json').read_text())
   rows.append({'name':name, 'file':file, 'old':old, 'new':new, 'exit':run.returncode, 'failed':result['numFailedTests']})
  finally:
   p.write_text(original)
(out / 'negative-summary.json').write_text(json.dumps(rows, indent=2) + '\n')
print(json.dumps(rows, indent=2)); assert all(r['exit'] and r['failed'] for r in rows)
