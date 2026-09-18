# 等待「ZCode 的运行中会话数降到 N 以下」——用于并行多轮时
import json,ssl,time,urllib.request,sys,datetime
ctx=ssl.create_default_context(); ctx.check_hostname=False; ctx.verify_mode=ssl.CERT_NONE
URL="https://localhost:8443/api/state"
TARGET=int(sys.argv[1]) if len(sys.argv)>1 else 1   # 跌到「少于 TARGET+1 个」即唤醒
MAX_MIN=180; INTERVAL=30
def zcode_running():
    try:
        d=json.load(urllib.request.urlopen(URL,context=ctx,timeout=10))
    except Exception as e: return None,f"接口不可达:{type(e).__name__}"
    return [v for v in d.get("sessions",[]) if v.get("tool")=="ZCode" and v.get("status")=="running"],None
deadline=time.time()+MAX_MIN*60; miss=0
while time.time()<deadline:
    rs,err=zcode_running()
    if err:
        miss+=1
        if miss>=6: print(f"连续 {miss} 次{err}，停止等待"); sys.exit(0)
    else:
        miss=0
        if len(rs)<=TARGET:
            print(f"ZCode 运行中会话降至 {len(rs)} 个（阈值 {TARGET}）")
            for v in rs:
                el=int(time.time()-(v.get('started_at') or time.time()))
                print(f"  仍在跑：{(v.get('title') or '')[:50]} 已 {el//60}m")
            sys.exit(0)
    time.sleep(INTERVAL)
print(f"达到 {MAX_MIN} 分钟上限，停止等待")
