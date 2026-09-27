# X2o：horde 成员数 randClump 与风味蓝图深度上限按 CE（⚠️ 移动生成流）

> **本地执行（Mac 轨）。X-1b §4 XB02、XB03（以及 X-1 D05/K32 已登记的 horde 数量 clump）。**

## 0. 规格

**`ai_docs/reports/x-1b-survey.report.md` §4 XB02、XB03 是权威规格**（`1bbb54bf`）：

> XB02：入口 `GC:646–656 → G.pickHordeType:1405–1413 → G.spawnHordeAt:1587–1605`。CE `C/Monsters.c:718` `randClump(theHorde->memberCount[iSpecies])`，
> `C/Math.c:40–58` 对 `{5,10,2}` 等价 `5 + U(0,3) + U(0,2)`；web 数据**无 clump 字段**，`G:1589` 直接 `randRange(5,10)` → 分布与 RNG 调用数均不同。
> 这是 X-1 D05/K32 已登记的"horde 数量 clump"——**全部 horde 行**（不止深层）都应按 CE
> XB03：CE58–66、71 等 10 个风味蓝图 CE 深度 1–40（CE65 1–39），web 写成 1–26（1–25）；`V/GlobalsBrogue.c:558–618`；
> 当前经 autoGen 强制编号建造不走资格门，但数据保真未闭合；U19f 守卫未核 CE 最大深度

## 1. 范围（**全部请自行核实 CE**）

- `hordes.json` 为每个成员补 CE 的 `{lower, upper, clumpFactor}`（从 CE hordeCatalog 独立解析，不手抄）；`spawnHordeAt` 用 `randClump` 抽成员数（RNG 调用数同 CE）
- 其他 horde 相关 randClump/randRange 若也与 CE 不同（领袖/俘虏/机器 horde、召唤 `summonMinions` 的成员数）一并核对
- 10 个风味蓝图 depthRange 按 CE 修正；补一条守卫：所有蓝图 depthRange 与 CE 逐行一致（含最大深度）
- 独立 CE 解析黄金表 + C oracle（randClump 分布与调用数）

## 2. 生成流

先 drift + 深层基线记录 → 单变量归因（horde clump、蓝图深度各一段）→ 独立守卫 → 一次重捕获（浅/深分别）。
黄金 trace（UR2/UR3/UR4）若翻红：单变量归因后按原方法重录并登记。📌 用户裁决：生成变化不是卡点。

## 3. 约束

📌 **任务书与 CE 冲突时以 CE 为准并写明**；**撞上守卫时改代码，不改守卫**；**守卫靠旧规则才绿时**先反事实证明、只修前提、交验收方裁决；
**反查闭包含 p1_30、U24、U01/U03、U18a*、U19*、U26a、V 系列、horde_*、monster_*、c_*、UR2–UR4 trace 与所有读源码守卫**；不产生 CRLF。

## 4. 门禁与报告

R∪S + build + test:drift + 深层基线；**全量 npm test 完整跑完**；最终复跑声明；基线前后哈希。报告 `ai_docs/reports/x2o.report.md`。
