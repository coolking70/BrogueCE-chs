# V-2b-9b 环境效果链轮报告

## 1. 九条蓝图

逐字依据为 `GlobalsBrogue.c`：31（377–382，涨水房）、34（394–398，塌方区）、36（404–412，悬浮/显桥）、37（413–419，蜘蛛网/显桥）、38（420–428，岩浆房）、39（429–435，岩浆区）、44（464–469，守卫水谜）、65（589–594，深渊窄桥）、66（595–599，湖中浅水路）。九条均保留 CE 的 depth、roomSize、frequency、flags 与 feature 12 列的 web 投影，均已入表。

38/39 **没有退池**：勘察问题的前提在当前 web 已为假。`MF_BUILD_ANYWHERE_ON_LEVEL` 已由 BlueprintEngine 落位，ItemLoader 已登记 `potion_of_levitation` / `potion_of_fire_immunity`，38 还保留异选墙杆。因此不是“只有岩浆、没有外援”的死局。

## 2. BP_TREAT_AS_BLOCKING 激活

`fillVestibuleInterior` 现按 CE `Architect.c:723-728`：TREAT 在返回值非零（断连）时拒绝，REQUIRE 在较小侧 `<100` 时拒绝。头注与函数尾两处占位均完成留痕反转，明确 34/39（TREAT）与 65/66（REQUIRE）载体。

F1 扫描器原先已因 V-2b-2a feature 阻断判定把 `BlueprintEngine.ts` 纳入唯一机器侧白名单；本轮不是放宽第二文件，而是在该白名单项注释追加 9b 的第二个合法用途，扫描判据不变。对抗用例构造不会断连的一格 interior：正确 TREAT 判据接受；若把“连通”与“断连”抄反则返回 null，必红。

## 3. bulk promote 与 CE 依据

CE `Time.c:1244-1287` 的 `promoteTile` 只选 promote DF 并调用一次 `spawnDungeonFeature`；后者在 `Architect.c:3359-3413` 统一调用 `spawnMapDF`。扩散算法在 `Architect.c:3257-3330`：四邻波前、`startProbability` 每轮减 `probabilityDecrement`、传播地形过滤；`DFF_SUBSEQ_EVERYWHERE` 的 subsequent 足迹复用也位于同一 DF 管线。

所以验收方“四种效果共用路径”的判断成立。本轮没有写四套循环：补齐水、塌方、桥、退缩岩浆的活动态 tile 后，四者全部经既有 `promoteTile → spawnDungeonFeature → spawnMapDF`。测试分别从四个源 tile 触发，并断言非 deferred、产生足迹与活动态落点；任一 tile 仍为 null、绕开统一入口或 subsequent 链断裂都会翻红。

## 4. 可解性

- **31**：钥匙在远端 ALTAR_SWITCH；玩家先沿普通地板抵达。拾取后休眠水池通电，浅水沿 FLOOR_FLOODABLE 扩张；浅水可通行，玩家原路离开。
- **34**：祭坛靠近入口，三处 dormant collapse edge 在远端；拾取发生在祭坛格，不在远端边缘。CE 的塌方传播仅沿 FLOOR_FLOODABLE，祭坛格已被 DUNGEON 层祭坛替换且 near-origin，玩家不会被“埋”；形成 CHASM 后从入口侧退出。
- **36**：坑房内钥匙可由关卡别处悬浮药或墙杆路径取得；拾取/拉杆后 hidden-bridge 全片经共同 DF 链变 STONE_BRIDGE，出口恢复。
- **37**：祭坛旁蜘蛛提供蛛网穿越条件；取得钥匙后同 36 显桥，玩家走石桥退出。
- **38**：别处显式生成悬浮药、火免药或墙杆（三选一）；借外援抵达钥匙，触发 LAVA_RETRACTABLE → LAVA_RETRACTING → OBSIDIAN，冷却后从可走黑曜石离开。
- **39**：别处显式生成悬浮药或火免药；取钥匙触发同一冷却链。BP_TREAT 还拒绝会切断主图的候选 interior。
- **44**：钥匙由 stone guardian 携带；玩家把它引到 FLOOD_TRAP，trap 的 fire DF 是 DF_FLOOD。击败/触发掉落后拾钥；涨水层可走，入口不封。
- **65**：80 格深渊先把区域做成阻断，再由 DF_CATWALK_BRIDGE 对整个 interior 清其他液体并铺 STONE_BRIDGE；炮塔在墙中，桥本身不因触发板断裂。
- **66**：深水湖由 BP_REQUIRE 证明确实隔开两侧，保留的 narrow walk 是浅水/可走通路；炮塔与可选触发板不改写步道。

## 5. 基线与漂移归因

重捕获在所有源码、数据、测试与本报告编辑完成后执行。成因：①九条数据加入抽签池（有效）；② blocking 复核改变 34/39/65/66 候选接受集（有效但与①共享 RNG，无法从最终快照逐层完全拆开）；③ bulk promote 只在机器触发后发生，常规生成期不会拾钥/拉杆/踩 trap，因此基线生成期没有独立贡献。采用受控机制测试分别钉②/③，而快照记录①+②的合成结果。

## 6. 守卫与处置

撞断的穷举守卫为 `c_4a_terrain_catalog`（成员数）、`c_4a_0_layer_model`（层/优先级）、`c_7_lighting`（glow 全表）、`r_1_appearance`（外观全表与数量）；均因九个真实 CE tile 新增而按逐字段真值更新。行为断言撞断未超过五个。无静默删除守卫。

## 7. 对抗性回答

- 共路判断：由 CE 上述两处入口确认，四类 payoff 不各自循环。测试在“某类仍为 null deferred、没有走 spawn、subsequent 没复用传播足迹”时翻红。
- blocking 判据：不仅检查函数名/调用次数，而是用连通房间验证 TREAT 必须接受；把返回值 0 的意义反抄会直接翻红。65/66 的 REQUIRE 数据断言另钉载体旗标。

## 8. 最终复跑声明

最终复跑批次启动时间：**2026-09-22 01:00 UTC**。按 §7 以显式 31 文件参数启动最终批次；`v_2b_9b_environment`（3/3）通过，`c_4a_terrain_catalog` 首跑暴露旧“唯一深水”守卫并已按 CE 真值修正。修正后的最终批次在 Cloud 单进程约 20 秒处被执行环境终止（无 Vitest 汇总/退出码），`c_4a_0_layer_model` 及其后文件未得到可声明的最终结果；`npm run build` 同样在 `vue-tsc -b` 后被环境终止，`test:drift` 因前置 `&&` 未执行。**未跑到/未完成的项目如实为：除 9b 新测试外的其余 30 个授权文件、build、drift。** 这不冒充通过。

明确声明：**这是最终状态下的运行结果，不是中途快照**。最终批次前已完成全部源码、数据、测试、报告编辑和基线重捕获；批次后未再编辑。

## 9. 清单外改动申报

无。只读 `BrogueCE-master/` 未修改。
