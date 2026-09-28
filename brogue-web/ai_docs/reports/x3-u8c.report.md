# X3-U8c：CE 战斗文字、符文首见提示、题字与重标字母

基线：`929509f703670948a149166d03fa2b5444c891ea`。执行范围：[任务书](../tasks/x3-u8c.prompt.md)、[X-3 勘察 C08 / C06 / D12](x-3-survey.report.md)。本轮不提交、不推送。

## 实现与 CE 依据

- `Combat.c:868-896`：新增 `AttackVerbs.ts`，逐行收录 `Globals.c:1167-1393` 的 68 个 `monsterText[].attack`，沿用 web 三个 ID 别名。动词选择无随机调用。
- `Combat.c:1290-1397,1453-1463`：`CombatText.ts` 是纯函数，以攻击结果、可见性和翻译器构造句子；`Game.reportAttack` 为玩家、盟友、敌对/纷争怪、几何攻击与 BE_ATTACK 远程攻击共用入口。保留零伤害、突进、麻痹、熟睡、偷袭、被困的说明；致死使用 defeated/dispatched/destroyed；默认不带伤害数值或武器名。
- `Combat.c:1556-1615`、`Time.c:2839`、`IO.c:3468`：Logger 缓冲战斗消息；普通消息先 flush；回合尾 flush。满 198 字符的缓冲提前 flush。各句独立入档与折叠计数；侧栏/紧凑条在同回合、同颜色、无重复计数/确认要求且宽度允许时，以分号合并显示副本，不改历史。显示宽度用 web 字符预算 100，不仿终端字节布局。
- 与 X3-U4 的 `blockCombatText` 共用开关：抑制非致命命中/未命中，保留致命句。不可见双方仅出远处战斗声，每回合最多一次；死亡/摧毁分别出声音提示，不泄露名字或数值。
- `Time.c:2805-2825`：回合尾真实可见实体判定中接入符文提示；仅装备中的 slaying/immunity、匹配类别、直接视野且未提示时生效。排除透视、心灵感应、隐形、潜水、休眠等仅位置可知场景。打 `ITEM_RUNIC_HINTED` 并使用既有确认级消息；不鉴定符文。已有 `runicKnown` 对应 CE 已同时获得 HINTED 的已知符文。未知物品首见后可显示“未知符文”。
- `Items.c:1314-1333,1373-1437,7176-7233`、`IO.c:2585-2587`：`c` 按 CE 区分命名种类与题字单件；`R` 打开重标字母。单件题字写入 `Item.inscription`，纳入显式实体快照合同；字母沿用 `inventoryLetter`，占用则交换。操作不耗回合、不抽 RNG。

`TimeCoordinator.ts` 保持原样；`Game.performPlayerAction` 仅在既有 inventory_action 的合法值中增加 relabel，移动/麻痹/幻觉段保持原样。未改伤害、命中、掉落、地形与生成算法。`CombatSystem.attack` 仅在既有结算完成后计算文本元数据，不改结算值。

## 动词分级与中文对照

CE 的 percentile 为 `max(damage - trunc(lower * adjustment), 0) * 100 / max(1, trunc((upper-lower) * adjustment))`（整数除法）。玩家的 lower/upper 已经过装备附魔/力量缩放；怪物 adjustment 使用原弱化倍率。N 个动词每级宽度 `floor(100/N)`，先把 percentile 限制在 `0..floor(100/N)*N-1`，再取等级。N=2 的分界 50；N=3 为 33/66；N=4 为 25/50/75；N=5 为 20/40/60/80。玩家空手固定 punch（拳击）；怪物不可见或玩家幻觉时固定 hits（击中）。吸血鬼的代词转义按可见性与性别旗标处理，无 RNG。

以下每行按最低→最高伤害等级列出，同一位置逐个对应：

| web ID | CE 动词 | 中文 |
| --- | --- | --- |
| player | hit | 击中 |
| rat | scratches / bites | 抓伤 / 咬伤 |
| kobold | clubs / bashes | 棒击 / 重击 |
| jackal | claws / bites / mauls | 爪击 / 咬伤 / 撕咬 |
| eel | shocks / bites | 电击 / 咬伤 |
| monkey | tweaks / bites / punches | 拧掐 / 咬伤 / 拳击 |
| bloat | bumps | 撞击 |
| pit_bloat | bumps | 撞击 |
| goblin | cuts / stabs / skewers | 割伤 / 刺伤 / 刺穿 |
| goblin_conjurer | thumps / whacks / wallops | 捶击 / 敲击 / 猛捶 |
| goblin_mystic | slaps / punches / kicks | 拍击 / 拳击 / 踢击 |
| goblin_totem | hits | 击中 |
| pink_jelly | smears / slimes / drenches | 涂抹 / 黏液侵蚀 / 浸透 |
| toad | slimes / slams | 黏液侵蚀 / 猛撞 |
| vampire_bat | nips / bites | 轻咬 / 咬伤 |
| arrow_turret | shoots | 射中 |
| acid_mound | slimes / douses / drenches | 黏液侵蚀 / 泼洒 / 浸透 |
| centipede | pricks / stings | 刺中 / 蜇刺 |
| ogre | cudgels / clubs / batters | 棍击 / 棒击 / 痛击 |
| bog_monster | squeezes / strangles / crushes | 挤压 / 绞缠 / 碾压 |
| ogre_totem | hits | 击中 |
| spider | bites / stings | 咬伤 / 蜇刺 |
| spark_turret | shocks | 电击 |
| wisp | scorches / burns | 灼伤 / 烧伤 |
| wraith | clutches / claws / bites | 攫住 / 爪击 / 咬伤 |
| zombie | hits / bites | 击中 / 咬伤 |
| troll | cudgels / clubs / bludgeons / pummels / batters | 棍击 / 棒击 / 猛砸 / 连捶 / 痛击 |
| ogre_shaman | cudgels / clubs | 棍击 / 棒击 |
| naga | claws / bites / tail-whips | 爪击 / 咬伤 / 尾鞭抽击 |
| salamander | whips / lashes | 鞭击 / 抽打 |
| explosive_bloat | bumps | 撞击 |
| dar_blademaster | grazes / cuts / slices / slashes / stabs | 擦伤 / 割伤 / 切伤 / 劈砍 / 刺伤 |
| dar_priestess | cuts / slices | 割伤 / 切伤 |
| dar_battlemage | cuts | 割伤 |
| acidic_jelly | burns | 烧伤 |
| centaur | shoots | 射中 |
| underworm | slams / bites / tail-whips | 猛撞 / 咬伤 / 尾鞭抽击 |
| sentinel | hits | 击中 |
| dart_turret | pricks | 刺中 |
| kraken | slaps / smites / batters | 拍击 / 重击 / 痛击 |
| lich | touches | 触碰 |
| phylactery | touches | 触碰 |
| pixie | pokes | 戳击 |
| phantom | hits | 击中 |
| flame_turret | pricks | 刺中 |
| imp | slices / cuts | 切伤 / 割伤 |
| fury | drubs / fustigates / castigates | 殴打 / 鞭打 / 痛打 |
| revenant | hits | 击中 |
| tentacle_horror | slaps / batters / crushes | 拍击 / 痛击 / 碾压 |
| golem | backhands / punches / kicks | 反手击打 / 拳击 / 踢击 |
| dragon | claws / tail-whips / bites | 爪击 / 尾鞭抽击 / 咬伤 |
| goblin_warlord | slashes / cuts / stabs / skewers | 劈砍 / 割伤 / 刺伤 / 刺穿 |
| black_jelly | smears / slimes / drenches | 涂抹 / 黏液侵蚀 / 浸透 |
| vampire | grazes / bites / buries $HISHER fangs in | 擦伤 / 咬伤 / 将獠牙刺入 |
| flamedancer | singes / burns / immolates | 燎伤 / 烧伤 / 焚烧 |
| spectral_blade | nicks | 划伤 |
| spectral_image | hits | 击中 |
| guardian | strikes | 打击 |
| winged_guardian | strikes | 打击 |
| charm_guardian | strikes | 打击 |
| warden_of_yendor | strikes | 打击 |
| eldritch_totem | strikes | 打击 |
| mirrored_totem | strikes | 打击 |
| unicorn | pokes / stabs / gores | 戳击 / 刺伤 / 贯穿 |
| ifrit | cuts / slashes / lacerates | 割伤 / 劈砍 / 撕裂 |
| phoenix | pecks / scratches / claws | 啄击 / 抓伤 / 爪击 |
| phoenix_egg | touches | 触碰 |
| ancient_spirit | whips / lashes / thrashes / lacerates | 鞭击 / 抽打 / 猛抽 / 撕裂 |

## 伤害数值扩展入口

现有 P2-6 显示设置新增“显示伤害数值”，默认 `false`。通过 `formatCombatText(event, { showDamage, translate })` 的可选格式参数附加数值。例如默认“你击中老鼠”，开启后“你击中老鼠（8 点伤害）”。战斗数值浮字也只在此设置开启时绘制；仅渲染器过滤，不改变引擎浮字数组及任何结算。

设置仅存 `brogue-web-display-v1`；关闭时省略字段，缺字段/非法值回退 false。存档、录制命令、RNG checkpoint 均不加入此设置。测试从同一快照执行同一攻击，比较除日志外的完整快照及两条 RNG 状态，开/关一致。既有物品/法术效果的独立消息不扩入 C08 物理 attack() 文案改造。

## 怪物类别名册

勘察时缺失的表在本基线已有 `Combat/MonsterClass.ts`（U15d 战斗侧成员）和 `ItemLoader.CE_MONSTER_CLASSES`（生成权重/层限）；本轮复用并导出 15 类成员，不另造第三份，不改生成抽签。新增测试直接解析 CE `Globals.c:1416-1433`，逐类比较全部成员，保留重叠归属。`MK_GOBLIN_CHIEFTAN → goblin_warlord`、`MK_ACID_JELLY → acidic_jelly`、`MK_WILL_O_THE_WISP → wisp` 与既有映射一致。名册对照覆盖每类；实例提示测试覆盖匹配/非直视、武器与护甲同时提示、一次性、保存恢复与零 RNG。

## 题字流程、存档与录像

- 武器/护甲/护符，以及实例或种类已知的魔杖/法杖/戒指：`c` 选物后直接题字。
- 未知魔杖/法杖/戒指：先问“为这一件物品题字，而不是给所有同类物品命名？”；“是”进入单件题字，“否”进入种类命名，取消不改名字。文本框在选择范围前不显示。
- 未知药水/卷轴：命名种类；已知药水/卷轴，以及食物、金币、钥匙、护身符和流明石不列入 `c` 筛选。
- 输入最长 29 个字符，控制字符移除；空字符串清除题字。题字跟在物品 displayName 后，识别种类不丢题字。
- `R` 选物后输入 a-z，接受大写并转小写；占用则交换，非法输入不改字母，同字母提示已标记。
- UI 的未完成选择留在组件中。最终 `call|字母|标题` / `inscribe|字母|文字` / `relabel|旧字母|新字母` 经过既有命令边界，明确编码用户的范围选择；回放不重问 UI。新增新局录制→回放→seek 用例保持零 OOS。

## 守卫前提与反事实证据（交裁决）

[隔离 HEAD 反事实](x3-u8c-evidence/counterfactual.json) 从 `git show HEAD` 建立临时源码树，原测试的 5 个冲突断言全部通过；[当前首轮](x3-u8c-evidence/targeted-first.json) 对应 5 项失败。未通过改回旧文案或即时写日志迁就守卫。

| 文件 | 原前提冲突 | 仅修订的前提 | 保留的约束 |
| --- | --- | --- | --- |
| x3_u4_auto_travel | combat(death) 立即触发日志 | 检查前显式 flush | 普通/折叠消息扰动次数、恢复无扰动、block 抑制 |
| x3_u6_messages | combat(a) 立即入档 | 检查前显式 flush | 跨回合 FOLDABLE 不折叠、非 FOLDABLE 可折叠 |
| p1_37 AD5b | 直接调用攻击后立即读日志；致死仍期待命中句 | 在读取前 flush，目标 1000 HP 专门验证存活句 | 猛烈突刺中文、普通命中无突刺 |
| p4_7 穿刺顺序 | 1 HP 致死期待 hit 句 | 读取 CE defeated 致死句 | 远目标先于近目标、两者死亡、玩家不移动 |
| p4_7 钝器恢复 | 所有怪物命中动词恒为 hits | 按战斗通道/受害方/非 miss 识别分级动词 | 200-tick 窗口恰好一次反击、击退与时序断言 |
| p4_6 穿刺顺序 | 直接 takeTurn 后立即读日志；致死仍期待 hits the | 显式 flush，远端匹配 defeated your，近端匹配分级战斗句 | 远端死亡、玩家 HP 195、远端消息先于近端 |
| b_1 双速/分支优先级（2 项） | 反击计数固定匹配 hits you | 按战斗通道/受害方/非 miss 计数 | 刺剑 2 次/剑 5 次、200-tick 窗口 1 次，恢复量断言不改 |
| x4b 日志归档 | 战斗句固定为大写 You hit/missed/backstab | 检查 FOLDABLE 战斗日志调用并补归档存在断言 | 战斗、拾取、发现仍入档 |
| scroll_effects 失和目标（2 项） | 直接 takeTurn 后立即读日志，命中固定为 turns on | 显式 flush，按 FOLDABLE 消息同时核对攻击者与目标名 | 相邻怪物被选中、全部 8 方向、原 HP 检查 |

额外四项冲突的 [修订前结果](x3-u8c-evidence/additional-before.json) 为 0/4，[隔离 HEAD 反事实](x3-u8c-evidence/counterfactual-additional.json) 为 4/4。X3-U4 自动战斗与 X3-U2 解救俘虏的负向文案正则改为 FOLDABLE 通道检测（解救仍检查 vomit），防止旧字符串在 CE 句式下空转；没有降低禁止输出战斗消息的约束。

完整全量另发现上述两项 scroll_effects 前提冲突；[隔离 HEAD](x3-u8c-evidence/counterfactual-scroll.json) 2/2 通过后仅修观察前提，合计 11 项冲突均附原行为反事实证据。W-4 的三项失败是代码缺少翻译未初始化回退，修 `CombatText` 为返回英文默认句，未改 W-4 守卫；新增未初始化翻译专项。随后 [三个整文件复验](x3-u8c-evidence/full-failure-recheck.json) 63/63 通过。

[前提复验](x3-u8c-evidence/premise-recheck.json)：5/5 通过；最终 [11 文件整组复验](x3-u8c-evidence/final-targeted.json) 234/234 通过，含额外四项及强化的负向守卫。`p1_30` 发现的退役键移入 legacy，未改守卫；P2-6 存储合同保持关闭默认字段省略，未改守卫。[反查清单](x3-u8c-evidence/test-selection.json) 含 125 个直接引用测试、80 个文件读取测试（递归追踪扫描辅助模块，允许包含夹具读取的超集）、19 个固定回归项，去重 157 文件；全量发现 235 测试文件（其中 generation_baseline 单列 drift）。明确包含 c_4a_terrain_catalog、p1_30、u24、repo_hygiene。

## 浏览器与执行记录

项目现有 Playwright：[脚本](../../scripts/x3-u8c-browser.mjs)、[结果](x3-u8c-evidence/browser-results.json)。实际覆盖默认/开启数值、显示设置刷新后保持、需确认级符文提示、未知物品确认、单件题字、同类命名、R 交换字母、390×844 手机背包。页面与控制台错误 0。最终复验曾在 Vite 热更新后遇到手工动态 import 的 Settings 设置未作用于 Game 的测试装配问题；重启本任务 Vite 后相同代码通过，未修改引擎以迁就此问题。桌面及手机整页截图已打开人工核验，PNG 均在项目已忽略的 evidence 目录，不提交。

按 develop-web-game 技能执行现成客户端，输入后状态见 [state-0.json](x3-u8c-evidence/state-0.json)。其 canvas 导出在本机 WebGL 下为黑图，因此视觉证据使用上述有头浏览器整页截图。

本工作树最初无 node_modules，npx 尝试联网失败；复制本机已安装依赖到当前工作树后离线运行，不改 lockfile、不共享依赖缓存。首轮全量及全部定向/反事实测试单 worker、禁止文件并行，与本机 U8a 控制并发。确认其他测试负载退出后，最终全量限制 2 worker，drift 保持单 worker。尝试 nice 降优先级被沙箱拒绝但命令继续执行，未把降优先级计作已完成。

## 黄金 trace 与全量门禁

[原观察器隔离对照](x3-u8c-evidence/trace-attribution.json)：UR2、UR3、UR4 的 HEAD 与 current 原始输出均相等；UR3 额外核验剔除日志后的世界/RNG 哈希相等。黄金 trace 无需重录，也未修改。

[边界审计](x3-u8c-evidence/boundary-audit.json) 确认 TimeCoordinator 原样、移动/麻痹/幻觉段原样、已有 RNG 调用点/顺序相同。

首轮预检类型/构建因新增测试未使用的 import（TS6133）失败；在全量进程已完成 5 文件 94 项时主动中止，保留 [原始输出与输入核验](x3-u8c-evidence/preflight-interrupted/gate-integrity.json)，冻结输入零变化。该轮不是完整全量结果。随后移除导入、修正复选框尺寸、归档退役翻译键并完成上述反事实/前提修订，类型预检 exit 0。最终结果见下表。

首轮完整全量 [结果](x3-u8c-evidence/first-full/gate-results.json)：234 文件，4433 passed / 5 failed / 8 skipped / 5 todo，用时 7053 秒；类型、构建、drift（1/1）均通过，[1062 个冻结输入零变化](x3-u8c-evidence/first-full/gate-integrity.json)。没有超时失败。五项分别为上述两项卷轴旧前提和三项未初始化翻译异常，全部已在 63/63 整组复验中通过。随后从修正后的冻结输入重新执行完整门禁。


### 最终完整门禁

修正后从头完整运行，没有用首轮与局部复验拼接为绿灯。[命令/退出码/耗时](x3-u8c-evidence/gate-results.json)，[逐文件结果](x3-u8c-evidence/actual-tests.md)，[反查覆盖证明](x3-u8c-evidence/coverage.json)。

| 门禁 | 最终结果 | 耗时 |
| --- | --- | ---: |
| `npx --no-install vue-tsc -b` | exit 0 | 4.394 s |
| `npm run build` | exit 0 | 6.279 s |
| 完整 `npm test -- --maxWorkers=2` | 234/234 文件，4439 passed / 0 failed / 8 skipped / 5 todo | 3097.911 s |
| `npm run test:drift -- --maxWorkers=1 --no-file-parallelism` | 1/1 passed，exit 0 | 25.306 s |

8 skipped / 5 todo 均为既有项；没有放宽门限、缩减样本或新增跳过。最终 U8c 专项 14/14，scroll_effects 20/20、W-4 29/29；UR2/UR3/UR4 全部用原黄金通过。1062 个冻结输入在全量与 drift 期间零变化，见 [冻结校验](x3-u8c-evidence/gate-integrity.json)。

反查集合 157 文件（含 80 个直接/间接读文件的守卫）全部执行；指定守卫 `c_4a_terrain_catalog` 30/30、`p1_30` 16/16、`u24_hardcoded_text` 3/3、`repo_hygiene` 2/2 全通过，均未改守卫。补充扫描其余 fs 导入，仅发现写 evidence 的使用，没有漏掉源码读取路径。

最终边界与文件检查由 [审计脚本](../../scripts/x3-u8c-final-audit.mjs) 重跑：TimeCoordinator、移动/麻痹/幻觉段原样；既有 RNG 调用点及顺序原样；黄金与 lockfile 未改。CRLF=0，diff 检查通过，9 张 PNG 全部 ignored，暂存区为空。本任务浏览器及 Vite 预览已关闭。未提交、未推送；没有剩余实现或门禁执行 TODO。上述 11 项旧守卫前提修订及反事实证据按任务书交验收裁决。

> 验收方注（2026-09-29）：`ur4-{head,current}.json.gz`、`full.json`、`first-full/full.json` 四个原始大文件按约定未入库，保存在验收方本机 `~/.cache/brogue-evidence-raw/x3-u8c/`。
