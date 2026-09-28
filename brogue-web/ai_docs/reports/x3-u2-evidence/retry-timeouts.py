from pathlib import Path
import subprocess,json,time,datetime,hashlib,re
out=Path('ai_docs/reports/x3-u2-evidence')
full=json.loads((out/'full-results.json').read_text())
manifest=json.loads((out/'gate-inputs.json').read_text())
def changed(): return [p for p,h in manifest.items() if hashlib.sha256(Path(p).read_bytes()).hexdigest()!=h]
assert not changed()
failed=[r for r in full['testResults'] if r['status']=='failed']
assert failed
# Vitest JSON preserves STACK_TRACE_ERROR, while the default reporter retains the timeout reason.
log=(out/'full.txt').read_text()
assert len(re.findall(r'Error: Test timed out in 900000ms\.', log)) == full['numFailedTests']
results=[]
for i,suite in enumerate(failed):
 failures=[t for t in suite['assertionResults'] if t['status']=='failed']
 assert failures and all(t['duration'] >= 900000 for t in failures), suite['name']
 assert ' FAIL  '+str(Path(suite['name']).relative_to(Path.cwd()))+' >' in log
 name=str(Path(suite['name']).relative_to(Path.cwd()))
 output=out/f'timeout-retry-{i+1}.json'
 cmd=['npx','vitest','run',name,'--maxWorkers=1','--reporter=default','--reporter=json','--outputFile.json='+str(output)]
 started=time.time()
 with (out/f'timeout-retry-{i+1}.txt').open('w') as log:
  run=subprocess.run(cmd,stdout=log,stderr=subprocess.STDOUT)
 data=json.loads(output.read_text()) if output.exists() else None
 row={'file':name,'command':cmd,'originalError':'Test timed out in 900000ms. (full.txt)', 'originalFailures':[{'name':t['fullName'],'messages':t['failureMessages'],'duration':t['duration']} for t in failures],'exit':run.returncode,'seconds':round(time.time()-started,3),'started':datetime.datetime.fromtimestamp(started).astimezone().isoformat(),'finished':datetime.datetime.now().astimezone().isoformat(),'passedTests':data['numPassedTests'] if data else None,'failedTests':data['numFailedTests'] if data else None,'changedInputs':changed()}
 results.append(row); (out/'timeout-retry-summary.json').write_text(json.dumps(results,indent=2)+'\n'); print(json.dumps(row),flush=True)
 assert run.returncode==0 and data['numFailedTests']==0 and not changed()
