# X2m：光照表现——flare 完整来源、临时可见性与动态色（不移动生成流）

> **本地执行（Windows 轨）。X-1 剩余工作 §7.1 "X2-光照表现"。**

## 0. 规格

**`ai_docs/reports/x-1-survey.report.md` 的 §4 N10（flare/颜色）、§3 K16、§7.1 是权威规格**（`bd40bbc0`）：

> N10 flare/颜色：`G.createFlare → visualLightAt` 临时光合成，与 `updateVision` 基础 FOV 分离；**C/Light.c:291–403 临时可见性未全移植**。未接全触发源；地形/光颜色随机实现仍不同。
> K16：flare/固有生物光/侧栏怪物条目不齐；力场等无 terrainAppearance 专用 case 而落黑色空白
> §7.1：flare 完整来源与临时知识/FOV、动态色，**保持 cosmetic/主流边界**；浏览器覆盖实际法术而非仅造帧

## 1. 范围（**全部请自行核实 CE**）

- CE flare 系统（Light.c 约 :291–403 `newFlare/createFlare/animateFlares/updateFlares`）：flare 对 FOV/可见性的临时影响（CE 中 flare 光是否参与 `updateVision` 的 lit 判定→按 CE），
  全部触发源（法术 bolt 的 lightFlare、DF 的 flare、爆炸、传送、召唤等——逐一核对 CE 调用点）
- 动态颜色：CE `colorDance`/随机颜色成分（地形 fore/back 随机成分、光源颜色随机）的实现方式；**只用 cosmetic RNG 流**，不得消耗主流 RNG
- 固有生物光（怪物 intrinsicLight）、侧栏怪物条目、力场等缺专用外观的地形——若 X-1 仍列为缺则补
- 浏览器验收：真实施放法术/触发 DF 观察 flare；截图

## 2. 约束

📌 **任务书与 CE 冲突时以 CE 为准并写明**；**撞上守卫时改代码，不改守卫**；**守卫靠旧规则才绿时**先反事实证明、只修前提、交验收方裁决；
**主流 RNG 与 test:drift / 深层基线不得改变**（cosmetic 边界）；黄金 trace 若翻红须单变量归因后按原方法重录并登记；
**反查闭包含 p1_30、U24、C-7、R-1、U21a/b/c、U23、ui_*、UR4 trace 与所有读源码守卫**；不产生 CRLF。

## 3. 门禁与报告

R∪S + build + test:drift；**全量 npm test 完整跑完**；最终复跑声明。报告 `ai_docs/reports/x2m.report.md`。
