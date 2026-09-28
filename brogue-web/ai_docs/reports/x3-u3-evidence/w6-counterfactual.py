from pathlib import Path
import subprocess,shutil,json,time,difflib,hashlib
root=Path.cwd().resolve();out=root/'ai_docs/reports/x3-u3-evidence'
probe=Path('/private/tmp/x3-u3-w6-counterfactual')
probe.mkdir(exist_ok=True)
shutil.copytree(root/'src',probe/'src',dirs_exist_ok=True)
for name in ['package.json','vite.config.ts','tsconfig.json','tsconfig.app.json','tsconfig.node.json']:
 shutil.copy2(root/name,probe/name)
if not (probe/'node_modules').exists():(probe/'node_modules').symlink_to(root/'node_modules',target_is_directory=True)
config=probe/'vite.config.ts'
config.write_text(config.read_text().replace('export default defineConfig({',"export default defineConfig({\n  cacheDir: '/private/tmp/x3-u3-w6-cache',"))
player=probe/'src/entities/Player.ts';test=probe/'src/test/w_6_arcana_recharge.test.ts'
playerOriginal=player.read_text();testOriginal=test.read_text()
# Reconstruct the original fixture when reproducing after the accepted one-line correction.
testOriginal=testOriginal.replace('        a.isCursed = false; // Wisdom removal fixture must be removable.\n','')
manifest=json.loads((out/'gate-inputs.json').read_text())
assert hashlib.sha256(testOriginal.encode()).hexdigest()==manifest['src/test/w_6_arcana_recharge.test.ts']
diagnostic="        console.log('[X3-U3 W6 fixture]', JSON.stringify({ enchantment: a.enchantment, isCursed: a.isCursed, identified: a.identified }));\n"
assert testOriginal.count('        game.player.unequip(a);')==1
instrumented=testOriginal.replace('        game.player.unequip(a);',diagnostic+'        game.player.unequip(a);')
guard='if (!equipped || (item.isCursed && !force)) return false;'
assert playerOriginal.count(guard)==1
premise='        const a = ring(4), b = ring(-2, false), spare = ring(27);'
assert instrumented.count(premise)==1
(out/'w6-old-removal.diff.txt').write_text(''.join(difflib.unified_diff(playerOriginal.splitlines(True),playerOriginal.replace(guard,'if (!equipped) return false;').splitlines(True),fromfile='current/Player.ts',tofile='old-removal/Player.ts')))
fixedTest=testOriginal.replace(premise,premise+'\n        a.isCursed = false; // Wisdom removal fixture must be removable.')
(out/'w6-fixture-only.diff.txt').write_text(''.join(difflib.unified_diff(testOriginal.splitlines(True),fixedTest.splitlines(True),fromfile='current/w_6_arcana_recharge.test.ts',tofile='explicit-removable/w_6_arcana_recharge.test.ts')))
results=[]
for name,code,fixture in [
 ('current',playerOriginal,instrumented),
 ('old-removal',playerOriginal.replace(guard,'if (!equipped) return false;'),instrumented),
 ('explicit-removable',playerOriginal,instrumented.replace(premise,premise+'\n        a.isCursed = false; // Wisdom removal fixture must be removable.')),
]:
 player.write_text(code);test.write_text(fixture)
 cmd=['npx','vitest','run','src/test/w_6_arcana_recharge.test.ts','--maxWorkers=1','--reporter=default','--reporter=json','--outputFile.json='+str(out/f'w6-{name}.json')]
 start=time.time()
 with (out/f'w6-{name}.txt').open('w') as log:run=subprocess.run(cmd,cwd=probe,stdout=log,stderr=subprocess.STDOUT)
 data=json.loads((out/f'w6-{name}.json').read_text())
 row={'variant':name,'exit':run.returncode,'seconds':round(time.time()-start,3),'passedTests':data['numPassedTests'],'failedTests':data['numFailedTests'],'diagnostic':[line for line in (out/f'w6-{name}.txt').read_text().splitlines() if '[X3-U3 W6 fixture]' in line]}
 results.append(row);(out/'w6-counterfactual-summary.json').write_text(json.dumps(results,indent=2)+'\n');print(json.dumps(row),flush=True)
 assert data['numFailedTests']==(1 if name=='current' else 0), row
player.write_text(playerOriginal);test.write_text(testOriginal)
