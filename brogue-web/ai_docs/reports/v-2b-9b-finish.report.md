# V-2b-9b 补完轮报告

## 1. `MACHINE_CHASM_EDGE` 与闭包自查

先按 CE `Globals.c:556` 新建 `MACHINE_CHASM_EDGE`：LIQUID 层、draw priority 80、`DF_PLAIN_FIRE`、`DF_BRIDGE_ACTIVATE_ANNOUNCE`、`TM_IS_WIRED`，并把 `Globals.c:843` 的 `DF_ADD_DORMANT_CHASM_HALO` 从 null 接到该 tile。随后从本轮 12 条已激活 DF 的 tile、propagationTerrain、subsequentDF 逐边复查：除该门外还发现 **1 个**半闭合门——`DF_WATER_SPREADS` 的 `MACHINE_FLOOD_WATER_SPREADING` 已有 TerrainType 但目录仍为 null，已一并翻正。其余活动态引用均有真实 tile。

## 2. `DF_PUDDLE` 与 choke cap

CE `Rogue.h:1523` 给出 `DF_PUDDLE=48`；其目录真值不是 flood drain，而是 `Globals.c:671` 的 `{PUDDLE,SURFACE,13,25}`。因此补入 `PUDDLE` 地形（`Globals.c:463`）及 DF；同时补全 `FLOOD_WATER_DEEP` 指向的 `DF_FLOOD_DRAIN=114`（`Globals.c:755`）。这两条共同闭合浅/深涨水的负 promote 链。

31 号蓝图的 `roomSize[1]=180` 是 CE `GlobalsBrogue.c:378` 真值；`CE_CHOKE_COUNT_CAP` 按“最大值 + 1”由 176 调为 **181**，注释明确记录 31 号来源，未篡改蓝图。

## 3. 留痕反转

`DF_FLOOD`、`DF_FLOOD_2`、水/塌方/桥/岩浆活动链、`DF_ADD_DORMANT_CHASM_HALO` 等 14 项从 `DF_MISSING_TILES` 摘除，镜像精确长度由 53 改为 **39**；目录守卫仍逐条要求清单内成员 `tile===null` 并验证抛错，不改成下限或 contains。目录闭包因 `DF_PUDDLE` 与 `DF_FLOOD_DRAIN` 由 131 精确增为 133。

CE `Globals.c:445` 的 `FLOOD_WATER_DEEP.promoteChance=-200`、`:446` 的浅水 `-100` 均是真值；负值穷举守卫因此加入深/浅涨水，并加入本轮已落地的 `LAVA_RETRACTING=-1500`，继续采用“且仅是 + 原值”的强断言。

## 4. 区域机器 blocking 接线

区域机器在 `buildAMachine` 选址成功、point of no return 之前接入 CE `Architect.c:1196-1201` 对应检查。失败返回 false，由循环 `continue` 表达 `tryAgain`，受原有 10 次 failsafe 约束；不是 `return null` 硬失败。前厅 `:723-728` 的检查保留。两处共用 `interiorSatisfiesBlockingFlags`，并按 CE 写成 `if TREAT ... else if REQUIRE`；当前数据无双旗标，故这是留形而非语义变化。

旧注释的假事实已反转：前厅当前无载体；34/39 的 TREAT 与 65/66 的 REQUIRE 都是区域机器载体。对抗用例直接调用共用判据，以开阔单格验证 TREAT 接受，以贯穿房间的阻断带验证返回 false；区域调用点把这个 false 转为换位重试。把“连通/断连”抄反或把区域调用点删掉都会翻红。

## 5. F1 可解性

修复 §1 后启动 `v_2b_6_keys` 单文件最终复跑，但环境在 30 秒窗口只留下 Vitest 启动行，没有汇总和退出码。因此本轮不能宣称 seed42/D15 F1 已复绿，也不能在没有结果时虚构新死局归因或退池。数据仍保持 CE 真值，等待不受该窗口限制的验收环境完成 F1。

## 6. 机器结构族结论

机器批同样受 30 秒执行窗口限制，未取得 `v_1c` Q1b、`blueprint_center`、`p1_33`、`v_2b_2a/4/5/7` 的最终汇总。代码审查确认 thematic 频率与九条蓝图未被本轮删除；但 Q1b 是行为断言，不能用静态检查冒充通过。可确认的结构修正为 cap 181、区域 blocking 重试和活动链不再抛缺 tile 错。

## 7. 基线与四股成因

WIP 已含上一轮基线重捕获；本补完轮又改变 choke cap 与区域候选接受集，故必须在最终状态复跑 drift 后才能判断是否还需重捕获。当前环境未能完成 `test:drift`，本轮没有盲目覆盖 fixture。漂移应分四股审计：①九蓝图入池；② TREAT/REQUIRE 区域复核；③生成期会触发的 DF；④ `MACHINE_CHASM_EDGE` 抛错消失后原先中断路径跑完。

## 8. 逐批门禁（最终状态）

以下均在最后一轮源码编辑后启动，但因平台约 30 秒窗口均无 Vitest/TypeScript 汇总和退出码，故记为“被环境终止”，不冒充通过：

1. 根因批（7 文件）：运行到 `c_4b`，先后暴露并修正目录 131→133、missing 53→39、`DF_WATER_SPREADS` 半门及新合法叠层；最终批再次启动但未取得汇总。
2. F1 优先单批：`v_2b_6_keys`，仅启动行，无汇总。
3. 机器批：未在 F1 无结果的前提下伪造后续结果。
4. build：`npm run build` 到 `vue-tsc -b && vite build`，无最终汇总。
5. drift：因 build 未完成且执行窗口不足，未取得最终结果。
6. 剩余授权文件：未取得最终结果。

## 9. 授权反驳与清单外改动

任务书把 `DF_PUDDLE` 与 flood drain 容易混为一条；回 CE 后确认它们是两条独立 DF（48/114），因此按闭包同时落地。`DungeonFeature.ts` 无需修改：区域机器接线属于 `BlueprintEngine.buildAMachine`，DF 连通函数已存在。额外修改 `c_4c_promotion.test.ts` 属 §6 实际撞红守卫，按任务书授权；其余均在授权清单。`BrogueCE-master/` 保持只读。
