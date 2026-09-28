from pathlib import Path
import subprocess,json,time,datetime,hashlib
out=Path('ai_docs/reports/x3-u3-evidence')
manifest=json.loads((out/'gate-inputs.json').read_text())
before={p:hashlib.sha256(Path(p).read_bytes()).hexdigest() for p in manifest}
steps=[('types-final',['npx','vue-tsc','-b']),('build-final',['npm','run','build']),('focused-final',['npx','vitest','run','src/test/x3_u3_cursed_equipment.test.ts','src/test/w_6_arcana_recharge.test.ts','--maxWorkers=1','--reporter=default','--reporter=json','--outputFile.json='+str(out/'focused-final.json')])]
results=[]
for name,cmd in steps:
 started=time.time()
 with (out/(name+'.txt')).open('w') as log:r=subprocess.run(cmd,stdout=log,stderr=subprocess.STDOUT)
 row={'name':name,'command':cmd,'exit':r.returncode,'seconds':round(time.time()-started,3),'started':datetime.datetime.fromtimestamp(started).astimezone().isoformat(),'finished':datetime.datetime.now().astimezone().isoformat()}
 results.append(row);(out/'final-gate-summary.json').write_text(json.dumps(results,indent=2)+'\n');print(json.dumps(row),flush=True)
 if r.returncode:raise SystemExit(r.returncode)
changed=[p for p,h in before.items() if hashlib.sha256(Path(p).read_bytes()).hexdigest()!=h]
(out/'final-gate-input-check.json').write_text(json.dumps({'count':len(before),'changed':changed},indent=2)+'\n')
assert not changed
