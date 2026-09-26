# X2b：全层地形派生与消费者职责核对

基准：`f18eb6d0`；2026-09-27（Asia/Shanghai）。权威为本树 `BrogueCE-master`，规格按 [X-1 §4 N05、§3 K42、§7.1](x-1-survey.report.md)。本轮不暂存、不提交。

> 已完成：build、完整测试、浅层与深层 drift 均通过；未提交。最终复跑见 §6，旧前提迁移的验收事项见 §5。

## 1. 实现与事实来源

采用**写口统一刷新**。`Cell.refreshTerrainProperties()` 对 DUNGEON / LIQUID / GAS / SURFACE 四层 `TERRAIN_FLAGS` 做 OR，分别派生 `!T_OBSTRUCTS_PASSABILITY` 与 `T_OBSTRUCTS_VISION`。对应 CE `Globals.c:581` terrainFlags / cellHasTerrainFlag。新建空格四层都是 NOTHING，因此 passable=true、opaque=false。

保留 Cell 的两个 own fields、序列化字段和 FOV 热路径上的常数时间读取，没有引入逐读扫描或 Proxy。为解除 Grid 与属性目录的环依赖，把原 TerrainType 枚举原样移到无依赖的 `Map/TerrainType.ts`；Grid 继续重导出，枚举值和所有既有导入接口不变。没有复制另一份地形白名单。

| 写口 | 闭合方式与验证 |
|---|---|
| Grid.setTerrain / Cell.terrain | writeTerrainHome 完成替换四层后统一刷新；全枚举逐项检验覆盖、清空、由阻挡变通行及反向。 |
| Grid.setTerrainLayer / 清层 | 只改指定层，再按四层重算；独立测试在每一层放完整 catalog，并保留另一层阻挡后清除当前层。 |
| Architect / Blueprint feature / AutoGenerator | 原写口已使用 Grid API；移除 trap / pressure plate 的手写 passable=true；自然生成检验覆盖实际机器与建筑阶段。 |
| Blueprint rollback | 恢复 layers 后重算，不信任 backup 中的派生布尔值；阻挡与通行两种备份均测试。 |
| Lake fill / cleanup / Gas 的 terrain 替换 | 经 Grid 或 Cell.terrain setter 刷新；不再把目标格 passable 镜像抄到清层后的另一个格子。 |
| DF / Promotion / 消失 / 燃烧 / 开门 | DF 的 refresh 入口委托同一原语；Promotion 的手写布尔更新也改为委托。DF 效果回调前已有正确派生值。 |
| Gas 添加、换型、归零、搬运 | 直接写 GAS 的分支立即刷新；搬运目标保留原层写入并立即刷新；气体清除不会清掉其他层的阻挡。 |
| Game 结晶术 | FORCEFIELD 中间态及边缘 CRYSTAL_WALL 保留原直接写层方式并紧接统一刷新，DF 回调读不到旧缓存。 |
| test-room / whole-run / 跨层存档恢复 | 先恢复真实四层，再派生；测试故意传入相反的缓存值，验证按层重建。字段 schema 不变。 |

新增 AST 守卫锁定生产代码只在统一方法写这两个布尔值，并穷举仍直接写 layers 的函数集合。生产读写清单见 [terrain-accesses.json](x2b-evidence/terrain-accesses.json)，运行守卫见 [x2b_terrain_derivation.test.ts](../../src/test/x2b_terrain_derivation.test.ts)。本轮没有把测试故意构造的坏缓存写入改成生产支持的第二事实来源。

## 2. 消费者逐项核对

| 消费者 | CE 判据与本轮处理 |
|---|---|
| FOV / LightMap / 矿灯 / 搜索视域 | CE getFOVMask 的 T_OBSTRUCTS_VISION。保留现有 isOpaque 热读，缓存修复后与全层旗标等价；自然 foliage 与 torch wall 遮挡被恢复。 |
| Game.hasLineOfSight | 光学遮挡；继续用 isOpaque。透明 crystal wall 挡通行而不遮挡这条视线。 |
| BoltTrajectory / 魔法弹道 / blink / beckoning | CE Items.c 的 T_OBSTRUCTS_PASSABILITY **或** T_OBSTRUCTS_VISION，另有 bolt 的火焰/隧道等特例。已有轨迹代码直接查全层 flags，保留；没有换成单一 opacity。W-14 等原守卫纳入门禁。 |
| 鞭 / 矛 / 横扫 / 突进 | 射线停止继续读 passability OR vision；近战目标准入仍有 ATTACKABLE_THRU_WALLS 例外。怪物提交移动的物理闸放在几何攻击尝试之后，避免阻断合法隔墙攻击。 |
| 搜索概率 | CE Movement.c:2459–2489：先直视再掷骰，阻挡通行格取 2/3 概率。把显示层 blocksPassability 改成全层派生位；保留掷骰次序、半径、低概率 RNG 消耗。 |
| 自动探索 / 自动旅行 | CE getLocationFlags 的当前/记忆区别及 monsterAvoids 的危险/免疫区别。探索候选与 A* 准入共用 PlayerTravel 判据：已知墙、渊、水、火、陷阱等按玩家状态过滤；不偷读不可见格的当前地形；未知边界可探索；未知地面陷阱按 TM_IS_SECRET 例外放行，秘密墙仍被物理阻挡先行拒绝。实际迈步检查物理通行，不能因“可走入深渊”就自动选择深渊。 |
| 玩家手动移动 | 保留已有直接全层阻挡查询、游泳分支、钥匙/门、跌落确认、入迷与特殊近战分支。没有用 generic 或 safety cost 代替手动移动。 |
| 怪物移动 / 追踪 / 逃跑的最终落步 | CE Monsters.c:1335–1502 monsterAvoids；复用已有带免疫、状态、密门例外的判据。去掉“飞行就用 !isOpaque”的错误。实际提交再核物理通行/可发现密门；可见怪使用阻挡型密门时显形，不因此揭示地面隐藏陷阱。 |
| 气味 | 保留 T_OBSTRUCTS_SCENT、T_OBSTRUCTS_PASSABILITY 两个独立判据（CE Movement.c:2877–2878 / Time.c updateScent）；门可通行但仍阻气味。 |
| 逃跑图 / safety map | 保留 CE Time.c:1807–1876 的双 cost：如深水 [5,5]、未见密门 [100,1]，以及玩家/怪物的危险差别。新守卫显式证明这些数值不等于 physical passability。 |
| generic Dijkstra.calculateMap | 此旧 API 没有生产调用者，但仍不能因 CHASM.passable=true 放行。接入已有 genericPathCost（Movement.c:2017–2037），仅将 -2/-1 映射回该 API 原来的 30000/29999；batchScan 及其他 cost 不改。 |
| 生成 arcCount / 落位 | Game 私有 arcCount 原先读物理 passable，现复用 CE Architect.c:48、171 的 T_PATHING_BLOCKER + 密门/钥匙/楼梯门例外；锁门与渊的独立合成样本、零 RNG 守卫覆盖。GenerationCoordinator 的最终地板池仍只排物理阻挡，后续各物种落位规则保持职责。 |
| 力量符文击退 | CE Combat.c:539 forceWeaponHit 使用 blink 轨迹；补上 vision 阻挡，落地结算环境效果。既有范围/伤害公式保留。 |
| 普通 stagger | CE Combat.c:1118–1136：源格不能嵌墙，目标只查物理阻挡/占用，允许推入水域及不挡通行的植被。通过现有 placeCreature 提交，不能借玩家避免深水的选路口径拒绝推拉。 |
| 分裂 / 休眠怪挪位 / 随机传送 | CHASM 修正为物理可通行后，这些旧 passable-only 入口不能把它当安全落点。分裂使用 CE monsterAvoids；休眠挪位兜底用物种 forbidden flags 与楼梯排除；旧随机传送入口委托现有 terrain-aware teleport 选择与提交。 |
| 记忆 / 快照 / 复活落位 | 记忆保存观察时的真实派生位；快照恢复按层重算；复活等已有 T_PATHING_BLOCKER / T_HARMFUL_TERRAIN 附加条件保留。 |

范围澄清：`isPassable` 表示“不阻挡物理通行”，**不表示可安全寻路**。CE 允许踏入 CHASM 后跌落，允许通行 FOLIAGE 而遮挡视线，也有透明且不可通行的 CRYSTAL_WALL。任务书与 CE 在这些语义上不冲突。自动旅行仍沿用项目既有 A* 与目标选择算法；本轮核对/修正的是地形准入，未冒称已完整移植 CE populateCreatureCostMap 的全部权重和 mapToShore 时长预算。一般怪物 AI 调度、几何光学算法本身也不是本轮的重写范围。

## 3. 独立守卫、自然样本与反事实

- 先在原实现重现 seed424242/D1 的 **106 格差异**（103 遮挡、7 通行，存在重叠）。(1,6) 的 TORCH_WALL 原为 true/false；全层旗标应 false/true。
- 同 4 seed × D1–40 的 160 层，入场合计 **20,293 格**至少一个缓存不同；只修派生写口之后，160 层均为 **0**。后续各阶段仍为 0。输出保留逐格坐标、层数组与 flags，不仅是总数。
- 自然 D1 有 **4 TORCH_WALL、99 FOLIAGE**，不是人工替换的样本。新专项还对两个 seed 的 D1–40 逐层扫描，并在 D1/8/26/27/40 推进真实等待回合后复核全图。
- 全 catalog × 四层覆盖包含 GAS、显示优先级反例、保留其他层阻挡、反向清除；运行链覆盖 DF 回调、晋升、发现、开门、燃烧、气体竞争/搬运、结晶术和恢复。
- **14 个隔离故障变体全部检出**，不改工作树源码：漏 GAS、只读 effective terrain、漏层刷新、漏整格刷新、信任存档缓存、房间恢复信任旧缓存、搜索读显示层、force 忽略视线、stagger 拒绝水、旧 arcCount、飞行按透明准入、旅行按 passable 准入、分裂按 passable 准入、自动旅行避开未揭露陷阱。见 [negatives.json](x2b-evidence/negatives.json)、[配置](../../scripts/x2b-counterfactual.config.ts)、[运行器](../../scripts/x2b-negatives.mjs)。

反事实过程也约束了新增测试本身：最初搜索夹具用 SECRET_DOOR+火，密门 drawPriority=0，火实际没遮住它，旧 effective 查询仍能通过；改成隐藏地面陷阱 + LIQUID 锁门 + SURFACE 火，并断言 effective 确实为火后，旧查询被检出。首次新测试还漏传 PromotionDriverOptions，按真实接口补上 keyOnTileAt；传送夹具最初全图透明，使所有落点都在 FOV 内，补上真实遮挡与清除目标机器标记后才构成有效正例。没有为这些夹具问题改生产语义。

## 4. 生成流与基线治理

入场 `test:drift` 与原 D27–40 独立基线均通过；基线及 UR2/UR3/UR4 初始 SHA 在 [baseline-before.json](x2b-evidence/baseline-before.json)。原 HEAD 的观测和原黄金 trace 逐值一致，保证采集脚本没有另立口径。

阶段快照位于 `x2b-evidence/sources-*.json.gz`，每段独立执行同 4 seed × D1–40。生成观测包括四字段、完整格状态、实体/物品、双流 RNG、食物/金币/计量和深层宝石；报告中的“四字段差异”不把这些额外观测字段混算进去。

| 单变量阶段 | D1–26 | D27–40 | UR2 / UR3 / UR4 |
|---|---|---|---|
| s0 → derived：全部写口派生闭合 | 4 层地形指纹变化；缓存差异全部消失 | 4 层地形指纹变化；缓存差异全部消失 | 0 / 127 个叶字段 / 0 |
| derived → generation：CE arcCount | 15 层指纹变化，另有落位与 RNG 变化 | 15 层指纹变化，另有宝石/落位与 RNG 变化 | 0 / 133 个叶字段 / 0 |
| search | 全部观测字段 0 变化 | 全部观测字段 0 变化 | 0 / 0 / 0 |
| movement | 全部观测字段 0 变化 | 全部观测字段 0 变化 | 0 / 0 / 0 |
| displacement | 全部观测字段 0 变化 | 全部观测字段 0 变化 | 0 / 0 / 0 |
| travel | 全部观测字段 0 变化 | 全部观测字段 0 变化 | 0 / 0 / 0 |
| final：generic cost | 全部观测字段 0 变化 | 全部观测字段 0 变化 | 0 / 0 / 0 |
| placement / review：落位过滤与 CE 复核 | 全部观测字段 0 变化 | 全部观测字段 0 变化 | 0 / 0 / 0 |
| guard / knowledge / accessor：调用清单与隐藏陷阱知情判据 | 全部观测字段 0 变化 | 全部观测字段 0 变化 | 0 / 0 / 0 |

不同阶段的变化可能重叠、抵消，不能相加当最终层数。**原 HEAD → 最终：浅层 21 个层样本、44 个四字段差异，其中指纹变化 15 层；深层 23 个层样本、45 个四字段差异，其中指纹变化 14 层。** 深层另有 17 个样本的宝石坐标数组变化，数量与 originDepth 逐项保持不变，合计 62 个深层基线字段变化。UR2、UR4 无变化，UR3 的变化全部来自前两段。

证据：[阶段归因](x2b-evidence/generation-attribution.json)、[trace 归因](x2b-evidence/trace-attribution.json)、[重采前原 drift 红灯](x2b-evidence/drift-before-recapture.txt)。用户已在任务书授权生成变化及经归因后的重捕获，没有以生成变化为卡点。

`guard` 最后一段只调整 Gas/Game 的调用形状，以保留 C-4a-0 的层 API 许可清单；重新跑 160 层及三组 trace，所有观测字段均零变化。已于 03:29:36 CST 完成一次性重捕获：浅层 44 字段、深层 62 字段（含宝石坐标）；UR3 用原 `UR3_CAPTURE=1 npx vitest run src/test/u_r3_trace.test.ts --maxWorkers=1` 一次重录，最终差异 141 个叶路径。UR2、UR4 逐值相同，未写文件。登记见 [recapture.json](x2b-evidence/recapture.json)。

| 基线文件 | 原 SHA-256 | 最终 SHA-256 |
|---|---|---|
| `generation_baseline.json` | `f8393ee0c7e5ada3817b9e368c9ad8bb96fea12ca61408bc9508e6e979143933` | `8fbfc182a1c1e6e53a0cb5a5ac49cebfd343c0cf1aa65acb7b0ce5a7cf3afc8d` |
| `deep_generation_baseline.json` | `2134a90cd9dce7237846f2a9fe4fec0362d0dbdb48bb16d28f568bbc4d923d16` | `4349308067bc804e90cd99149f6362b0f1a00bab25d44f858ea3500b2cb0780b` |
| `u-r2-trace.json` | `4d6b62462fc8962732dd39a58f1c1a714909c7e8e3d9b98200b7f4804ec17bb9` | `4d6b62462fc8962732dd39a58f1c1a714909c7e8e3d9b98200b7f4804ec17bb9` |
| `u-r3-trace.json.gz` | `baf94f41244ad888bc12428cddecceebd18b4ceba4d6c9745c9a123f34e46ad2` | `3a9b0bc4de1bf4f1495c87cf7c41409ec589d4df702ae120b24dc0cfdb995382` |
| `u-r4-trace.json.gz` | `27d71a88ac3ae879cab8e83c26c10df6ea40b43a2efa932e54a4e2a482b3ece3` | `27d71a88ac3ae879cab8e83c26c10df6ea40b43a2efa932e54a4e2a482b3ece3` |

三个 P2/P2-2/P2-3 基线保持原 SHA-256；完整八文件前后核对由最终门禁再次验证。

## 5. 既有守卫前提与浏览器

以下前提迁移均保留原样本、原结果要求、原超时与零违规门槛，提交验收方裁决：

1. `c_4a_terrain_catalog.test.ts` 的两个留痕用例：全枚举旧白名单（锁门可通行、渊不可通行）及旧 calculateMap 启发式（锁门 cost=1）。原注释明确允许接 CE 判据后翻转。[原 HEAD + 原断言](x2b-evidence/premise-and-deep-before.json)两项通过；[派生修复 + 原断言](x2b-evidence/premise-derived.json)两项失败。新预期仍覆盖全枚举及点名反例，generic cost 保留不同 sentinel。
2. `horde_terrain_spawn.test.ts` 的钥匙落位前提：seed20260915/D3/(76,3) 原本就是 CE28 的 `ALTAR_CAGE_RETRACTABLE` 奖励，四层、机器号 5、钥匙绑定均未变，只有旧缓存误报 true。CE GlobalsBrogue.c:360–363 明确把领养钥匙放在这个初始闭笼上；Items.c:422–434 的显式位置落物不要求可通行。[旧实现通过](x2b-evidence/horde-premise-s0.json)、[仅派生后失败](x2b-evidence/horde-premise-derived.json)、[逐格证据](x2b-evidence/key-derived.json)。普通钥匙继续要求可通行；只对 DUNGEON 为该笼的实例要求不可通行、机器号、IMPREGNABLE、钥匙绑定，且其他层不得额外堵路。[迁移后同样本通过](x2b-evidence/horde-premise-migrated.json)。
3. `u_26a_deep_levels.test.ts` 的即时拾取前提：原 HEAD 与仅派生阶段都通过，arcCount 生成阶段后 seed777/D32 第一颗宝石后的真实战斗施加了 20 回合麻痹，下一次拾取输入只负责恢复行动，物品仍在地面。[阶段反事实](x2b-evidence/deep-premise-generation.json)、[逐命令状态](x2b-evidence/deep-action-probe.txt)。脚本在拾取前用有界的真实 wait 恢复行动，并断言麻痹已消失；不删除怪、不清状态、不改生产的麻痹输入闸，所有宝石数量、可达、存档、往返、胜利和计分断言保留。
4. `fixtures/u19e-machine-actions.ts` 的诱导站位前提：同一个 seed424242/D8 的完整 CE47 机器，search 阶段原脚本成功，movement 阶段原脚本失败。固定北侧 fallback 在食人魔新的合法追踪路线下反复进入近战距离并被击退。只把原候选位置按“目标下一步接近祭坛”排序，仍走真实路线/命令，原 160 次界限不变，未操纵目标位置/HP/AI。[原脚本失败](x2b-evidence/sacrifice-movement.json.gz)、[调整后完整奖励链](x2b-evidence/sacrifice-guard-fixed.json.gz)。`p1_20_item_placement.test.ts` 及 U19d/e 的全部结果断言不改。

另有 C-4a-0 层 API 许可守卫在预检发现新增调用文件；没有扩大清单，改为让 Game/Gas 保留原层写入并紧接刷新。[原守卫与写口专项复核通过](x2b-evidence/writer-guard-fixed.json)。

浏览器验证见 [browser.json](x2b-evidence/browser.json)、[脚本](../../scripts/x2b-browser.mjs)。独立上下文中从真实菜单输入 seed424242，新局自然全图差异为 0；再在明确标注的合成房间，用真实键盘完成撞 TORCH_WALL 不动 → 踩 FOLIAGE 成 TRAMPLED_FOLIAGE → 开门通行，最后补测实际 setAutoPath：未揭露毒气陷阱目标获得两步路径，揭露后同目标没有路径；page/console errors 均为 0。以下四张有头整页截图已打开逐一检查：

- [自然 D1](x2b-evidence/browser-natural.png)
- [交互前的阻挡与视野](x2b-evidence/browser-terrain-before.png)
- [植被踩踏后](x2b-evidence/browser-foliage-trampled.png)
- [开门后](x2b-evidence/browser-door-open.png)

标准 develop-web-game 客户端已运行并读取 `render_game_to_text`；其 canvas 导出是黑图，不作为视觉通过依据，视觉依据为上述有头截图。首次本机服务器和浏览器启动被文件系统沙箱的进程/端口约束阻止，随后通过工具审批在本机隔离上下文执行；没有使用用户浏览器存储或发送外部消息。

## 6. 最终复跑声明与门禁

完整预检于 02:45:55–03:26:51 CST 跑完：200 文件、3775 passed、8 failed、8 skipped、5 todo。八项失败分别为 C4a 旧前提两项、层 API 许可、闭笼钥匙前提、麻痹时即时拾取、献祭诱导脚本、原 UR3、原深层基线，均已按前述证据处理。这轮期间实现仍在调整，因此只算完整预检，不能充当冻结终验。[原始完整结果](x2b-evidence/preflight-all.json)。

03:30:57 CST 首次冻结的 build 已通过，但在终审中发现 PlayerTravel 缺少 CE monsterAvoids 的隐藏地面陷阱例外，因此主动中止该轮全量；其日志归档 [prefinal-hidden-trap](x2b-evidence/prefinal-hidden-trap/)，**不计作完整门禁通过**。补齐例外后增加独立正反例与故障注入，浏览器重跑并逐一复看四张截图。160 层及 UR2/3/4 最后 knowledge 阶段与 guard 已证实逐值相同，基线没有第二次重捕获。

03:39 冻结轮的 C-4a 源码守卫随后发现 PlayerTravel 直接读取 mechFlags 越出许可清单；未改守卫，改为调用已有 terrainMechFlags 入口，并主动中止该轮（[日志](x2b-evidence/prefinal-mech-reader/)）。源码许可、层 API 许可、写口清单及旅行专项 5/5 通过；accessor 阶段的 160 层、三组 trace 及已重捕获文件哈希全部不变（[等价证明](x2b-evidence/accessor-equivalence.json)），再进行最终完整复跑。

最终复跑窗口为 **2026-09-27 03:51:37–04:41:16 CST**。以最后 accessor 修复后的版本冻结，完整串行执行以下门禁；窗口内没有修改源码、测试、脚本、配置或基线，结束后仅补写报告、进度及覆盖证明。开发服务器与隔离浏览器均已关闭。

| 门禁 | 实际命令 | 起止时间（2026-09-27 CST） | 退出码 |
|---|---|---|---|
| 构建 | `npm run build` | 03:51:37–03:51:54 | 0 |
| 完整 npm test | `npm test -- --maxWorkers=4 --reporter=default --reporter=json --outputFile=ai_docs/reports/x2b-evidence/regression-final.json` | 03:51:54–04:40:02 | 0 |
| 浅层 drift | `npm run test:drift -- --maxWorkers=1` | 04:40:02–04:40:28 | 0 |
| 独立深层 drift | `npx vitest run src/test/u_26a_deep_baseline.test.ts --maxWorkers=1` | 04:40:28–04:41:16 | 0 |
| 空白检查 | `git diff --check` | 04:41:16–04:41:16 | 0 |

完整测试 **201 文件、3803 passed、0 failed、8 既有 skipped、5 既有 todo，共 3816 项**；新增地形专项 20/20 通过。8 个 skipped 属于原 P2 系列旧基线/常数 tick 用例，5 个 todo 属于原 smoke / CombatFormulas 占位；本轮未增加跳过项，完整名称见 [既有未执行项](x2b-evidence/existing-deferred-tests.json)。构建仅有原有的大于 500 KB chunk 提示。

反查 R∪S **193/193**，任务点名守卫及 **63 个读源码守卫文件**均在完整结果中且无遗漏，见 [闭包覆盖](x2b-evidence/closure-coverage.json)、[点名覆盖](x2b-evidence/named-guard-coverage.json)、[源码读取清单](x2b-evidence/source-reading-guards.json)。另对整个 `src/**/*.test.ts` 反查，除由独立 drift 门禁运行的 generation_baseline 外，应跑 **201/201**、缺失 0、额外 0（[完整源码树覆盖证明](x2b-evidence/complete-source-suite-proof.json)）。原 runner 的 `src/test` 狭义清单为 186 个文件，列出的另 15 个实际是既有 `src/engine` / `src/data` 测试；补充清单扩展扫描范围，没有更改冻结输入或重跑口径。

最终 **14/14 故障变体**均被检出（[结果](x2b-evidence/negatives.json)、[最终日志](x2b-evidence/negatives-final.txt)）。P2-2 E1 的 400 回合性能守卫通过，完整用例耗时约 **2.523 秒**，原 10 秒限制未改；没有调整样本、超时或容忍值。

冻结前后 **830 个运行输入 SHA-256 全部一致**，变化 0；浅层、深层、UR3 仅做 §4 登记的一次重捕获，UR2/UR4 和三个 P2 基线哈希不变，意外基线改动 0；CRLF 0。完整结论与逐文件结果见 [final-summary.json](x2b-evidence/final-summary.json)、[final-results.md](x2b-evidence/final-results.md)、[原始全量 JSON](x2b-evidence/regression-final.json)。

最终 HEAD 仍为 `f18eb6d05c004722a1bc9b1b8880ac2be1b2a128`，暂存区为空，**未提交**。实现与门禁已完成；§5 四类旧前提/操作脚本迁移保留完整反事实证据，交验收方裁决。
