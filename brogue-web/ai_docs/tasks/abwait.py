import json,ssl,time,urllib.request,datetime,sys
ctx=ssl.create_default_context(); ctx.check_hostname=False; ctx.verify_mode=ssl.CERT_NONE
URL="https://localhost:8443/api/state"
MAX_MIN=120; INTERVAL=30
def snap():
    try:
        d=json.load(urllib.request.urlopen(URL,context=ctx,timeout=10))
    except Exception as e:
        return None,f"接口不可达: {type(e).__name__}"
    for v in d.get("sessions",[]):
        if v.get("tool")=="ZCode": return v,None
    return None,"未发现 ZCode 会话"
deadline=time.time()+MAX_MIN*60
miss=0
while time.time()<deadline:
    v,err=snap()
    if err:
        miss+=1
        if miss>=6:
            print(f"连续 {miss} 次{err}，停止等待"); sys.exit(0)
    else:
        miss=0
        if v.get("status")!="running":
            el=int(time.time()-(v.get("started_at") or time.time()))
            print(f"ZCode 已结束：status={v.get('status')}  总耗时 {el//60}m{el%60:02d}s")
            print("最近动态：",(v.get("detail") or "")[:300])
            sys.exit(0)
    time.sleep(INTERVAL)
print(f"达到 {MAX_MIN} 分钟上限仍在运行，停止等待（轮次未必失败，自行复查）")
