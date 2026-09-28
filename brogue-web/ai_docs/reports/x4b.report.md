# X4b 执行报告：地形描述移到位置描述行

执行目录：`brogue-web/`。任务：`ai_docs/tasks/x4b.prompt.md`。工作树起点 `ee1db0e5`（仅任务文档在 `bd6bc768` 代码基线上追加）。实现及 §3 中档门禁全部完成。未提交、未推送、未暂存；未运行全量 `npm test`。

## 1. 实现与 CE 依据

- `Game.flavorText` 是纯显示字段。DF 触发、回合尾（同步与动画）、自动行进终止、常规显示更新、新局和读档都会从当前位置重建；不加入 `GameSnapshot`、录像事件或 RNG 流。U03 合同以 `reset` 登记。
- 本地 CE `Time.c:63–81 updateFlavorText()` 的真实实现比任务概述更具体：普通站立走 `tileFlavor`，悬浮走 `describeLocation`。web 继续使用既有 `df.flavor` 加本地化地形名作为地形文案；悬浮复用从 `updateHover` 提取的只读 `describeLocation`。气体优先级沿用 web 既有描述逻辑，没有新增硬编码显示文本。
- `Time.c:2876` 是回合尾刷新；`Movement.c:61,1886,1924` 是行进结束刷新；`IO.c:3378` 也是当前位置刷新入口。对应的刷新仅更新显示字符串，不改变规则、生成、存档 schema 或随机调用。
- 桌面 `Sidebar.vue` 和手机 `MessageStrip.vue` 所用的 `useGameHud.ts` 均读 `hoveredText || flavorText`，保留原描述行样式。鼠标离开地图、移到地图边界外以及提交下一条命令时清除临时查看，避免旧悬停/长按文字持续遮挡位置行。

## 2. 全部去向变化与保留调用点

**本次改变消息去向的生产调用点共 1 处**：

| web 调用点 | 原去向 → 新去向 | CE 出处 |
|---|---|---|
| `Game.bindDungeonFeatureEffects().flavor`，`df.flavor` | `logger.log(..., '#aaaaaa')` → `updateFlavorText()` 设置显示态；仍仅作用于玩家所在格且非悬浮 | `Architect.c:3250–3253` 调 `flavorMessage(tileFlavor(...))`；`IO.c:3425–3442` 只绘制 `ROWS - 2`，不写消息存档 |

新增的回合/行进/显示/读档刷新入口此前没有写日志，因此不是额外消息迁移。抽取 `describeLocation` 保持悬停的实体、物品、记忆、标牌和未知格规则。

逐项确认以下真正消息仍写 `logger`，未因键名含 `flavor` 被误迁移：

| 保留调用点 | CE 消息性质 |
|---|---|
| `bindDungeonFeatureEffects().describe` | `Architect.c:3370–3372` 调 `message(feat->description, 0)` |
| `playerFalls()` 的 `fall.flavor_chasm`、`fall.flavor_trapdoor`、`fall.flavor_hole`、`fall.plunge` | `Time.c:1127–1134` 调 `message(tile.flavorText, REQUIRE_ACKNOWLEDGMENT)` / `message("You plunge downward!", ...)` |
| 玩家战斗 `combat.hit/miss/backstab/lunge_hit/defeat` 等 | `Combat.c` 的 `combatMessage` 经 `displayCombatText`（`:1590–1614`）进入 `message`；不是 `flavorMessage` |
| `pickUpItem()` 的 `item.pickup` / 金币消息 | `Items.c:875–908` 经 `messageWithColor`；`IO.c:3414–3422` 转入 `message` |
| `update()` 的 `vision.notice_item`、可见怪物消息及自动探索发现提示 | 本次保留 web 原来的消息入口；CE 的发现物品/地形通知示例为 `Movement.c:2594–2618` 的 `messageWithColor`。此轮不扩大或缩小 web 原有触发范围 |

`IO.c:3451` 的 `message` 是消息存档入口，与 `flavorMessage` 明确分离。

## 3. 新增守卫与浏览器验证

`src/test/x4b_flavor_text.test.ts` 共 9 项：

1. 同步、动画各一例：移动踩倒植被、打开门，位置行正确、`logger.log` 零调用；继续走到地板及等待会刷新。
2. DF 当场刷新；别处 DF、悬浮玩家不覆盖该瞬间的描述；DF `description` 仍进日志。
3. 自动行进抵达、路径阻挡终止均回到当前位置描述，下条命令清除查看。
4. 实际战斗、发现物品、拾取仍产生日志及存档条目。
5. 重复刷新/悬停不改变双 RNG、快照或录制事件；读档/新局重建且字段不入快照。
6. 气体地形描述及悬浮位置描述复用正确，刷新不覆盖当前查看也不消费 RNG。
7. 踩植被、开门和等待录像穿插刷新/悬停后完整零 OOS 回放。
8. 桌面及紧凑 HUD 的描述优先级和既有显示行连接守卫。

首次专项 9/9 通过；首次类型检查发现新增测试直接访问 private 方法/字段，仅修正测试侧类型装配后类型检查通过，没有改生产可见性或旧守卫。

浏览器使用项目现有 Playwright，`browser-check.mjs` 构造局部地形/物品夹具，再通过键盘移动、真实鼠标悬停和触屏长按事件验证。桌面 1440×900、手机 390×844 均通过；拾取/发现留日志，地形描述不在日志中，查看优先及恢复正确。页面错误 0，console error 0；状态在 `x4b-evidence/browser-results.json`。已目视检查整页截图，布局与文字均可见。

PNG 全部仅在本地 `ai_docs/reports/x4b-evidence/`：`desktop-foliage.png`、`desktop-door.png`、`desktop-hover.png`、`mobile-foliage.png`、`mobile-door.png`、`mobile-hover.png`。技能客户端另外运行过一次；其 canvas 导出 `shot-0.png` 为黑图，不计视觉通过，已用上述有头整页截图验证。开发服务及 Chromium 的沙箱启动限制经自动审批后运行，不涉及远端服务。

## 4. UR4 黄金 trace 归因与登记

- 初跑 UR2、UR3 原黄金通过；UR4 失败只显示被移除的 `df.flavor` 日志。
- **单变量反事实**：保留新 UI、合同和测试，仅临时将 `src/engine/Core/Game.ts` 替换为 HEAD 原件，原 UR4 夹具通过（1/1，退出 0）；随后逐字节恢复 X4b 生产文件。记录：`x4b-evidence/ur4-counterfactual.log`。
- 依据任务授权，按原方法 `UR4_CAPTURE=1 npx vitest run src/test/u_r4_trace.test.ts --maxWorkers=1` 重录一次，未改 trace 测试、比较器或采样方法。
- `death` 的 continuous/animated 两组各两行，共 20 个 JSON 差异路径，全部是移除 `You are standing on 地面.` 的 events/log/快照内 logger 消息以及 `nextId: 3 → 2`。其它场景、所有非日志快照字段、tick、双 RNG、录制命令逐字段相同。
- SHA-256：旧 `9b2232aee7c97a9945fc32d62442f465d98408407a471ae708f93b8c0bb44e8c`；新 `45ddb6327018250393b582b6ec6565ad4d8cf56aa7e605d252ab6366b90b0565`。详见 `x4b-evidence/ur4-diff.json`。
- UR2、UR3 和生成基线未改；未修改任何既有测试的断言、前提或门限。

## 5. §3 中档门禁

从 `src/` 全目录反查，而非仅依赖点名测试：49 个文件引用 `df.flavor/logger/hoveredText/MessageStrip/Sidebar`；`src/test/` 宽口径匹配 `Game.ts/Sidebar.vue/MessageStrip.vue` 的 33 个文件全纳入（含注释匹配，实际读源码的守卫不遗漏）。本轮改到 `GameCanvas.vue`，额外加入其引用和 `useGameHud` 的测试，再并入任务逐项点名集合，合计 74 个文件。`src/data/hordes.test.ts` 只在说明注释提到 `Game.ts`，无源码读取，不属于守卫；完整检索 223 个测试文件，必须集合遗漏为 0（见 `scope-audit.json`）。

实际命令：

```sh
npx vue-tsc -b
npm run build
npx vitest run <下面逐项列出的 74 文件> --maxWorkers=4 \
  --reporter=default --reporter=json \
  --outputFile=ai_docs/reports/x4b-evidence/gate-results.json
npm run test:drift
```

| 门禁 | 结果 |
|---|---|
| `npx vue-tsc -b` | 退出 0 |
| `npm run build` | 退出 0；保留既有 bundle 大小提示，dist 不交付 |
| 74 文件定向 Vitest（含 UR2/3/4、U03 和新增守卫） | 74/74 文件通过；1318 passed、4 既有 skipped、1 既有 todo、0 failed；退出 0，1588.68 秒 |
| `npm run test:drift` | 1 文件 / 1 项通过，退出 0，79.45 秒；生成基线未改 |
| 输入冻结 / LF / diff / 未暂存检查 | 403 个冻结输入零变化；CRLF=0；diff 检查通过；暂存文件 0 |

门禁运行于 2026-09-28 13:16:58–13:43:27（Asia/Shanghai）。实际执行集合与计划 74 文件逐项相等，反查必选集合遗漏 0；生产、测试、合同及黄金输入共 403 个文件在运行前后 SHA-256 零变化。4 个 skipped 属于既有 `p2_1_tick_architecture.test.ts`，1 个 todo 属于既有 `smoke.test.ts`；本次未新增跳过项。

完整执行文件与逐文件结果（命令原始参数在 `x4b-evidence/gate-summary.json`，全部断言结果在 `gate-results.json`）：

| 文件 | passed | skip | todo | 结果 |
|---|---:|---:|---:|---|
| `src/test/ai_1_scent_tracking.test.ts` | 5 | 0 | 0 | 通过 |
| `src/test/b_1_weapon_specials.test.ts` | 16 | 0 | 0 | 通过 |
| `src/test/b_1a_identification.test.ts` | 34 | 0 | 0 | 通过 |
| `src/test/b_2_throwing.test.ts` | 16 | 0 | 0 | 通过 |
| `src/test/blueprint_center.test.ts` | 7 | 0 | 0 | 通过 |
| `src/test/c_3_walls_doors.test.ts` | 15 | 0 | 0 | 通过 |
| `src/test/c_4a_terrain_catalog.test.ts` | 30 | 0 | 0 | 通过 |
| `src/test/c_4b_dungeon_feature.test.ts` | 31 | 0 | 0 | 通过 |
| `src/test/c_5_fall_subsystem.test.ts` | 13 | 0 | 0 | 通过 |
| `src/test/c_7_lighting.test.ts` | 28 | 0 | 0 | 通过 |
| `src/test/f_2b_creature_burning.test.ts` | 13 | 0 | 0 | 通过 |
| `src/test/fe_1_touch.test.ts` | 16 | 0 | 0 | 通过 |
| `src/test/g_3_gas_effects.test.ts` | 26 | 0 | 0 | 通过 |
| `src/test/i_1_interaction.test.ts` | 6 | 0 | 0 | 通过 |
| `src/test/monster_stats_effect.test.ts` | 2 | 0 | 0 | 通过 |
| `src/test/p1_20_item_placement.test.ts` | 1 | 0 | 0 | 通过 |
| `src/test/p1_24_death_sink.test.ts` | 13 | 0 | 0 | 通过 |
| `src/test/p1_27_remove_drowning.test.ts` | 9 | 0 | 0 | 通过 |
| `src/test/p1_28_flag_channel.test.ts` | 14 | 0 | 0 | 通过 |
| `src/test/p1_30_i18n_gate.test.ts` | 16 | 0 | 0 | 通过 |
| `src/test/p1_33_machine_chokepoint.test.ts` | 7 | 0 | 0 | 通过 |
| `src/test/p1_34_loopmap_reset.test.ts` | 2 | 0 | 0 | 通过 |
| `src/test/p1_37_machine_flag_i18n.test.ts` | 9 | 0 | 0 | 通过 |
| `src/test/p1_42_secret_door_search.test.ts` | 14 | 0 | 0 | 通过 |
| `src/test/p2_0_seeded_rng.test.ts` | 6 | 0 | 0 | 通过 |
| `src/test/p2_1_tick_architecture.test.ts` | 6 | 4 | 0 | 通过 |
| `src/test/p2_4_animation_cadence.test.ts` | 13 | 0 | 0 | 通过 |
| `src/test/p2_6_display_settings.test.ts` | 19 | 0 | 0 | 通过 |
| `src/test/p4_6_attack_geometry.test.ts` | 14 | 0 | 0 | 通过 |
| `src/test/p4_7_player_weapon_geometry.test.ts` | 17 | 0 | 0 | 通过 |
| `src/test/p4_8_scent_map.test.ts` | 14 | 0 | 0 | 通过 |
| `src/test/r_1_appearance.test.ts` | 45 | 0 | 0 | 通过 |
| `src/test/scroll_effects.test.ts` | 20 | 0 | 0 | 通过 |
| `src/test/smoke.test.ts` | 3 | 0 | 1 | 通过 |
| `src/test/u21c_flare_sidebar.test.ts` | 3 | 0 | 0 | 通过 |
| `src/test/u24_hardcoded_text.test.ts` | 3 | 0 | 0 | 通过 |
| `src/test/u_00_new_run.test.ts` | 17 | 0 | 0 | 通过 |
| `src/test/u_03_whole_run_snapshot.test.ts` | 14 | 0 | 0 | 通过 |
| `src/test/u_06_monster_damage.test.ts` | 37 | 0 | 0 | 通过 |
| `src/test/u_11_corpse_learning.test.ts` | 91 | 0 | 0 | 通过 |
| `src/test/u_15b2_ring_birth.test.ts` | 15 | 0 | 0 | 通过 |
| `src/test/u_15f_food.test.ts` | 4 | 0 | 0 | 通过 |
| `src/test/u_17a_df_transaction.test.ts` | 27 | 0 | 0 | 通过 |
| `src/test/u_27_recording.test.ts` | 5 | 0 | 0 | 通过 |
| `src/test/u_r2_trace.test.ts` | 1 | 0 | 0 | 通过 |
| `src/test/u_r3_trace.test.ts` | 1 | 0 | 0 | 通过 |
| `src/test/u_r4_trace.test.ts` | 1 | 0 | 0 | 通过 |
| `src/test/ui_1_rendering.test.ts` | 32 | 0 | 0 | 通过 |
| `src/test/ui_2_protection.test.ts` | 11 | 0 | 0 | 通过 |
| `src/test/v_1a_blueprint_items.test.ts` | 8 | 0 | 0 | 通过 |
| `src/test/v_2b_3_wired.test.ts` | 28 | 0 | 0 | 通过 |
| `src/test/v_2b_4_altars.test.ts` | 36 | 0 | 0 | 通过 |
| `src/test/v_2b_5_dormant.test.ts` | 17 | 0 | 0 | 通过 |
| `src/test/v_2b_6_keys.test.ts` | 18 | 0 | 0 | 通过 |
| `src/test/v_2b_7_features.test.ts` | 22 | 0 | 0 | 通过 |
| `src/test/v_2b_9c_effects.test.ts` | 10 | 0 | 0 | 通过 |
| `src/test/w_10_poison.test.ts` | 38 | 0 | 0 | 通过 |
| `src/test/w_15_shielding.test.ts` | 57 | 0 | 0 | 通过 |
| `src/test/w_23_negation.test.ts` | 42 | 0 | 0 | 通过 |
| `src/test/w_2_arcana_submission.test.ts` | 30 | 0 | 0 | 通过 |
| `src/test/w_6_arcana_recharge.test.ts` | 28 | 0 | 0 | 通过 |
| `src/test/w_7_arcana_enchantment.test.ts` | 30 | 0 | 0 | 通过 |
| `src/test/x2a_recording_checkpoint.test.ts` | 4 | 0 | 0 | 通过 |
| `src/test/x2b_terrain_derivation.test.ts` | 20 | 0 | 0 | 通过 |
| `src/test/x2d_scroll_equipment.test.ts` | 34 | 0 | 0 | 通过 |
| `src/test/x2i_discovery_text.test.ts` | 4 | 0 | 0 | 通过 |
| `src/test/x2i_i18n_flow.test.ts` | 1 | 0 | 0 | 通过 |
| `src/test/x2j_monster_ai.test.ts` | 38 | 0 | 0 | 通过 |
| `src/test/x2k_lifecycle.test.ts` | 16 | 0 | 0 | 通过 |
| `src/test/x2m_lighting.test.ts` | 18 | 0 | 0 | 通过 |
| `src/test/x3a_live_iteration.test.ts` | 23 | 0 | 0 | 通过 |
| `src/test/x3b_display_recording.test.ts` | 4 | 0 | 0 | 通过 |
| `src/test/x4a_movement_rendering.test.ts` | 21 | 0 | 0 | 通过 |
| `src/test/x4b_flavor_text.test.ts` | 9 | 0 | 0 | 通过 |

## 6. 交付检查

- 新增守卫最终 9/9；UR2/UR3 原黄金、经单变量归因后的 UR4、U03、录像/i18n/UI/触屏守卫均在上述同轮集合内通过。
- `git diff --check` 通过；本次文本改动不含 CRLF。既有守卫和比较器未修改。
- 未修改生成或 RNG 代码，生成基线未改；仅 UR4 黄金按已登记的日志去向变化更新。
- 所有 PNG 位于指定本地目录并被 `.gitignore` 覆盖，没有 PNG 或 dist 出现在待交付文件中。
- Playwright 浏览器和本次 Vite 服务已关闭；无未完成工作。未暂存、未提交、未推送。
