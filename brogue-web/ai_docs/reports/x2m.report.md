# X2m 光照表现执行报告

## 0. 规格与结论

规格按任务书 §0 实际引用的 [X-1 勘察报告](x-1-survey.report.md) §4 N10（第 180 行）、§3 K16（第 86 行）、§7.1（第 272 行）执行。用户消息称“X-0”，但任务书指定的是 X-1；本报告采用该明确引用，没有扩大到其他勘察条目。任务书标注的报告版本为 `bd40bbc0`，执行工作树起点为 `05cbe2dca14faf7f5794074252f13c2d2cd5d409`。

已补齐 CE 实际存在的 flare 调用来源、临时可见性和探索记忆，以及地形和光源随机颜色。固定生成光照与主 RNG 保持原合同；动画结束、下一条命令和保存前恢复基础可见性。浏览器已通过真实魔杖使用事务、爆炸 DF、召唤、固有光、力场及录像验证。没有提交 git。

**验收例外：** 原 C-7 的载体名单与原 W-21 的强化闪光可见性前提不再符合 CE。本轮先保留原守卫运行并做隔离反事实实验，再按任务书“先反事实证明、只修前提、交验收方裁决”修正这两处前提。没有删除、跳过或削弱其他断言；详见 §5，须由验收方裁决该例外。

最终门禁统计见 §6；原始输出、截图和 SHA-256 清单保存在 [x2m-evidence](x2m-evidence/) 下。

## 1. CE 调用点审计

只读核实本地 `../BrogueCE-master/src/brogue`。完整搜索记录为 [ce-callsites.json](x2m-evidence/ce-callsites.json)：14 个匹配，扣除 Light.c 中定义和内部构造调用后，有 11 处业务调用。

| CE 来源 | 光源及条件 | web 落点与处理 |
|---|---|---|
| Architect.c:3450 | DF 的 `lightFlare`，沿真实 DF 事务触发 | 保留 `DungeonFeature` → Game effect sink → `createFlare`；逐条以 Globals.c 的 DF 行审计。补上漏项 `DF_ACTIVATE_PORTCULLIS` 的 `GENERIC_FLASH_LIGHT`（Globals.c:853）。 |
| Combat.c:682 | 速度符文触发，目标未潜没；在玩家坐标产生 `SCROLL_ENCHANTMENT_LIGHT` | `applyWeaponRunicEffect` 新增，使用已成功触发的既有符文分派，不新增伤害或触发骰。 |
| Combat.c:685 | 安息符文、未潜没目标，`QUIETUS_FLARE_LIGHT` | 同上，目标坐标，负色光也参与暂时 lit 判定。 |
| Combat.c:688 | 杀戮符文、未潜没目标，`SLAYING_FLARE_LIGHT` | 同上，目标坐标。 |
| Items.c:5316 | 成功强化怪物后无条件 `EMPOWERMENT_LIGHT`；`canSeeMonster` 仅约束自动识别等观察结果 | 将 `createFlare` 从 `if (autoID)` 中移出，保留免疫、反射、死亡对象等原效果资格门。不可见身份不因地面受光而自动暴露。 |
| Items.c:7901 | 附魔卷轴 `SCROLL_ENCHANTMENT_LIGHT` | 已有真实卷轴事务，保留并由 U21/W 系列守护。 |
| Items.c:7920、7939 | 护甲/武器保护卷轴 `SCROLL_PROTECTION_LIGHT` | 已有，保留。 |
| Items.c:8111 | 力量药水 `POTION_STRENGTH_LIGHT` | 已有，保留。 |
| Monsters.c:1070 | 有合法召唤 horde 的召唤过程后 `SUMMONING_FLASH_LIGHT`；即使本次没有成功放下随从也产生光 | 在 `summonMinionsFor` 的共同出口新增，位置为召唤者坐标，保留无 horde 的早退。 |
| Time.c:1168 | 坠落处理后的 `GENERIC_FLASH_LIGHT`，包括最深层的坠落传送分支 | 在 `playerFalls` 新增，使用落点层/坐标；致命坠落早退也保留该光。 |

**任务书措辞与 CE 的区别：** CE 的 bolt 结构没有通用 `lightFlare` 字段。这里的 `lightFlare` 字段属于 DF。光束沿途照明使用 Items.c:5650、5723、5895 的独立 `paintLight` 路径，普通传送使用 `flashMonster`，不能据“传送/bolt”字样给所有法术凭空增加 `createFlare`。本轮接通的是上表全部真实 flare 来源；没有把移动光束、实体闪色重写成 flare，也不宣称本轮新增了完整 CE 移动光束照明。

## 2. 临时光、知识与生命周期

CE Light.c:291–403 的可达调用均通过 `createFlare` 构造衰减光：系数初值 100000，变化量 -15；每帧 `coeff += change * 100`、`change = trunc(change * 12 / 10)`；整数 `coeff / 1000 < 0` 时结束。保留 `turn > 0 && turn < absoluteTurn - 1` 的过期条件。半径用完整系数缩放，颜色及其随机分量用整数百分比缩放。

CE `animateFlares` 备份基础光，每帧叠加 flare、`demoteVisibility`、`updateFieldOfViewDisplay`，随后恢复基础光；因此 flare 确实影响 lit/探索，而不只是覆盖画面。web 对应实现为：

- 从 `updateVision` 提取共享的 `updateFieldOfViewDisplay`，基础光和临时光使用同一几何 FOV、正/负千里眼和逐通道钳零后的光强阈值。墙和生物遮挡仍由原 LightMap 管线处理。
- flare 使用独立 LightMap 叠加，`maintainShadows: true`；不写基础三通道光和阴影。负色光可以暂时使格子不可见。
- 在回合完成时预采样该批 flare 的完整帧，逐帧记录看见过的格子、地形层、terrain/mech flags、物品记忆，随后恢复基础可见性。10ms 播放和跳帧消费同一缓存，保持相同知识与 RNG 状态。
- 播放时只更新临时可见性。侧栏、地图身份与文本继续通过既有 `canSeeMonster` 决策；隐形、潜没等身份门不由受光格直接替代。
- 下一条命令、保存快照前完成发现并收掉已显示的瞬态光，避免把某个浏览器帧的可见性带入 AI、目标选择或持久化。尚未播放的事件保留给动画入口，届时按回合过期规则处理；保存则连未播放队列一起清空。换层、读档、重开沿既有瞬态清理流程丢弃队列和光图。最后一个动画 tick 仍要求重绘，清除残帧。

实现分布：`src/engine/Core/Game.ts`（来源、知识/可见性和清理）、`src/engine/Lighting/CosmeticLight.ts`（采样与瞬态缓存）、`src/engine/Lighting/LightMap.ts`（基础光与渲染采样分开）。新增测试包含暗区揭示与记忆、墙、负千里眼、负色光、保存/读档、快进、陈旧回合和换层；不是仅断言数组中有光源名称。

## 3. 动态色与 RNG 边界

`TerrainColorCatalog.ts` 从本地 CE 提取 212 个颜色定义、6 组深度颜色和 193 个 web 地形的 fore/back 颜色名映射。可通过 `python scripts/x2m-colors.py` 重建。保留 CE 的 RGB、三通道随机幅度、共享随机幅度及 `colorDances`，不是只抄基础 RGB。

地形使用 IO.c:932–958 的每格八值模型：0–2 为前景 RGB，3–5 为背景 RGB，6/7 为前/背景共享随机数。整数乘除后钳位并按 CE web 平台截断到 0–255；深度色的随机幅度也参加深度插值。随机值在连续 render 间稳定；依 IO.c:970 起的 `shuffleTerrainColors`，可见且有 dancing color 的格子以 3% 机会做 ±600、范围 0–1000 的随机游走。浏览器以 50ms 节拍驱动。隐藏记忆不重新随机化。

可见气体也消费真实 GAS 层的背景随机色（例如迷乱气体），按 CE IO.c:1196–1204、1316–1334 的 `min(90, 30 + volume)` 混合前/背景并保留底层字形；无采样参数的旧目录预览接口保持原约定。

| 用途 | RNG 与持久性合同 |
|---|---|
| 基础 `updateVision` / 生成 | 原有确定性半径/基础色，不新增随机抽取；基础可见性和阴影不随空闲帧变化。 |
| flare 光源 | CE Light.c:67–72 的 clumped radius、共享随机色、RGB 独立随机色公式；显式进入全局 COSMETIC，`finally` 恢复调用前流选择；只在准备动画序列时采样一次。 |
| 空闲地形/持续光闪烁 | 从 COSMETIC 状态初始化的独立展示续流，绑定 Grid 生命周期；全部抽取仍选择 COSMETIC。空闲帧不推进录像保存的全局两条流，也不改变下一次 flare 的知识结果。 |
| 快照/录像 | 不保存展示缓存；命令边界归一化瞬态状态。快/慢播放和插入空闲帧均有两条 RNG 状态及记忆一致性断言。 |

这里遵循任务书明确的“只用 cosmetic、不得移动主流”约束。CE 原生 Light.c:65、374 明确使用 SUBSTANTIVE；web 此处不是 CE 随机序列逐骰同构。光的采样公式与可见性机制对齐，保留 C-7 已登记的基础光确定化和定点平方根近似，不借本轮重录生成基线。动画按队列预采样，不承诺与 CE 多光源帧内随机消耗的逐位顺序一致。

K16 在 X-1 中已确认固有光、地形目录和侧栏基本链存在，不能重复宣称它们全缺失。本轮核实了 `MONSTER_INTRINSIC_LIGHT` 的既有种类映射、mutation/burning 分支，以及 `TerrainAppearanceCatalog` 的 FORCEFIELD/其它地形外观；主要补充它们的随机色消费。浏览器使用幽火和力场验证现有链，新增测试确认力场有 `#` 字形及非黑前景。

## 4. 浏览器验收

脚本为 [scripts/x2m-browser.mjs](../../scripts/x2m-browser.mjs)，使用 Playwright + 本机 Edge、Vite `127.0.0.1:5199`，1440×960。进入真实菜单后使用 seed 424242；为隔离灯光，脚本建立固定房间和黑暗状态，控制浏览器时钟，不替换生产方法或伪造 flare 队列。

| 场景 | 真实操作与结果 | 截图 |
|---|---|---|
| 强化前 | 目标格不可见、未探索，侧栏无怪物 | [before](x2m-evidence/browser-before.png) |
| 强化施法 | 实际物品 use → 选定目标 → confirm；消耗 1 次充能、推进 1 回合、目标获得 1 次强化；目标格暂时可见，侧栏出现老鼠 | [empowerment](x2m-evidence/browser-empowerment.png) |
| 闪光结束 | 临时光清除；目标格不可见但已探索，侧栏再次隐藏目标 | [after](x2m-evidence/browser-after.png) |
| 爆炸 | 调用真实 `spawnDungeonFeature(DF_BLOAT_EXPLOSION)` 事务，产生爆炸光及火焰地形，房间被照亮 | [explosion-df](x2m-evidence/browser-explosion-df.png) |
| 召唤 | 真实哥布林召唤师 `summonMinionsFor` 创建随从，随机色为唯一正光源分量的召唤光实际可见 | [summoning](x2m-evidence/browser-summoning.png) |
| 持续动态色 | 幽火固有光、水、火、力场；两个时点颜色发生变化，力场有可读字形，侧栏出现幽火 | [dynamic-a](x2m-evidence/browser-dynamic-a.png)、[dynamic-b](x2m-evidence/browser-dynamic-b.png) |

此外在 fresh normal game 中通过真实键盘输入两次等待，其间插入空闲渲染帧；导出 v2 录像后回放，`count = cursor = 2`，`replayError = null`。浏览器 console/page error 均为空。结构化结果为 [browser.json](x2m-evidence/browser.json)。上述场景覆盖受控条件下的真实事务，不是自然随机层全流程通关验证。

## 5. 原守卫冲突与反事实裁决材料

先运行未修改守卫的测试；最初还出现 C-7 的渲染绑定断言，已通过保留真实 `lightMap.lightAt` 基础通道输入、另外注入展示通道来修正生产结构，**没有修改该守卫**。其余冲突如下。

### 5.1 C-7 的“无真实载体”名单前提

原断言会拒绝任何生产代码引用名单外的 LightKind。X2m 新增的 GENERIC_FLASH、SUMMONING_FLASH、QUIETUS_FLARE、SLAYING_FLARE 已有上表真实来源，继续把它们视为“无载体”与 CE 冲突。

隔离副本中保留 HEAD 原守卫，仅撤掉新增召唤、坠落和符文光调用：原 C-7 整文件转绿，但新增的真实召唤、坠落、速度/安息/杀戮来源测试共 5 项转红。见 [negative-missing-sources.json](x2m-evidence/negative-missing-sources.json)。

仅修前提：在 C-7 的 `CARRIER_KINDS` 中登记上述四种已有真实载体的光。源码扫描范围、剥除注释/字符串规则、未登记光不得出现的断言均保留；没有隐藏光名字符串来逃避扫描。

### 5.2 W-21 的“未观察到目标则无强化光”前提

原 W-21 的 invisible/hidden 两个参数案例要求队列为空，而 CE Items.c:5316 的 `createFlare` 位于可观察性判断之外。

隔离副本只把强化 `createFlare` 放回 `if (autoID)`：原 W-21 整文件转绿，但新增的两个实际暗区强化场景转红。见 [negative-hidden-empowerment.json](x2m-evidence/negative-hidden-empowerment.json)。

仅修前提：成功强化始终期望同一个精确 flare payload。原 `autoID === seen`、拒绝伪造 bolt impact 帧、免疫目标不得写状态/flash/RNG、充能和回合断言均保留；新增测试继续验证隐形身份不会出现在侧栏。

两组反事实通过 [scripts/x2m-counterfactual.mjs](../../scripts/x2m-counterfactual.mjs) 重现。脚本从 git HEAD 读取原两份守卫，在包目录外的临时副本运行，不修改当前工作树、fixture 或快照。它的两个子测试进程返回 1 是预期的负对照，不应作为最终门禁失败。

**裁决范围仅限以上两处旧前提修正。** 本报告不把“当前绿灯”当作自动批准；CE 行号、原规则、负对照和最小改动均提交验收方核对。

### 5.3 全量暴露的真实回归：仅修生产代码

第一轮实现后的完整全量（[interim-all.json](x2m-evidence/interim-all.json)）有 19 项失败：U00 的 12 项重开完整状态图检测发现 LightMap 新缓存保留了函数回调；U17c/d/e 的 7 项真实搜索/祭坛入口检测发现，连续无渲染命令提前删掉了未播放的 DF 事件。这些不是旧前提例外，U00/U17 守卫完全未修改。

修复将仅供渲染重放的光源回调移到以 LightMap 实例为键的展示缓存，新地图/重开自然更换缓存归属；命令边界只清除已显示帧，保留未播放事件，由动画入口检查回合过期，快照仍彻底清空。定向复跑 U00、U17c/d/e、X2m 共 108 项全部通过，见 [lifecycle-final.json](x2m-evidence/lifecycle-final.json)。随后重新冻结源码并执行最终全量，未用定向绿灯代替该全量。

## 6. 最终验证

| 门禁 | 最终结果 | 证据 |
|---|---|---|
| 完整 `npm test` | **212 文件，3911 passed，0 failed，8 pending，5 todo**；3924 项总计。13 个未执行项与初始全量逐名称/状态一致，没有新增跳过项。进程退出码 0。 | [final-rerun.json](x2m-evidence/final-rerun.json)、[文本日志](x2m-evidence/final-rerun.txt) |
| R∪S | **83 文件，1882 项断言全部通过**，无 pending/todo；含下述独立漂移测试。 | [rs-results.json](x2m-evidence/rs-results.json) |
| `npm run build` | TypeScript/Vue 类型检查及 Vite 生产构建通过，退出码 0。 | [build.txt](x2m-evidence/build.txt) |
| `npm run test:drift -- --maxWorkers=1` | 4 seed × D1–26 原基线通过，退出码 0。 | [final-drift.json](x2m-evidence/final-drift.json) |
| 深层生成 | `u_26a_deep_baseline`（四 seed × D27–40）1 项与 `u_26a_deep_levels` 16 项在最终全量中通过；基线未改。 | 同最终全量及 [baseline-integrity.json](x2m-evidence/baseline-integrity.json) |
| UR4 / 重点光照回归 | UR4、C-7、W-21、R-1、U21c 侧栏的 106 项定向复跑全部通过，并在最终全量中再次通过。 | [critical-final.json](x2m-evidence/critical-final.json) |
| 生命周期回归 | U00、U17c/d/e、X2m 共 108 项通过；U00/U17 原守卫未改。 | [lifecycle-final.json](x2m-evidence/lifecycle-final.json) |
| 浏览器 | 真实施法/DF/召唤/动态色、侧栏和新录像验证通过；7 张截图，错误列表为空。 | [browser.json](x2m-evidence/browser.json) |

完整命令为 `npm test -- --reporter=json --outputFile=ai_docs/reports/x2m-evidence/final-rerun.json`，使用仓库原有的 generation_baseline 排除规则；该基线由独立 `test:drift` 补全。最终全量从 **2026-09-27 13:51:30 到 14:10:04（UTC+08:00）**，完整运行约 18 分 35 秒，没有用中途输出或定向子集代替完成结果。汇总见 [verification-summary.json](x2m-evidence/verification-summary.json)。

R∪S 清单见 [rs-closure.json](x2m-evidence/rs-closure.json)：R 覆盖指定 p1_30、U24、C-7、R-1、U21a/b/c、U23、ui_*、UR4，以及光照/知识/DF/录像/深层直接消费者；S 保守纳入所有 `readFile`/`readFileSync` 源码或 fixture 读取测试。全量测试加单独 `test:drift` 覆盖该并集，不用挑选绿灯子集代替全量门禁。

U21a/U21b 没有对应同名测试文件：按其报告反查既有 W2/W9/W10/W18、P4-3、scroll_effects、U14a 与 C-7 的实际可见性/光照消费者，已纳入 R。最终清单补齐了这些旧命名项，均直接使用同一次最终全量的通过结果，不以名称匹配代替覆盖。

初始工作树完整全量为 3893 passed、0 failed、8 pending、5 todo，共 3906；见 [preflight-all.json](x2m-evidence/preflight-all.json)。新增 X2m 测试 18 项全绿，见 [x2m-final.json](x2m-evidence/x2m-final.json) 及最终生命周期/全量复跑中的同组案例。开发期失败结果保留，文本日志仅统一为 UTF-8/LF；文件名 `first`/`negative` 不表示最终结果。

## 7. 最终复跑与工作树声明

最终源码冻结时间为 `2026-09-27T13:51:22.349878+08:00`；记录了 343 个源码/测试/本轮脚本/配置文件的 [SHA-256](x2m-evidence/final-source-sha256.json)。在该版本上完整复跑 build、test:drift、浏览器和全量 npm test；全部完成后再次逐文件核对，源码哈希未改变。报告和证据整理不修改生产代码或测试。

最终 `git diff --check` 通过；所有新增/修改文本均以 UTF-8/LF 交付，没有新 CRLF。工作树 HEAD 仍为 `05cbe2dca14faf7f5794074252f13c2d2cd5d409`。

本轮未修改 CE 源、generation/deep baseline、UR4 黄金 trace 或其他既有 fixture，没有重新录制基线；未执行 git add/commit。三份关键基线的字节均与 HEAD 一致，见 [baseline-integrity.json](x2m-evidence/baseline-integrity.json)。交付仅为当前工作树代码、最小前提修正、新增测试、复现脚本和本报告/证据。

执行中首次反事实临时副本放在包目录下，导致一次测试发现重复；该次运行已中断且不计入验收。随后迁移临时目录时遇到 Windows junction 跟随行为，涉及目录立即完整恢复，核对 git 无非预期删除/改动，并重新执行验证。最终反事实副本位于包目录外，最终测试只发现一份生产源码和测试。该过程未用于修改或重录任何基线。
