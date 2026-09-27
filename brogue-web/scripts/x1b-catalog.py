import json, pathlib, re
root = pathlib.Path(__file__).resolve().parents[2]
out = root / 'brogue-web/ai_docs/reports/x-1b-evidence'
def read(p): return (root / p).read_text(encoding='utf-8-sig')
def write(n, v): (out / n).write_text(json.dumps(v, ensure_ascii=False, indent=2)+'\n', encoding='utf-8', newline='\n')
def split(s):
    parts=[]; level=0; start=0
    for i,c in enumerate(s):
        if c in '{(': level+=1
        if c in '})': level-=1
        if c==',' and level==0: parts.append(s[start:i].strip()); start=i+1
    if s[start:].strip(): parts.append(s[start:].strip())
    return parts
def val(s):
    s=s.replace('DEEPEST_LEVEL','40').replace('AMULET_LEVEL','26')
    if not re.fullmatch(r'[0-9 +\-]+',s): raise ValueError(s)
    return eval(s,{'__builtins__':{}})
ce=read('BrogueCE-master/src/variants/GlobalsBrogue.c')
ceglobals=read('BrogueCE-master/src/brogue/Globals.c')
header=read('BrogueCE-master/src/brogue/Rogue.h')
enum_body=header.split('enum monsterTypes {',1)[1].split('};',1)[0]
enum_names=re.findall(r'\bMK_\w+',re.sub(r'//[^\n]*|/\*.*?\*/','',enum_body,flags=re.S))
catalog_body=ceglobals.split('creatureType monsterCatalog[NUMBER_MONSTER_KINDS] = {',1)[1].split('\n};',1)[0]
display_names=re.findall(r'\{\s*0\s*,\s*"([^"]+)"',catalog_body)
assert len(enum_names)==len(display_names),(len(enum_names),len(display_names))
names={k:v.upper().replace(' ','_') for k,v in zip(enum_names,display_names)}
h=json.loads(read('brogue-web/src/data/hordes.json'))
horde_lines=[i for i,s in enumerate(read('brogue-web/src/data/hordes.json').splitlines(),1) if s=='  {']
mons=json.loads(read('brogue-web/src/data/monsters.json'))
rows=[]; in_table=False
for ln,line in enumerate(ce.splitlines(),1):
    if 'const hordeType hordeCatalog_Brogue[]' in line: in_table=True; continue
    if not in_table: continue
    if line.strip()=='};': break
    if not line.strip().startswith('{MK_'): continue
    raw=line.split('//')[0].strip().rstrip(',')
    f=split(raw[1:-1]); types=split(f[2][1:-1]); counts=split(f[3][1:-1])
    members=[{'type':names[types[i]],'minCount':int(split(counts[i][1:-1])[0]),'maxCount':int(split(counts[i][1:-1])[1]),'clump':int(split(counts[i][1:-1])[2])} for i in range(int(f[1]))]
    row={'index':len(rows),'ceLine':ln,'leader':names[f[0]],'members':members,'minLevel':val(f[4]),'maxLevel':val(f[5]),'frequency':int(f[6]),'spawnsIn':None if len(f)<8 or f[7]=='0' else f[7], 'flags':re.findall(r'HORDE_\w+',f[9]) if len(f)>9 else []}
    w=h[len(rows)]
    row['webLine']=horde_lines[len(rows)]
    row['webMatchesExceptClump']=all(row[k]==w[k] for k in ['leader','minLevel','maxLevel','frequency','spawnsIn','flags']) and [{k:v for k,v in m.items() if k!='clump'} for m in members]==w['members']
    row['webMissingSpecies']=[s for s in [row['leader']]+[m['type'] for m in members] if s.lower() not in {m['id'] for m in mons}]
    rows.append(row)
deep=[r for r in rows if r['minLevel']>26]
early={s for r in rows if 0<r['minLevel']<=26 for s in [r['leader']]+[m['type'] for m in r['members']]}
new={s for r in deep for s in [r['leader']]+[m['type'] for m in r['members']]}
bp=json.loads(read('brogue-web/src/data/blueprints.json'))
# Blueprint depth lines are unique top-level starts inside this array.
bpstart=ce.index('blueprintCatalog_Brogue')
bpend=ce.index('\n};',bpstart)
cebp=[]
for ln,line in enumerate(ce[:bpend].splitlines(),1):
    if ln < ce[:bpstart].count('\n')+1: continue
    m=re.match(r'\s*\{(\d+),\s*([\w\-]+)\},',line)
    if m: cebp.append({'ceBlueprintId':len(cebp)+1,'ceLine':ln,'depthRange':[int(m[1]),val(m[2])]})
bp_deep=[]
for row in cebp:
    if row['depthRange'][1]<27: continue
    matches=[b for b in bp if b.get('ceBlueprintId')==row['ceBlueprintId']]
    bp_deep.append({**row,'web':[{'id':b['id'],'line':next(i for i,s in enumerate(read('brogue-web/src/data/blueprints.json').splitlines(),1) if '"id": "'+b['id']+'"' in s),'depthRange':b['depthRange'],'frequency':b['frequency'],'matches':b['depthRange']==row['depthRange']} for b in matches]})
write('catalog.json',{'hordeCountCE':len(rows),'hordeCountWeb':len(h),'deepOnlyHordes':deep,'newDeepOnlySpecies':sorted(new-early),'hordeFieldMismatchIndices':[r['index'] for r in rows if not r['webMatchesExceptClump']], 'deepMissingSpecies':[r for r in deep if r['webMissingSpecies']], 'ceBlueprintCount':len(cebp),'deepEligibleBlueprints':bp_deep,'ceDeepOnlyBlueprints':[r for r in cebp if r['depthRange'][0]>26], 'webDeepOnlyBlueprints':[{'id':b['id'],'ceBlueprintId':b.get('ceBlueprintId'),'depthRange':b['depthRange']} for b in bp if b['depthRange'][0]>26]})
reports=[]
pattern=re.compile(r'D27|D40|深层|OOS|clump|随从数量|未核实|待.*复核',re.I)
for p in sorted((root/'brogue-web/ai_docs/reports').glob('*.report.md')):
    if p.name.startswith('x2') or p.name in ['x-0-survey.report.md','x-1-survey.report.md','u-26a.report.md','u-26b.report.md','u-27.report.md']:
        reports.extend({'file':p.name,'line':i,'text':s} for i,s in enumerate(p.read_text(encoding='utf-8-sig').splitlines(),1) if pattern.search(s))
write('report-boundaries.json',reports)
print(json.dumps({'hordes':len(rows),'deepHordes':len(deep),'missingDeepSpecies':len(new-early),'blueprints':len(cebp),'deepEligibleBlueprints':len(bp_deep),'reportLines':len(reports)}))
