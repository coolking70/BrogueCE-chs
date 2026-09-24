# W-25 归因完成：无需重捕获

编辑前 drift 通过。编辑后（目录/回电/入口均已接线）drift 仍通过。
原4 seed × D1–D26的旧池控制、仅表序修正、加入三种三个场景均完成；均与原基线零字段差异，层末 substantive RNG 计数一致。生成流确实改变所选 staff 身份，逐事件证据见 trace-summary.json 与 drift-attribution.json；不能将基线绿解释成目录不变。

原因：六种旧杖与三种新杖全部走相同的 rollStaffEnchantment（50%、15%、10%尾部），抽中哪种都没有 W24 赋能单值区间那样的条件 RNG 差异。表序修正与新增分开比较，kind 发生变化、E/初始充能和抽签边界保持一致；初始回电500/1000是确定性写入，也不抽 RNG。外观洗牌仍走 COSMETIC，完整词表不变。

独立分布守卫64 seed ×1000，九种、85张票、CE行字段与每件总抽签次数=E通过。实际 kind/E 统计见 distribution.json。

因此保留现有基线逐字不变；没有候选复制、没有重捕获。baseline-hashes.json单列前后SHA。
