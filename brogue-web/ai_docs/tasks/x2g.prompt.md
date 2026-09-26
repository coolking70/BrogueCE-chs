# X2g：原生效果补齐——lichen/darkness 投掷、ROT_GAS、潜没（MB_SUBMERGED）（⚠️ 可能移动生成流）

> **本地执行（Mac 轨）。X-1 剩余工作 §7.1 "X2-原生效果分族"（护符族已由 X2e 完成）。每族独立归因。**

## 0. 规格

**`ai_docs/reports/x-1-survey.report.md` 的 §4 N07、§7.1 是权威规格**（`bd40bbc0`）：

> N07：`G:3701–3705` creeping_death 喝下只日志；`THROWN_FUNCTIONAL_POTION_EFFECTS:5659` 无 lichen/darkness 完整分支；DF 枚举/目录未有相关全套来源。
> 黑暗**喝下状态及矿灯**已有效。ROT_GAS 未承接，STENCH_SMOKE 及恶心出口已有；**MB_SUBMERGED 仍无运行态**。这些是 CE 原生缺口
> §7.1：分开补 lichen/darkness 投掷、ROT_GAS、潜没；**每族先数据/状态/交互/显示/保存，再讨论恢复自然池**

## 1. 范围（**全部请自行核实 CE**；四族逐族独立）

- **lichen（creeping death）**：喝下（CE `drinkPotion` POTION_LICHEN → DF_LICHEN_PLANTED 等）、投掷（`throwItem` 药水碎裂 DF）、LICHEN 地形与其晋升/接触（lichen 的中毒/繁殖，CE Time.c/Monsters.c），
  lichen 怪物（若 CE 为怪物）与地形的关系按 CE；若全链闭合则解除 `creeping_death` 退池（G:103/733/921–926 与 invented_content_pool 相关条目）并按 CE 频率入池
- **darkness 投掷**：CE 投掷黑暗药水 → DF_DARKNESS_POTION 等（黑暗气体/光照），与已实现的喝下黑暗并存
- **ROT_GAS**：CE 腐烂气体（来源：尸体/怪物 DF？按 CE），状态效果（恶心等）复用已有出口
- **潜没 MB_SUBMERGED**：CE 深水潜没怪物（eel 等 `MONST_SUBMERGES`）的运行态：潜入/浮出、不可见/不可攻击、浮出攻击，按 CE Monsters.c
- 每族：数据 → 状态 → 交互 → 显示 → 保存（U01 合同）；自然池恢复单独一段

## 2. 生成流

先 drift + 深层基线记录 → 单变量归因（每族一段；入池一段）→ 独立守卫（CE C oracle 或逐行核对）→ 如有变化一次重捕获（浅/深分别）。
黄金 trace（UR2/UR3/UR4）若翻红：单变量归因后按原方法重录并登记。📌 用户裁决：生成变化不是卡点。

## 3. 约束

📌 **任务书与 CE 冲突时以 CE 为准并写明**；**撞上守卫时改代码，不改守卫**；**守卫靠旧规则才绿时**先反事实证明、只修前提、交验收方裁决；
**反查闭包含 p1_30、U24、U01/U03、U13、U15e、U17a–f、U18（深水）、f_*、g_*、invented_content_pool、w_10/w_15、UR2–UR4 trace 与所有读源码守卫**；不产生 CRLF。

## 4. 门禁与报告

R∪S + build + test:drift + 深层基线；**全量 npm test 完整跑完**；最终复跑声明；基线前后哈希。报告 `ai_docs/reports/x2g.report.md`。
