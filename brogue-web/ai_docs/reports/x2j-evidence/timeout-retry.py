from pathlib import Path
import subprocess, json, hashlib, time, datetime, re
root=Path('/Users/coolking70/.codex/worktrees/4c55/brogue/brogue-web')
out=root/'ai_docs/reports/x2j-evidence'
summary=out/'full-final-summary.json'
print('Waiting for full-final to complete before retrying timeout files.', flush=True)
while not summary.exists(): time.sleep(5)
full=json.loads(summary.read_text())
failed=full.get('failures', [])
# Vitest JSON contains STACK_TRACE_ERROR here; the default reporter preserves the timeout reason.
plain=re.sub(r'\x1b\[[0-9;]*m','',(out/'full-final.txt').read_text())
def is_timeout(f):
 rel=str(Path(f['file']).relative_to(root))
 return bool(re.search(r'FAIL\s+'+re.escape(rel)+r'\s*>[^\n]*\nError: Test timed out in 900000ms\.',plain))
timeouts=[f for f in failed if is_timeout(f)]
files=sorted(set(str(Path(f['file']).relative_to(root)) for f in timeouts))
if not files:
 print('No timeout failures; no retry.', flush=True)
 raise SystemExit(0)
original=json.loads((out/'full-final-inputs.json').read_text())
def hashes(): return {f:hashlib.sha256((root/f).read_bytes()).hexdigest() for f in original}
before=hashes()
changed=[f for f in original if before[f]!=original[f]]
if changed: raise RuntimeError('Frozen inputs changed: '+str(changed))
args=['npm','test','--',*files,'--maxWorkers=2','--reporter=default','--reporter=json','--outputFile=ai_docs/reports/x2j-evidence/timeout-retry.json']
print('Retrying '+', '.join(files)+' with original assertion timeouts.', flush=True)
start=time.time()
with (out/'timeout-retry.txt').open('w') as log:
 result=subprocess.run(args,cwd=root,stdout=log,stderr=subprocess.STDOUT)
after=hashes()
r=json.loads((out/'timeout-retry.json').read_text())
record={'command':args,'start':datetime.datetime.fromtimestamp(start,datetime.timezone.utc).isoformat(),'seconds':time.time()-start,'exit':result.returncode,'inputs':len(before),'changedFromFull':changed,'changedInputs':[f for f in before if before[f]!=after[f]],'files':len(r['testResults']),'passed':r['numPassedTests'],'failed':r['numFailedTests'],'pending':r['numPendingTests'],'todo':r['numTodoTests'],'classificationEvidence':'full-final.txt default reporter: Error: Test timed out in 900000ms. (JSON failureMessages contain only STACK_TRACE_ERROR)','retriedFullFailures':[f['name'] for f in timeouts],'nonTimeoutFullFailures':[f for f in failed if f not in timeouts],'failures':[{'file':t['name'],'name':a['fullName'],'messages':a['failureMessages']} for t in r['testResults'] for a in t['assertionResults'] if a['status']=='failed']}
(out/'timeout-retry-summary.json').write_text(json.dumps(record,indent=2,ensure_ascii=False)+'\n')
print(json.dumps(record,indent=2,ensure_ascii=False),flush=True)
raise SystemExit(result.returncode)
