# 等待「ZCode 运行中会话数 ≤ TARGET」——带去抖，支持并行多轮
# 用法: abwait2.py [TARGET=0]
import json,ssl,time,urllib.request,sys
ctx=ssl.create_default_context(); ctx.check_hostname=False; ctx.verify_mode=ssl.CERT_NONE
URL="https://localhost:8443/api/state"
TARGET=int(sys.argv[1]) if len(sys.argv)>1 else 0
MAX_MIN=600; INTERVAL=30; CONFIRM=4     # 需连续 4 次（约 2 分钟）确认，防状态空档误报

def zcode_running():
    try:
        d=json.load(urllib.request.urlopen(URL,context=ctx,timeout=10))
    except Exception as e:
        return None, f"接口不可达:{type(e).__name__}"
    return [v for v in d.get("sessions",[]) if v.get("tool")=="ZCode"
            and v.get("status")=="running"], None

deadline=time.time()+MAX_MIN*60; miss=0; hits=0
while time.time()<deadline:
    rs,err=zcode_running()
    if err:
        miss+=1; hits=0
        if miss>=6:
            print(f"连续 {miss} 次{err}，停止等待"); sys.exit(0)
    else:
        miss=0
        if len(rs)<=TARGET:
            hits+=1
            if hits>=CONFIRM:
                print(f"ZCode 运行中会话稳定在 {len(rs)} 个（阈值 {TARGET}，连续 {CONFIRM} 次确认）")
                for v in rs:
                    el=int(time.time()-(v.get('started_at') or time.time()))
                    print(f"  仍在跑：{(v.get('title') or '')[:50]} 已 {el//60}m")
                sys.exit(0)
        else:
            hits=0      # 回到运行中，去抖计数清零
    time.sleep(INTERVAL)
print(f"达到 {MAX_MIN} 分钟上限，停止等待")
