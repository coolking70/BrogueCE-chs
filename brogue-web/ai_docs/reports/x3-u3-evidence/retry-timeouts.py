from pathlib import Path
import subprocess,json,time,datetime,hashlib,re
out=Path('ai_docs/reports/x3-u3-evidence')
full=json.loads((out/'full-results.json').read_text())
manifest=json.loads((out/'gate-inputs.json').read_text())
def changed(): return [p for p,h in manifest.items() if hashlib.sha256(Path(p).read_bytes()).hexdigest()!=h]
assert not changed()
proof=json.loads((out/'w6-counterfactual-summary.json').read_text())
assert [(r['variant'],r['failedTests']) for r in proof]==[('current',1),('old-removal',0),('explicit-removable',0)]
log=(out/'full.txt').read_text()
# Vitest's JSON stores STACK_TRACE_ERROR; the default reporter retains the real reason and original limit.
timeouts={heading.split(' > ')[0]:int(limit) for heading,limit in re.findall(r'\n FAIL  ([^\n]+)\nError: Test timed out in (\d+)ms\.',log)}
failed=[r for r in full['testResults'] if r['status']=='failed']
fixture='src/test/w_6_arcana_recharge.test.ts'
expected={str(Path(r['name']).relative_to(Path.cwd())) for r in failed}-{fixture}
assert set(timeouts)==expected, {'timeouts':timeouts,'otherFailedFiles':expected-set(timeouts)}
results=[]
for i,suite in enumerate(r for r in failed if str(Path(r['name']).relative_to(Path.cwd()))!=fixture):
 name=str(Path(suite['name']).relative_to(Path.cwd()));limit=timeouts[name]
 failures=[t for t in suite['assertionResults'] if t['status']=='failed']
 assert failures and all(t['duration']>=limit for t in failures), suite['name']
 output=out/f'timeout-retry-{i+1}.json'
 cmd=['npx','vitest','run',name,'--maxWorkers=1','--reporter=default','--reporter=json','--outputFile.json='+str(output)]
 started=time.time()
 with (out/f'timeout-retry-{i+1}.txt').open('w') as target:
  run=subprocess.run(cmd,stdout=target,stderr=subprocess.STDOUT)
 data=json.loads(output.read_text()) if output.exists() else None
 row={'file':name,'command':cmd,'originalError':f'Test timed out in {limit}ms. (full.txt)','originalLimitMs':limit,'originalFailures':[{'name':t['fullName'],'duration':t['duration']} for t in failures],'exit':run.returncode,'seconds':round(time.time()-started,3),'started':datetime.datetime.fromtimestamp(started).astimezone().isoformat(),'finished':datetime.datetime.now().astimezone().isoformat(),'passedTests':data['numPassedTests'] if data else None,'failedTests':data['numFailedTests'] if data else None,'changedInputs':changed()}
 results.append(row);(out/'timeout-retry-summary.json').write_text(json.dumps(results,indent=2)+'\n');print(json.dumps(row),flush=True)
 assert not changed()
assert all(r['exit']==0 and r['failedTests']==0 for r in results), results
