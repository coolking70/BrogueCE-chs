import json,sys,urllib.request,ssl,datetime
ctx=ssl.create_default_context(); ctx.check_hostname=False; ctx.verify_mode=ssl.CERT_NONE
d=json.load(urllib.request.urlopen("https://localhost:8443/api/state",context=ctx,timeout=10))
now=d.get("now") or datetime.datetime.now().timestamp()
for v in d.get("sessions",[]):
    st,tool=v.get("status","?"),v.get("tool","?")
    el=int(now-(v.get("started_at") or now)); idle=int(now-(v.get("updated_at") or now))
    mark={"running":"▶","done":"✓"}.get(st,"·")
    print(f"{mark} {tool:12s} {st:8s} 已跑 {el//60:>3d}m{el%60:02d}s  静默 {idle:>4d}s")
    if v.get("title"): print(f"    题：{v['title'][:70]}")
    if v.get("model"):  print(f"    模：{v['model']}")
    if v.get("detail"): print(f"    详：{v['detail'][:90]}")
