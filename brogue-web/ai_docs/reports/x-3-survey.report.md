# X-3：交互与自动行动层 CE 对照勘察（只读）

2026-09-28，云端会话（Linux）；基线 `main` = `82b8182f554bbca7040526d2890086111a976d2d`。任务书：[x-3-survey.prompt.md](../tasks/x-3-survey.prompt.md)。

**结论：交互层与 CE 的偏差集中且成体系。** 共登记 **47 条**差异：**S1 12 条、S2 18 条、S3 17 条**。最危险的是三类：

1. **移动防呆几乎全部缺失**：已知岩浆直接走进去就死；踩火、毒气、压力板都不问；撞盟友是攻击而不是换位，撞被俘怪是攻击（背刺必中，等于秒杀）而不是“释放俘虏”确认；已装备的诅咒物可以丢掉，也可以被换下。
2. **自动行动没有 CE 的 `rogue.disturbed` 语义**：web 只在“看见新怪物/新物品”时停。已经看见过的怪物连续命中玩家、地形伤害、各类状态消息都不会打断旅行或探索；另外，自动行进期间所有 `confirm` 由前端钩子自动放行。
3. **按键表与 CE 不一致**：`>`/`<` 在正常游玩中是死键（永远提示“这里没有楼梯”）；没有 `Z` 长休息、Ctrl-S 长搜索、Shift 奔跑；`x`/`X` 的含义与 CE 对调；Esc/空格停不下自动探索。

本报告只读。`src/`、`scripts/` 未改，未提交任何测试。探针只放在临时目录 `brogue-web/tmp-x3/`（未跟踪），跑完即删；源码副本与输出在 [x-3-evidence/](x-3-evidence/)。

## 0. 方法、口径与验证

- **路径简写**：`G`=`src/engine/Core/Game.ts`，`TC`=`src/engine/Core/TimeCoordinator.ts`，`In`=`src/engine/Input.ts`，`GCv`=`src/components/GameCanvas.vue`，`IO`=`src/components/InventoryOverlay.vue`，`SB`=`src/components/Sidebar.vue`，`L`=`src/engine/Systems/Logger.ts`；`C/`=`../BrogueCE-master/src/brogue/`。行号对应基线 HEAD。
- **严重度**：S1 影响游玩决策或安全；S2 明显体验偏差；S3 细节。**门禁档位**：轻＝纯前端；中＝引擎非规则（消息、显示、自动行动流程）；全量＝规则、生成、RNG、存档。
- **项目裁决不计为差异**：不求同种子逐骰一致、不兼容 `.broguerec`、不做旧档迁移、不做无障碍。
- **判定依据**：每条都给出 CE 出处（文件:行）和 web 出处（文件:行）。标“实测”的条目有探针复现（§7）；标“代码证”的由源码缺失或分支直接证明（例如 grep 全库零消费者）；只凭推测的标“待证”。
- **测试执行**：只跑了 4 个临时探针文件（`npx vitest run tmp-x3/<file>`），共 17 个 it，全部通过（这些探针只打印观测值，不做断言）。没有跑完整 `npm test`，也没有跑类型检查或构建，因为本轮不改产品代码。
- **CE 版本注意**：本树 CE 带中文分支（`strcmp(tr("Health"),"Health")`）。本报告引用的是英文分支文案，中文分支语义相同。

## 1. 总表

| 编号 | 类 | 严重度 | CE 出处 | web 出处 | 现象 | 建议修法 | 门禁 |
|---|---|---|---|---|---|---|---|
| X3-A01 | A | S2 | `C/IO.c:2496-2513`；`C/Movement.c:2492-2506,1927-2015` | `In:121-129`；`G:3005-3048`；`CommandBar.vue:21-22` | `>`/`<` 只在“玩家站在楼梯格上”时生效。web 走进楼梯格会立即换层，玩家永远站不上去，所以两个键恒提示 “There are no stairs down here.”（实测 P5）。CE 的语义是**前往已发现的楼梯**，找不到时提示 “I see no way down.” | 新增 `travel_stairs` 命令：`rogue.downLoc`/`upLoc` 已发现就 `setAutoPath` 过去，走进楼梯格由既有入口换层；未发现时给 CE 文案；已在目的地时提示 “you are already there.” | 中 |
| X3-A02 | A | S2 | `C/IO.c:2521-2545`；`C/Time.c:2328-2392,2394-2430` | `In:70-72,95-98`；`CommandBar.vue:14-15` | 缺 `Z` autoRest（休息到满血或状态解除，最多 100 回合；`dangerChanged` 或按键打断）；缺 Ctrl-S 连搜 5 回合（每步可被打断）；`z` 键未绑定（`.` 可代替，见 A05） | 引擎新增 `auto_rest`、`search_long` 两个循环命令，每回合检查 disturbed（依赖 B01）；把 `z`、`Z`、Ctrl-S 键绑上，触屏命令栏加按钮 | 中 |
| X3-A03 | A | S2 | `C/IO.c:2700-2711`；`C/Movement.c:28-62,2419-2436` | `In:46-67` | 缺 Shift/Ctrl+方向“奔跑”（playerRuns：一直走到撞物，或侧向通路变化、相邻出现物品或非盟友怪物时停）；数字小键盘方向也未绑定 | 引擎新增 `run` 命令，按 CE 的 cardinalPassability 和 `isDisturbed` 判停；`In` 识别 `shiftKey`/`ctrlKey` 与 `Numpad1-9` | 中 |
| X3-A04 | A | S3 | `C/Rogue.h:1197`；`C/IO.c:2603-2605,2317-2367` | `In:115-120`；`G:1878-1939` | CE 的 `x` 是自动探索；web 的 `x` 是“检视最近的怪物或物品，都看过后退化为自动探索”，`X` 才是探索。键义与 CE 对调，而且是一个混合命令 | `x` 改回探索；检视功能改用鼠标或光标（CE 没有专门的检视键）或另择空闲键。此项需用户裁决键位 | 轻 |
| X3-A05 | A | S3 | `C/IO.c:2521-2527` | `In:95-98`；`G:3050-3059` | `.` 在 web 是 `wait_or_stairs_down`（站在楼梯上时下楼），CE 的 PERIOD 只是休息。由于玩家站不上楼梯，实际上总等于休息，属于死代码 | A01 修好后，`.` 回归纯休息，删除这个复合分支 | 轻 |
| X3-A06 | A | S3 | `C/IO.c:2547-2600,2606-2660`；`C/Rogue.h:1161-1215` | `In:36-133` | 未绑定的 CE 命令键：`e/r/d/c/R/w/T/M/\/]/F`（`a`、`t` 只打开背包，不按类别预筛）；`S` 在 web 是搜索，CE 是存档退出 | 把 `e/r/d/c` 接成“打开背包并预选该操作”，`w`、`M` 按需实现；`S` 不再映射到搜索（避免与 CE 习惯冲突） | 轻 |
| X3-A07 | A | S3 | `C/IO.c:2435-2452`；`C/Movement.c:1968-2000` | `GCv:705,718-720,729-748` | CE 右键打开背包、单击先显示路线再确认（“Travel this route? (y/n)”）；web 右键是检视，单击远处立即出发。相邻格和 Ctrl 单击的语义一致 | 保持 web 单击即走（移动端友好）可作项目裁决；右键打开背包可选 | 轻 |
| X3-A08 | A | S2 | `C/Items.c:3925-3958`（strengthCheck） | `G:3469-3488`；`src/entities/Player.ts:83-103` | 装备力量不足的武器或护甲时，CE 提示 “You can barely lift…; N more strength would be ideal.” / “You stagger under the weight…”；web 无任何提示 | 在 `equipItem` 成功后按 CE `strengthCheck` 出消息（只出消息，不改数值） | 中 |
| X3-A09 | A | S2 | `C/Items.c:836-935`（满包分支 `:930-934`）；`C/Items.c:8386,6857,6873`；`C/Movement.c:2175,2235` | `G:10158-10169,3500-3526,9572-9602` | 背包满时走上物品格**静默**不拾取（实测 P12），CE 会提示 “Your pack is too full to pick up X.” 并打 `ITEM_PLAYER_AVOIDS`；丢下的物品和投掷后落地的物品（CE 未命中的武器除外）也不打 AVOIDS，自动探索会立刻走回去把它捡起来（实测 P11） | 丢弃、投掷落地（未命中的武器除外）和满包时给物品加 `ITEM_PLAYER_AVOIDS`，探索目标与自动拾取都尊重它；补满包消息 | 中 |
| X3-A10 | A | S3 | `C/Items.c:3983-4003,8319-8327,8352-8357,8393-8396` | `G:3469-3526`；`Player.ts:92-101` | 细节文案与分支：“you are already wearing that ring.”；两枚戒指时 CE 提示选一枚替换，web 直接失败；“your X was not equipped.”；站在 T_OBSTRUCTS_ITEMS 格时丢弃被拒（“There is already something there.”），web 不检查 | 按 CE 分支补齐 | 中 |
| X3-B01 | B | S1 | `C/IO.c:3464`；`C/Combat.c:1179-1181,1295`；`C/Time.c:350,425,446,492,503,613,1138`；`C/Items.c:843`；`C/Movement.c:2452` | `G:10466-10485,10487-10533`；`G:9846-9855` | web 没有 disturbed 概念，只在“新怪物、新物品进入视野”时停。**已见过的怪物连续命中玩家，旅行照走**（实测 P6：豺狼命中 4 次，HP 200→188，走了 8 步，剩余路径 18 格未停）；地形伤害、毒、麻痹、燃烧、坠落、发现秘密、任何状态消息都不打断 | 引擎加 `disturbed` 标志：玩家受到攻击（含未命中）、受伤、上述地形或状态效果、发现秘密时置位，并在 `logger.log` 的“消息”通道统一置位（呼应 CE `message()`）。`stepAutoPathInner` 在前置和后置检查中读取它，每个自动命令开始时清零 | 中 |
| X3-B02 | B | S1（已知） | `C/Movement.c:2390-2417,2286-2316` | `G:9544-9549,9551-9566,10493-10494` | 探索遇到相邻敌人时 web 每步无条件攻击，没有 CE `startFighting` 的 `currentHP > expectedDamage` 保命刹车、`disturbed` 打断和 `blockCombatText`；幻觉时的 `tillDeath` 也不同 | 按 CE 实现 startFighting 循环（依赖 B01 的 disturbed） | 中 |
| X3-B03 | B | S2 | `C/Time.c:2764-2797`；`C/Movement.c:2592-2616` | `G:10466-10485` | web 每看见一件新物品就停止探索和旅行；CE 只有钥匙（以及 B04 的地形）才打断，其余物品由探索图自然纳入目标。另外 web 看见**新盟友**也会停，CE 排除了 `MONSTER_ALLY` | 删除“新物品即停”，改为钥匙和 B04 地形；怪物分支排除盟友 | 中 |
| X3-B04 | B | S2 | `C/Movement.c:2605-2616`；`C/Globals.c` 楼梯、传送门、锁门等行的 `TM_INTERRUPT_EXPLORATION_WHEN_SEEN` | `src/engine/Map/TerrainCatalog.ts:108,266-342`（有旗标、零消费者） | 自动行进中首次看见楼梯、传送门、锁门等时，CE 提示 “you see the downward staircase.” 并停；web 旗标存在但从未被读取 | 在视野更新中按 CE 条件（自动行进中、首次 DISCOVERED、非魔法测绘）出消息并置 disturbed | 中 |
| X3-B05 | B | S2 | `C/Movement.c:2345-2351,1867-1869`；`C/IO.c:2366-2375` | `G:2943,2965-2976`（先于 `:3067` 的 stopAutoTravel 就返回了） | Esc 与空格停不下自动探索或旅行（实测 P13：按键后剩余路径 27 格不变，随后又走了 3 步）。CE 自动行进中按任何键都会中断。移动键、点击和 `i` 可以停或暂停 | `escape`、`cancel_target` 分支先 stopAutoTravel；打开 `D`/`?` 参考屏时也显式停止 | 中 |
| X3-B06 | B | S2 | `C/Time.c:2468-2872`（`do … while (player.status[STATUS_PARALYZED])`） | `G:2945-2956` | CE 麻痹期间自动连续过回合，玩家无需按键；web 每过一回合都要一次输入，并记一条 “You are paralyzed and cannot act!”（实测 P9，×N 刷屏） | 在 playerTurnEnded 末尾按 CE 循环推进麻痹回合（录制上由一个命令覆盖多回合） | 全量 |
| X3-B07 | B | S3 | `C/Time.c:318-335`；`C/Movement.c:700-711,1404-1418` | `G:8848-8860,6102-6108` | CE 在 `automationActive` 期间不打 “stuck fast”、“struggle”、“vomit” 这类消息（“Don't interrupt exploration with this message.”）；web 照打 | B01 落地后，这些消息在自动行进期间改为抑制 | 中 |
| X3-C01 | C | S2（X4b 在修） | `C/IO.c:3425-3444`；`C/Architect.c:3252`；`C/Time.c:63-81,2876`；`C/RogueMain.c:170` | `G:9184-9190` | DF 地形描述用 `flavorMessage` 写到位置描述行、不入存档；web 写进日志刷屏。CE 每回合都用 `updateFlavorText` 刷新该行；开局 “The doors to the dungeon slam shut behind you.” 也只在这一行 | 见 X4b 任务书；另补开局 flavor | 中 |
| X3-C02 | C | S2 | `C/Time.c:2764-2797`；`C/Movement.c:2592-2604` | `G:2527-2553` | web 每次有怪物或物品进入视野都记 “You see/sense a X.” / “You notice a X.”，**含盟友、非自动行进、所有物品**（实测 P8：盟友和睡着的老鼠各记一条）。CE 只在自动行进中、非盟友怪物时经 `combatMessage` 出 “you see a X”；物品只提示钥匙 | 按 CE 条件收窄；这条消息也就是 B01 的打断源 | 中 |
| X3-C03 | C | S3 | 同上 | `G:10469-10480` | web 停止时再追加一条自创的 “You spot a X and stop exploring/moving.”，与 C02 叠成两条；CE 只有一条 | 删去自创文案，由 C02 的消息承担 | 中 |
| X3-C04 | C | S2 | `C/IO.c:3511-3515`；游戏内 `REQUIRE_ACKNOWLEDGMENT` 21 处（清单见 §4.2） | `L:30-50`；`SB`、`MessageStrip.vue` | web 没有 “--MORE--” 或强调确认：落入岩浆、麻痹、压力板、坠落、饥饿虚弱/昏厥、漂浮警告、符文提示、识别或附魔卷轴自述等关键消息，与普通日志同级滚动 | Logger 增加 `acknowledge` 标志：前端高亮或弹条并要求点击；自动行进遇到这类消息即停（与 B01 合并） | 中 |
| X3-C05 | C | S1 | `C/Time.c:2878-2911` | 全库零实现（grep “solid ground”、“no return”、“mapToShore” 在 `src/engine`、`src/entities` 无消费者） | 漂浮或免火状态下站在深水、岩浆、深渊上方时，CE 按 mapToShore 预警 “better head back to solid ground!” / “you're past the point of no return!”（需确认）；web 完全没有 | 实现 mapToShore 距离（或复用 safety map 的最近安全格距离）与 `receivedLevitationWarning` 闩锁 | 中 |
| X3-C06 | C | S2 | `C/Time.c:2805-2825` | 全库零实现（`RUNIC_HINTED` 只在拆除、重铸时清位） | 首次直视到屠戮符文武器或免疫符文护甲对应类别的怪物时，CE 提示 “the runes on your X gleam balefully / glow protectively.” 并打 `ITEM_RUNIC_HINTED`；web 无 | 需要怪物类别名册（`monsterClassCatalog`，web 缺，见 `G` 注释 I-1/UI-2）；名册就绪后按 CE 实现 | 全量 |
| X3-C07 | C | S3 | `C/IO.c:3451-3515`；`C/Rogue.h:120-124` | `L:30-50` | web 只合并**相邻**的相同文本，没有回合概念，存档上限 50 条；CE 同回合内任意位置的重复都会折叠（FOLDABLE 另允许跨回合折叠到最后一条），计数上限 100，存档 `MESSAGE_ARCHIVE_ENTRIES` 条，且没有 `M` 消息历史屏 | Logger 记录回合号，按 CE 规则折叠；上限对齐；可选历史视图 | 轻 |
| X3-C08 | C | S3 | `C/Combat.c:1556-1615,1369-1397,1350-1363` | `G:6946-6975`；`src/entities/Monster.ts:1338,1763,1926` | CE 战斗文本先缓冲，在回合末 flush 并可用分号拼接；动词按伤害比例取（attackVerb），不显示数字；看不见的战斗提示 “you hear combat in the distance”；startFighting 期间非致命命中不出文本。web 每击一行，带伤害数字和武器名，没有远处战斗提示 | 保留数字可作项目裁决；至少补上 blockCombatText 抑制（与 B02 同单元）和远处战斗提示 | 中 |
| X3-C09 | C | S3 | `C/Time.c:2211-2325` | `G:6653-6669` | 状态到期文案：缺加速、减速、免火到期（“your supernatural speed fades.”、“your normal speed resumes.”、“you no longer feel immune to fire.”）；自创 `regenerating_off`；混乱与幻觉合并成一句（CE 各有一句） | 逐条对 CE 补齐或改写 | 中 |
| X3-C10 | C | S3 | `C/Time.c:927-970` | `G:6694-6711` | 饥饿提示缺 “ and have no food” 后缀，也缺相应的需确认级别 | 按包内食物数拼后缀；需确认级别随 C04 一起做 | 中 |
| X3-C11 | C | S3 | `C/Items.c:878-906`；`C/Items.c:8386-8388` | `G:10168,3450,3522` | 拾取文案：CE 是 “you now have X (c).”（带背包字母）和 “you found N pieces of gold.”；web 是 “You picked up X.” | 对齐 CE 文案并带字母 | 中 |
| X3-C12 | C | S3 | `C/Movement.c:2437-2455`；`C/Globals.c:624`（DF_SHOW_DOOR 无文案） | `G:9846-9855` | 发现暗门时 web 自创 “You discovered a hidden door!”；CE 只有闪光和 disturbed，没有文案 | 删除自创文案；打断由 B01 提供 | 中 |
| X3-C13 | C | S3 | `C/IO.c:2359-2366`；`C/Movement.c:1959,2012` | `G:9600,10440,6106`；`G:10335,10361`（hover 的“未知”、“你”） | 硬编码中文 `defaultValue` 和参数：“这里没有什么可探索的了。”（CE “I see no path for further exploration.”）、“无法到达该位置。”（CE 分成 “You have not explored that location.” 和 “No path is available.” 两种）、呕吐消息的 `name: '你'`。CE 另有 “It's too dark to explore!”，web 无 | defaultValue 改用 CE 英文并进 i18n；补 “too dark” 与“未探索/无路径”两种情形 | 轻 |
| X3-D01 | D | S1 | `C/Movement.c:1297-1308` | `G:3326-3340`；`G:9634-9646` | **已知岩浆直接走进去**：CE 拒绝移动并提示 “that would be certain death!”（不耗回合）；web 移动后立刻死亡（实测 P3：“You are incinerated by the lava!”，isGameOver=true） | 在 `canMoveTo` 分支前按 CE 条件拒绝（DISCOVERED/MAGIC_MAPPED、未漂浮、未混乱、未免火、无缠绕、非 secret） | 中 |
| X3-D02 | D | S1 | `C/Movement.c:1323-1334` | `G:3326-3340` | 踩入可见火焰没有 “Venture into flame?” 确认（实测 P4：直接 “You catch fire!”） | 按 CE 条件加 requestConfirm | 中 |
| X3-D03 | D | S1 | `C/Movement.c:1336-1347` | 同上 | 踩入混乱或麻痹气体没有 “Venture into dangerous gas?” 确认（呼吸符文护甲豁免）；代码证：web 全库无此文案 | 同上 | 中 |
| X3-D04 | D | S1 | `C/Movement.c:1349-1365` | 同上；`G:9923-9927` | 踩已知陷阱或压力板没有 “Step onto the pressure plate?” 确认；代码证：web 全库无此文案 | 同上 | 中 |
| X3-D05 | D | S1 | `C/Movement.c:1173-1180,1218-1219,1446-1461`；`C/Movement.c:812-829` | `G:3158-3168,3184-3203`；`G:6798-6830` | **撞盟友等于攻击盟友**（实测 P1：猴子 HP 12→9，没有换位，也没有提示）。CE 与非 discordant 盟友**换位**，攻击 discordant 盟友前确认 “Are you sure you want to attack X?” | 在 blockingMonster 分支前：盟友且非 discordant 时走换位（含 `monsterAvoids` 回退落点）；discordant 时确认 | 全量 |
| X3-D06 | D | S1 | `C/Movement.c:1193-1215` | `G:3184-3203`；`src/engine/Combat/Combat.ts:168,427` | **撞被俘怪等于攻击**，且俘虏必中、可背刺（实测 P2：15 点背刺直接击杀地精）。CE 会先确认 “Free the captive X?”，确认后 freeCaptive，耗时 attackSpeed | 在攻击分支前拦截 `isCaged`，确认后调用既有 `freeCaptive`，耗时照 CE | 全量 |
| X3-D07 | D | S2 | `C/Movement.c:778-806,837-852` | `G:3184-3203`；`G:6981-6995`（降级只在命中后执行，没有事前确认） | 攻击酸性怪（会降级武器）前，CE 确认 “Degrade your X by attacking Y?”（受保护武器、对应屠戮符文、混乱或幻觉时免问）；web 直接攻击 | 按 CE `abortAttack` 条件确认，拒绝时取消按键并置 disturbed | 中 |
| X3-D08 | D | S1 | `C/Items.c:8374-8379,8547-8549,8640-8651` | `G:3469-3526`；`Player.ts:83-113`；`IO:246-252` | **诅咒装备可以绕开**：丢弃已装备的诅咒物会成功（实测 P7a）；装备另一件同类物品会把诅咒件换下（实测 P7b）；引擎 `unequipItem` 没有检查，只有背包 UI 拦了“卸下”一个入口 | 把 CE 的 `unequipItem(!force)` 诅咒检查下沉到引擎，equip、drop、unequip、throw 共用这一个门 | 全量 |
| X3-D09 | D | S2 | `C/Items.c:7101-7111` | `G:5822-5838` | 投掷已装备或已附魔（`timesEnchanted>0`）且只剩一件的物品时，CE 确认 “Are you sure you want to throw your X?”；web 无（代码注释自认 UI 债） | 在 `throwItemAt` 前加 requestConfirm | 中 |
| X3-D10 | D | S1 | `C/IO.c:2937-2946` | `src/App.vue:11-17`；`G:8258-8260` | 前端 confirm 钩子在 `isAutoTraveling()` 时**一律返回 true**；CE 只在 `autoPlayingLevel`（autopilot）或回放时放行。实测 P14：混乱状态下鼠标旅行，第一步的 “Risk stumbling into lava?” 被自动同意；同样位置手动移动则会提问 | 放行条件改为 `replayStatus==='playing'`；自动行进遇到确认时应先停止旅行再提问（或按 CE 让路径不穿过需确认的格） | 轻 |
| X3-D11 | D | S1 | `C/Movement.c:1097-1138`（只有混乱会随机方向）；`:837-843`（幻觉只影响 abortAttack） | `G:3124-3138` | **幻觉时 35% 随机方向“踉跄”是 web 自创**（实测 P10：40 次右移中 14 次偏航，“You stumble in a random direction!”），会额外消耗 RNG，并可能把玩家带进危险格；CE 幻觉不影响移动 | 删除该分支 | 全量 |
| X3-D12 | D | S3 | `C/Items.c:1390-1415`；`C/IO.c:2585-2587` | `IO:171-185` | 没有题字（inscribe）和 `R` relabel；CE 对已鉴定的武器、护甲等提供题字，对未鉴定的会先确认 “Inscribe this particular item instead of all similar items?” | 低优先；可作项目裁决 | 中 |
| X3-E01 | E | S2 | `C/IO.c:3722-3900` | `src/engine/UI/MonsterSidebar.ts:8-12`；`SB:118-132` | 侧栏只列怪物，按 Chebyshev 距离排序。CE 顺序是：玩家本人、脚下物品、悬停聚焦的实体置顶，然后按“直视优先、再间接感知”两轮、各自按欧氏距离平方列出怪物、**物品**、`TM_LIST_IN_SIDEBAR` 地形；并排除 `MONST_NOT_LISTED_IN_SIDEBAR` | 在 `visibleMonsterRows` 之外补物品与地形行、两轮排序、排除旗标、悬停聚焦 | 轻 |
| X3-E02 | E | S2 | `C/IO.c:4888-4923` | `SB:118-132` | 怪物行缺行为状态标签：(Captive)、(Helpless)、(Sleeping)、(Ally)、(Fleeing)、(Wandering)、(Worshiping)、(Guarding)、(Off balance)、(Hunting)、Negated。睡眠或游荡直接影响潜行和背刺决策 | 由 MonsterState、isCaged、leader 关系推导标签，纯显示 | 轻 |
| X3-E03 | E | S2 | `C/IO.c:4840-4887`；`C/IO.c:2588-2597` | `SB:78-116` | 侧栏缺玩家 `Str: cur/max  Armor: N`（未知护甲带 `?`）、`Gold`、`Stealth range`；`]` 潜行范围显示也缺 | 读引擎现值做纯显示（潜行范围用 `calculateStealthRange`） | 轻 |
| X3-E04 | E | S3 | `C/Movement.c:151-610`；`C/Time.c:63-81` | `G:10328-10415` | 悬停描述是简化版：没有 CE describeLocation 的主语、动词、介词句式（standing/flying/submerged、怪物携带物品、“you remember seeing X here” 的多种形态），也没有“位置描述行”（X4b 在补） | X4b 之后再按 describeLocation 细化 | 中 |
| X3-E05 | E | S3（待证） | `C/Time.c:2757-2797`（在 playerTurnEnded 内、updateVision 之后判定） | `G:2517-2553`（只在 `needsRender && onRenderRequested` 时更新 visibleMonsters/visibleItems） | 见怪、见物的判定及其消息挂在渲染路径上。headless 或无渲染的回放中，`visibleMonsters` 不更新，B01、B03 的打断源随之失效；对同一录像，有无渲染可能产生不同的停止点和日志 | 把“可见集合更新与首见判定”移入 playerTurnEnded 尾部（纯函数、零 RNG） | 中 |

**计数**：A 10（S2×5，S3×5）；B 7（S1×2，S2×4，S3×1）；C 13（S1×1，S2×4，S3×8）；D 12（S1×9，S2×2，S3×1）；E 5（S2×3，S3×2）。合计 **S1 12 / S2 18 / S3 17 = 47**。

## 2. A：按键命令表（逐命令）

以 CE `executeKeystroke`（`C/IO.c:2455-2722`）为清单。web 的按键分派在 `In:36-133`，命令执行在 `G:2904-3466`（`performPlayerAction`）和 `G:2631-2667`（`applyCommand` 的 `item:*`、`mouse_travel`、`auto_step`）。

| CE 键 | CE 行为（触发、耗时、停止、确认、失败文案） | web 现状 | 判定 |
|---|---|---|---|
| hjklyubn / 方向键 / 小键盘 | playerMoves，耗时 movementSpeed，攻击则 attackSpeed；防呆见 §5 | vi 键和方向键有；小键盘无 | A03（小键盘），D 系列 |
| Shift/Ctrl+方向 | playerRuns，停止条件见 A03 | 无 | A03 |
| `>` / `<` | proposeOrConfirmLocation 后 travel 到楼梯；“I see no way down/up.” | 只在站在楼梯上时生效，实为死键 | A01 |
| `z` / `.` / 小键盘 5 | 休息 1 回合，置 justRested | `.` 是休息与楼梯的复合命令；无 `z` | A02、A05 |
| `Z` | autoRest，见 A02 | 无 | A02 |
| `s` | manualSearch，第 5 连搜强度 160 并提示 “you finish your detailed search of the area.” | 一致（`G:9863-9889`），且 `S` 也映射为搜索 | 一致；`S` 见 A06 |
| Ctrl-S | 连搜 5 回合，每步 80ms 可被打断 | 无 | A02 |
| `x` | exploreKey：先打相邻敌人；“too dark”；“no path”；explore 循环 | `X` 探索，`x` 检视（A04）；“Not while you're confused/trapped.” 一致（`G:9532-9542`） | A04、B 系列 |
| `i` / 右键 | 背包 | `i`、`I` 打开背包；右键检视 | A07 |
| `e/r/d/a/t/c/R/w/T` | 各自带提示和类别过滤；装备、卸下、丢弃、投掷、使用都以 playerTurnEnded 收尾（整回合）；call 不耗回合 | `a`、`t` 打开背包（不过滤），其余键无；背包内按钮的耗时与 CE 一致（`G:3469-3526`） | A06、A08、A10、D08、D09 |
| `M` | 消息历史 | 无（侧栏显示最近 50 条） | C07 |
| `D` / `?` | 发现屏 / 帮助 | 有（`G:2905-2913`）；帮助内容与 CE 不同（列的是 web 键位） | 一致 |
| `\` / `]` / `F` / `G` | 真彩、潜行范围、成就、图块 | 无 | A06、E03 |
| `A` | autopilot（需确认） | 无 | 不计（调试向） |
| `S` / `Q` / `N` / `O` / `V` | 存档退出、放弃、新局等，均需确认 | 由主菜单承担 | 不计（平台差异） |
| 点击 / Ctrl 单击 | 光标、确认路线 / 直接前往 | 单击即走 | A07 |
| 自动拾取 | 走上即拾取，置 disturbed；满包时提示并打 AVOIDS | 走上即拾取；满包时静默 | A09 |

**耗时核对**（一致项，不计差异）：移动、攻击、钥匙开锁、祭坛取物收满 movementSpeed，突进和连枷按 attackSpeed（`G:3272-3400`）；装备、卸下、丢弃、拾取整回合；搜索整回合；吃东西在不饿时确认（`G:3851`，对应 `C/Items.c:7480-7490`）。

## 3. B：自动行动打断

### 3.1 CE 位置枚举（`rogue.disturbed`、`automationActive`、`pauseAnimation`、`isDisturbed`、`MB_ALREADY_SEEN`）

`grep -n disturbed C/*.c` 共 59 行，其中置位 true 的 37 处、清零或读取 22 处；`automationActive` 21 行；`MB_ALREADY_SEEN` 6 行；`isDisturbed` 2 行；自动循环中 `pauseAnimation` 返回值被用作打断的 7 处（`Movement.c:1877,1912,2348,2407`，`Time.c:2377,2386`，`IO.c:2537`）。全部逐一对照：

| CE 位置 | 含义 | web 等价 | 结论 |
|---|---|---|---|
| `IO.c:3464` message() | 任何消息都打断 | 无 | B01、C04 |
| `Combat.c:1179-1181` | 玩家参与的攻击（非 blockCombatText 时） | 无（实测 P6） | B01 |
| `Combat.c:696` | 武器符文触发 | 无 | B01 |
| `Combat.c:1295` | 玩家“造成 0 伤害” | 无 | B01 |
| `Time.c:350,425,446,492,503,613` | 爆炸、恶心、混乱、麻痹、地衣、有害地形 | 无 | B01 |
| `Time.c:1007` | 怪物喊话 flashMessage | 无（web 用浮字） | B01 |
| `Time.c:1138` | 坠落 | 坠落换层时路线由 depth 变化终止（`G:10514-10518`） | 一致 |
| `Time.c:2768` | 新怪物进入视野（非盟友、非 ALREADY_SEEN） | `G:10468-10474`（未排除盟友） | B03 |
| `Items.c:843` | 拾取 | `G:3411-3416`（只在“走上有物品的格”时停） | 一致 |
| `Movement.c:1187,1232,1386,1397` | 取消攻击确认 | 无确认，也就无此路径 | D05、D07 |
| `Movement.c:1467` | 移动拾取 | 同 Items.c:843 | 一致 |
| `Movement.c:2452` discover | 可见格发现秘密 | 无（`G:9846-9855`） | B01 |
| `Movement.c:31-56` playerRuns、isDisturbed | 奔跑停止条件 | 无奔跑 | A03 |
| `Movement.c:1848-1886` travelRoute | 清零；MB_ALREADY_SEEN 标记；逐步复查剩余路线；每步 pause 可被打断 | `G:10500-10510` 全路线复查已对齐（X4a）；everSeen 标记对齐 | 一致（除 B05） |
| `Movement.c:1893-1924` travelMap | 同上（点击旅行） | 同上 | 一致（除 B05） |
| `Movement.c:2276-2360` explore | 清零；开局打相邻敌人；每步重算探索图；无路径即停 | `G:9551-9602,10487-10533`（X4a 已改为每步重算） | B02 |
| `Movement.c:2390-2417` startFighting | 保命刹车、blockCombatText | 无 | B02 |
| `Time.c:2338-2392` autoRest | dangerChanged、按键打断 | 无 autoRest | A02 |
| `IO.c:2531-2541` Ctrl-S | 5 连搜，按键打断 | 无 | A02 |
| `Time.c:322,331`；`Movement.c:705,1406,1414`；`IO.c:979`；`Movement.c:2679` | automationActive 下抑制消息或跳过装饰 | 无 | B07（后两处是纯装饰，不计） |
| `Movement.c:2595` | 自动行进中首见钥匙或 TM_INTERRUPT 地形 | 无 | B03、B04 |
| `Items.c:8456` | 错误路径复位 | — | 不计 |
| `RogueMain.c:385-387` | 开局复位 | — | 不计 |

**覆盖**：37 个置位点、21 行 automationActive、6 行 MB_ALREADY_SEEN、2 行 isDisturbed、7 处 pauseAnimation 打断全部核对，无未核对项。

### 3.2 web 侧额外发现

- **B05**：`performPlayerAction` 的 `escape` 分支（`G:2965-2976`）和 `cancel_target` 早退（`G:2943`）都在 `G:3067` 的 `stopAutoTravel` 之前返回（实测 P13）。
- **B06**：CE `playerTurnEnded` 在 `do { … } while (player.status[STATUS_PARALYZED])` 内一次性推进全部麻痹回合（`C/Time.c:2872`）。web `TC:353-461` 没有这个循环，麻痹要靠玩家逐键推进（`G:2945-2956`）。改动涉及录制事件与回合的对应关系，所以定为全量档。
- **D10**（归入 D 节）：自动行进期间 confirm 被前端自动放行，与 B01 共同构成“自动行进不安全”的整体风险。

## 4. C：消息去向

### 4.1 统计与覆盖

CE 调用点（`grep -c` 于 `C/*.c`）：`message(` 180、`messageWithColor(` 117、`combatMessage(` 40、`flavorMessage(` 7、`temporaryMessage(` 52（约 45 处是调试或生成可视化，只有 7 处玩家可见，如 `getInputTextString` 的输入提示）、`confirmMessages(` 63、`updateFlavorText(` 8、`displayCombatText(` 6。web 的 `logger.log(` 调用共 316 处：`G` 253、`Monster.ts` 28、`App.vue` 20、`ItemUseCoordinator.ts` 8，其他 7。

核对方式：
1. **全量**核对 `flavorMessage`/`updateFlavorText`（15 处）、`combatMessage` 的机制点（缓冲、flush、blockCombatText、远处战斗），以及 `REQUIRE_ACKNOWLEDGMENT` 的 21 个游戏内调用点（§4.2）。
2. **抽样**核对 message/messageWithColor 约 60 处，覆盖移动、拾取、装备、饥饿、状态到期、视野、探索、旅行。
3. web 侧**全量**过了 316 个调用的**去向**：它们都进同一个日志，web 没有 flavor 行，也没有需确认级别。

没有逐条比对文案措辞：web 的文案重写、带伤害数字等由历次 U/W 单元决定，本轮只登记影响交互的项（C08、C11、C13）。

### 4.2 CE 游戏内需确认（REQUIRE_ACKNOWLEDGMENT）消息，21 处

`Time.c:195`（落入岩浆）、`:256`（怪物踩压力板）、`:486`（玩家麻痹）、`:940,944,948,956,969`（饥饿各档、自动进食、饿死）、`:1132,1134`（坠落）、`:2789`（cautious 见怪，死路径）、`:2814,2824`（符文提示）、`:2901,2905`（漂浮警告）、`Combat.c:1084`（未知的献祭符文护甲触发）、`Items.c:5347`（失向箭）、`:7777,7818,7830`（识别、附魔卷轴自述，“Can't enchant that.”）、`:8200`（异常药水）。在 web 中这些都是普通日志行，没有任何强调（C04）；其中漂浮警告整条缺失（C05），符文提示整条缺失（C06）。

### 4.3 应进位置描述行却进了日志

只有 DF flavor（`G:9186`，X4b 在修）一类。CE 的 `updateFlavorText` 每回合刷新（`C/Time.c:2876`），跑步、旅行结束时也刷新（`C/Movement.c:61,1886,1924`）；web 目前没有这一行，X4b 一并补上。

### 4.4 应合并却刷屏

- 见怪和见物消息（C02）：每次进出视野都会重复，CE 用 `MB_WAS_VISIBLE`（俘虏永不清）加自动行进门控。
- 麻痹按键（B06）：每回合一条 “cannot act”。
- 战斗逐击（C08）：startFighting 期间 CE 用 blockCombatText 抑制，web 全记。
- Logger 只合并相邻相同文本（C07）：探索中 “You see X” 与战斗行交错时无法折叠。

## 5. D：确认与防呆

CE 的 `confirm(` 共 26 处调用：玩法 14 处（`Movement.c` 8、`Items.c` 6），命令确认 5 处（`IO.c` 4、`RogueMain.c` 1），其余 7 处是菜单、录像、向导。另有 2 处 “Not while …” 拒绝和 2 处 “that would be certain death!” 拒绝（`Movement.c:1306`，`Items.c:7312`）。

| CE | 用途 | web | 结论 |
|---|---|---|---|
| `Movement.c:798` | 攻击酸性怪 | 无 | D07 |
| `Movement.c:821` | 攻击 discordant 盟友 | 无，且撞普通盟友也是攻击 | D05 |
| `Movement.c:1117` | 混乱时临近岩浆 | 有（`G:3107-3120`） | 一致；但自动行进中被放行，见 D10 |
| `Movement.c:1202` | 释放俘虏 | 无，撞上即攻击 | D06 |
| `Movement.c:1306` | 拒绝走入岩浆 | 无 | D01 |
| `Movement.c:1319` | 跳入深渊 | 有（`G:3335-3339`、`:7360`） | 一致 |
| `Movement.c:1330` | 进火 | 无 | D02 |
| `Movement.c:1343` | 进有害气体 | 无 | D03 |
| `Movement.c:1361` | 踩压力板 | 无 | D04 |
| `Items.c:1404` | 题字 | 无此功能 | D12 |
| `Items.c:7106` | 投掷已装备或已附魔物品 | 无 | D09 |
| `Items.c:7312-7316` | 闪现的必死与未知射程过岩浆 | 有（`G:4128-4136`） | 一致 |
| `Items.c:7486` | 不饿时吃东西 | 有（`G:3851`） | 一致 |
| `Items.c:7765` / `8058` | 已知有害的卷轴、药水 | 有（`G:3551-3600`，`IO:207-214`） | 一致 |
| `IO.c:2607,2632,2637,2643`；`RogueMain.c:1427` | autopilot、存档、新局、放弃、简单模式 | 由菜单承担或不适用 | 不计 |
| `IO.c:2937-2946` 放行规则 | 仅 autoplay 或回放放行 | 自动行进期间也放行 | D10 |
| `Movement.c:2269-2275` “Not while you're confused/trapped.” | 探索前拒绝 | 有（`G:9532-9542`） | 一致 |
| `Items.c:8374-8379`、`8640-8651` 诅咒拒绝 | 丢弃、换装、卸下 | 只有 UI 拦“卸下” | D08 |

另外，幻觉时随机踉跄（D11）是 web 自创的“反防呆”行为。

**覆盖**：14 个玩法 confirm、5 个命令确认、4 个拒绝点、3 个诅咒拒绝、1 个放行规则全部核对。

## 6. E：其它交互层

- **侧栏**（E01–E03）：`SB` 以 100ms 轮询拉取引擎状态，结构上满足纯显示改造，三条都可以在轻档内完成。
- **悬停与 describeLocation**（E04）：`G:10328-10415` 已处理未知格、记忆格、GAS 层优先、告示牌文字；缺 CE 的完整句式与玩家脚下描述。先等 X4b 的位置描述行落地。
- **可见性判定时点**（E05）：`update()`（`G:2517-2553`）把“首见消息”和“visibleMonsters/visibleItems 更新”挂在渲染条件下；`autoTravelDisturbed`（`G:10466`）读的就是这两个集合。目前在 UI 中每步都会 `update()`，所以没有复现出行为偏差，标“待证”。
- **自动拾取与“你看到了…”的时机**：拾取已按 CE 放在移动回合内（`G:3407-3417`）；“看到”消息的时机和条件见 C02、E05。
- **playerTurnEnded 中的玩家可见提示**：漂浮警告（C05）、符文提示（C06）缺失；饥饿提示时机一致（`TC:240-260` 与 `C/Time.c:2213-2220`），文案差异见 C10。

## 7. 探针（最小复现）

源码副本在 [x-3-evidence/x3_probe.ts.txt](x-3-evidence/x3_probe.ts.txt)、[x3_probe2.ts.txt](x-3-evidence/x3_probe2.ts.txt)、[x3_probe3.ts.txt](x-3-evidence/x3_probe3.ts.txt)、[x3_probe4.ts.txt](x-3-evidence/x3_probe4.ts.txt)（扩展名改为 `.ts.txt`，避免被 vitest 收集）。输出在 [probe-output.txt](x-3-evidence/probe-output.txt)。复现方法：放到 `brogue-web/tmp-x3/<name>.test.ts` 后执行 `npx vitest run tmp-x3/<name>.test.ts --reporter=verbose`。所有探针都用 `createHeadlessGame` 构造内存房间，调用的是原实现，不打桩、不改生产代码。

| 探针 | 观测（原文摘录） | 支撑条目 |
|---|---|---|
| P1 | 盟友 hp 12→9，玩家与盟友位置不变，`confirms: []`，“You hit the Monkey for 3 damage” | D05 |
| P2 | 俘虏 hp 15→0，`isCaged: true`，“You backstab the Goblin for 15 damage!” | D06 |
| P3 | 玩家到 (5,5)，`over: true`，“You are incinerated by the lava!” | D01 |
| P4 | 火格，`confirms: []`，“You catch fire!” | D02 |
| P5 | 开局 D1 按 `stairs_down`，“There are no stairs down here.”，autoPath 0 | A01 |
| P6 | 8 步后 hp 200→188、剩余路径 18，日志是 4 条 “The Jackal hits you” | B01 |
| P7a/b | 诅咒 Dagger 被丢弃；装备 Dart 后诅咒 Dagger 被换下 | D08 |
| P8 | `["You see a Monkey.","You see a Rat."]`（盟友、非自动行进） | C02 |
| P9 | 一次 wait 只过 1 回合，麻痹剩 4，“You are paralyzed and cannot act!” | B06 |
| P10 | 40 次右移中 14 次偏航，“You stumble in a random direction! x14” | D11 |
| P11 | 丢下 Ration 后按探索，6 步走回原处并 “You picked up Ration of Food.” | A09 |
| P12 | 26 格满包踩上物品，物品仍在地上，日志为空 | A09 |
| P13 | escape、cancel_target 后剩余路径 27，随后又走 3 步 | B05 |
| P14 | `autoAccepted: ["Risk stumbling into lava?"]`；同位置手动移动时 `manualMoveAsked` 有此提问 | D10 |

B02（startFighting）是已知项，按任务书只列入清单、不深挖。

## 8. 建议的修复单元分组

每组可独立执行。组内文件重叠已尽量避免；`G` 是单文件大类，各组改的是不相交的方法段，列在括号内。建议顺序：**X3-U1 → U2 → U3**（安全优先），U4–U8 可以并行。

| 单元 | 覆盖条目 | 涉及文件（方法段） | 门禁 | 说明 |
|---|---|---|---|---|
| **X3-U1 移动防呆** | D01、D02、D03、D04、D07、D10 | `G`（`performPlayerAction` 的 move 分支 `:3083-3420`、`requestConfirm` `:7343-7372`）；`src/App.vue:11-17` | 中 | 纯拒绝或确认，不改规则和 RNG。确认拒绝时不耗回合、不录制（沿用 `commandDecisions`）。D10 放行条件收窄后，要回归 U27/X2a 录像测试 |
| **X3-U2 盟友换位与释放俘虏** | D05、D06 | `G`（move 分支的 blockingMonster 段 `:3158-3203`、`freeCaptive` `:10111`）；`src/engine/Movement/CreaturePlacement.ts`（qualifyingPathCandidates 复用） | 全量 | 换位会改怪物位置和回退落点，必须全量门禁；与 U1 同在 move 分支，但段落不同，建议 U1 合入后再做 |
| **X3-U3 诅咒装备门** | D08、D09 | `G`（`equipItem`/`unequipItem`/`dropItem` `:3469-3526`、`throwItemAt` `:5822-5838`）；`src/entities/Player.ts`（`equip`/`unequip`）；`IO:246-252` | 全量 | 把诅咒检查下沉到引擎一处，UI 的拦截改为展示引擎结果 |
| **X3-U4 disturbed 与自动行进** | B01、B02、B03、B04、B05、B07、C02、C03、E05 | `G`（`update` 可见性段 `:2517-2553` 下沉、`autoTravelDisturbed`/`stepAutoPathInner` `:10466-10533`、`handleAutoExplore`/`adjacentExploreEnemy` `:9544-9602`、escape 分支 `:2943-2976`、`discoverSecretAt`）；`TC`（playerTurnEnded 尾部接入首见判定）；`L`（消息通道置位） | 中 | 本组是 A02、A03 与 C04 的前置。首见判定移入回合尾之后，UR2/UR3/UR4 黄金 trace 的日志可能变化，须单变量归因后重录 |
| **X3-U5 按键与命令补全** | A01、A02、A03、A04、A05、A06、A07 | `In`；`G`（`performPlayerAction` 的 stairs、wait、search 段，新增 `travel_stairs`、`auto_rest`、`search_long`、`run`）；`CommandBar.vue`；`DPad.vue`；`ReferenceOverlay.vue`（帮助表） | 中 | 依赖 U4 的 disturbed。A04 的 `x`/`X` 键位需用户先裁决 |
| **X3-U6 消息通道与确认级** | C04、C05、C07、C09、C10、C11、C12、C13 | `L`；`SB`；`MessageStrip.vue`；`G`（状态到期 `:6653-6669`、饥饿 `:6694-6711`、拾取文案、漂浮警告新增于回合尾）；`src/locales/*` | 中 | C05 需要一张最近安全格距离图（可复用 SafetyMap 的地形口径，零 RNG） |
| **X3-U7 侧栏与悬停** | E01、E02、E03、E04 | `src/engine/UI/MonsterSidebar.ts`；`SB`；`G`（`updateHover` `:10328-10415`，E04 待 X4b 之后） | 轻 | 纯显示 |
| **X3-U8 规则层残项** | B06、D11、A08、A09、A10、C06、C08、D12 | `G`（麻痹循环需动 `TC:353-461`；幻觉分支 `:3124-3138`；拾取与丢弃的 AVOIDS；`equipItem` 消息；战斗文本）；`src/engine/Combat/Combat.ts`（C08 按需）；怪物类别名册（C06 前置） | 全量（B06、D11）/ 中（其余） | 可以再拆：U8a（B06、D11 全量）、U8b（A08、A09、A10 中档）、U8c（C06、C08、D12，需名册或项目裁决） |

**跨组冲突提示**：U1、U2、U4、U5 都会改 `G` 的 `performPlayerAction`。建议按 U1 → U2 → U4 → U5 串行合入；U3、U6、U7 可以与它们并行。X4b（位置描述行）与 U6、U7 共享 `SB`、`MessageStrip.vue`，应先合 X4b。

## 9. 覆盖声明

| 类 | CE 枚举 | 已核对 | 未核对及原因 |
|---|---|---|---|
| A 按键 | `executeKeystroke` 全部 57 个 case 标签，归并为 34 个命令；另加 `executeMouseClick` 3 个分支 | 全部 | 调试键（`C`、`~`、`&`、PrintScreen）只确认 web 无对应，不计差异 |
| B 打断 | disturbed 59 行（置位 37）、automationActive 21、MB_ALREADY_SEEN 6、isDisturbed 2、pauseAnimation 打断 7 处 | 全部 | 无 |
| C 消息 | message 180、messageWithColor 117、combatMessage 40、flavorMessage 7、updateFlavorText 8、REQUIRE_ACK 21（游戏内）、displayCombatText 6、temporaryMessage 52 | flavor、updateFlavorText、combat 机制、REQUIRE_ACK 全量；message 与 messageWithColor 抽样约 60 处；temporaryMessage 只核对玩家可见的 7 处 | 其余 message 文案逐字比对不在本轮范围（历次 U/W 单元已重写文案，另需一次 i18n 专项）；web 316 处 `logger.log` 的去向全量确认（全部进日志） |
| D 确认 | confirm 26（玩法 14、命令 5）、Not-while 2、certain-death 2、诅咒拒绝 3 | 全部 | 菜单、录像、向导类 7 处 confirm 不计 |
| E 其它 | refreshSideBar、printMonsterInfo 状态段、describeLocation、updateFlavorText、playerTurnEnded 尾部提示（见怪、符文、漂浮） | 全部 | describeLocation 的完整句式分支（`C/Movement.c:151-610`，约 460 行）只做结构对照，没有逐分支比对（E04 标 S3，待 X4b 后细化） |

**本轮执行清单**：`git checkout main`（`82b8182`）→ 新建分支 `survey/x-3`；`npm ci`（只装依赖，未改 `package-lock.json`）；`npx vitest run` 跑 4 个临时探针文件（共 17 个 it，全部通过）。未跑完整 `npm test`，未跑 `vue-tsc`、`build`、`test:drift`（没有改产品代码）。临时目录 `brogue-web/tmp-x3/` 已删除。唯一新增的是本报告与 `x-3-evidence/`（txt 文件）。
