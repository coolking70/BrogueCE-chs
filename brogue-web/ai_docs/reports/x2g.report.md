# X2g：地衣、黑暗投掷、腐气与潜没

执行范围：`ai_docs/tasks/x2g.prompt.md`，权威规格为 X-1 §4 N07、§7.1。本地 Mac 轨，仓库根执行、项目 `brogue-web/`。起点 HEAD `b5c0d481831b5f32fdac79892168b33df915becc`；未提交、未暂存。

四族原生效果及各自的数据、状态、交互、显示、保存闭环已完成；地衣与黑暗药水独立恢复自然池。最终冻结验收全部通过，完整npm test为206文件、3876通过、0失败。16份旧前提守卫修订的反事实证据与验收提案见§4。

## 1. CE 口径与四族闭环

以仓库内 `BrogueCE-master/src/brogue/` 和 `src/variants/GlobalsBrogue.c` 为依据。地衣是 **SURFACE 地形**，不是新怪物或旧 `GasType.CREEPING_DEATH` 气体。潜没是独立运行态，不能由 `MONST_SUBMERGES` 能力代替；也并非绝对不可见、不可近战攻击：站在深水且未悬浮的观察者能看见，队友共享知识；实际投掷物及 bolt 碰撞仍穿过潜没者。任务书的简写与这些 CE 细节不一致时采用 CE。

### 1.1 lichen / creeping death

- 数据：追加 `LICHEN`，SURFACE、drawPriority=60、着火概率50、`T_CAUSES_POISON | T_IS_FLAMMABLE`、`TM_STAND_IN_TILE | TM_VANISHES_UPON_PROMOTION`。`DF_LICHEN_PLANTED`、`DF_MUTATION_LICHEN` 为70/60；`DF_LICHEN_GROW` 为2/100并带 `DFF_BLOCKED_BY_OTHER_LAYERS`。对应 Globals.c:451、660、677、783。
- 来源：喝下和投掷均调用种植 DF；infested 突变死亡调用尸体 DF。Items.c:7012–7015、8133–8135；突变 DF 使用既有死亡触发守卫，不重复触发。
- 状态与交互：接触后毒时长至少5，浓度不继续叠加；飞行/悬浮、无生命与无敌免疫。原地晋升后重种并向邻格按2%繁殖，其他阻挡层阻止传播，可燃烧清除。Time.c:498–523 的 `addPoison(max(0,5-current),0)` 原式落地；沿用现有地形规避、晋升和火焰管线。
- 显示：紫红地衣字形、地形名称、首次中毒与突变尸体消息；不是只有日志。
- 保存：现有 U01 地形层、毒状态、毒浓度与突变字段承载，未增加推断式恢复；整份快照与下一系统回合对照通过。

### 1.2 darkness 投掷

- 数据：`DARKNESS_CLOUD` GAS层、无气体伤害标志；`DF_DARKNESS_POTION` 初始volume=200，复用 `DARKNESS_CLOUD_LIGHT` 负光源。Globals.c 的 tile/DF 行及 Items.c:7003–7004。
- 状态与交互：投掷生成真实气层，进入现有扩散、消散和光照流程；不会给玩家施加喝下的 darkness 状态。喝下仍使用原有状态、矿灯缩减和渐退逻辑，两者共存。
- 显示：黑暗区域由负光照产生，保留下层地形字形；实际光照读数和浏览器画面验证。
- 保存：GAS层、volume和喝下状态均沿现有快照保存；恢复后光照重新计算。

### 1.3 ROT_GAS

- 数据与来源：追加 GAS层 `ROT_GAS`，可燃、致恶心、快速消散；`DF_ROT_GAS_BLOOD` 基值12，`DF_ROT_GAS_PUFF` 为15。Globals.c:649、664、1075。僵尸在 Time.c:2682–2692 的客观100-tick块喷气，不依赖动作速度；替换了死亡DF的突变不会保留普通喷气。
- 流血：Combat.c:1827–1837 的两次整数除法先截断，再乘100；实际受伤经盾结算后出气，完全护盾吸收不流血。近战、投掷、bolt、毒、火、坠落、爆炸、持续地形伤害和即死符文将明确的 Grid 传入统一伤害出口；CE `inflictLethalDamage` 同样流血。
- 状态与交互：复用20回合恶心出口，尊重无生命、无敌、呼吸护甲、潜没免疫；点燃走现有 GAS_FIRE/volume 清零，扩散和快速消散沿用 CE 气层流程。僵尸自身不具有 `MONST_INANIMATE`，也会受恶心影响。
- 显示：IO.c:1196–1204、1316–1334 的 `min(90,30+volume)` 混合前景与背景，保留底层字形。直接读取权威气层，刚流血或喷气、旧 gasGrid 镜像尚未刷新时仍可见。浏览器 QA 发现漏染色后补齐。
- 保存：GAS层与volume原样往返；没有新增镜像枚举或第二份状态源。

### 1.4 MB_SUBMERGED

- 状态：`Monster.submerged` 为实际布尔值，加入 U01 `MONSTER_FIELDS`。出生时按 CE 谓词初始化；状态递减后，符合条件且尚未潜没者掷20%，成功潜入，液栖怪失败转逃跑。已潜没者不重复消耗该骰；从逃跑恢复追踪的血量/恐惧门按 Monsters.c:1986–2000。
- 谓词：Monsters.c:692–700 原函数要求能力、允许潜没的地形、无通行障碍、非抓/被抓/囚禁；岩浆还需火免疫或无敌。临时悬浮不是潜入谓词的否决条件。原始 C 函数穷举1024组。
- 交互：攻击浮出（第一次抓取有 CE 例外）；离开可潜没地形、blink、吸收飞行能力时清除。潜没者不触发地形陷阱；已浮出但具有潜水能力且所在格允许潜水者同样不会踩压板（Time.c:241–245）。潜没者不受气体恶心/麻痹、持续环境伤害、爆炸、点火和蛛网缠绕；**混乱和接地地衣毒并不因此免疫**。Time.c 各处逐条接线。
- 可见与目标：共用可见性出口覆盖主画面、侧栏、文本与怪物称谓；心灵感应只显示位置标记，水上不泄露身份。自动 bolt 目标排除潜没者，实际 bolt/投掷碰撞及选线计分始终跳过（包括水下可见时）；闪现落点占用按CE先洗牌列/行、再扩曼哈顿半径安置潜没者，无合法位置则静默移除，不触发血雾、死亡DF或掉落；鞭矛寻敌、友军及纷争目标采用对应隐藏规则。
- 保存：保存的是运行态而不是能力反推；载入、下一回合、楼层实体图均由既有显式 codec 承载。
- 补充逐行核对：选线与模拟落点采用 Items.c:4220–4222、4309–4313 的独立 `!MB_SUBMERGED`；闪现安置采用 Items.c:5516–5537 和 Monsters.c:3927–3954 的一次列洗牌、一次行洗牌与扩曼哈顿半径顺序。

## 2. 自然池恢复（独立变量）

上述闭环完成后，删除 Game 的 creeping_death 过滤和 darkness 的 `excludeFromGeneration`。常规抽取、类别限定蓝图均使用同一生成池；两者各保留 CE `GlobalsBrogue.c:679/681` 的 frequency=7。未让 minDepth/maxDepth 介入 chooseKind。自创药水、符文、法器的退池约束保留。

`submerged → pool` 的唯一行为变化为两种原生药水回池，源码差分见 [pool-source-diff.patch](x2g-evidence/pool-source-diff.patch)。药水种类会改变计量计数；力量药水有独立落位路径，故不能假定只改名称而不改 RNG。最终自然生成样本中地衣7件、黑暗9件；其余生成影响见下一节。`pool-paths` 观察器确认 seed777/D8 的第43次造物调用：相同 RNG 435838→435840，回池前选择力量、回池后选择火免疫；到下一次造物入口时两者已为435850和435841，分别在落位阶段耗10次和1次。此分支对应 CE Items.c:730–734。原始记录见 [pool-path-differences.json](x2g-evidence/pool-path-differences.json)。

## 3. 生成与 trace 归因

初始 `test:drift`、深层基线均先通过，所有旧基线 SHA-256 先登记于 [baseline-before.json](x2g-evidence/baseline-before.json)。

按 `s0 → lichen → darkness → rot → submerged → pool → review` 保存生产源码快照，以同一观察器覆盖4种子 × D1–40。浅层104层、深层56层独立统计；不能将本轮回归基线称为 CE 地图一致性 oracle。

历史快照还保留了与生产模块同目录的测试文本；生成归因和最终生产一致性比较排除 `.test.ts`。实际终验所执行的测试版本由最终冻结输入清单记录，旧守卫另有原版与反事实档案。

| 单变量 | D1–26 | D27–40 |
|---|---|---|
| lichen | 所有观察字段不变 | 不变 |
| darkness | 不变 | 不变 |
| ROT_GAS | 不变 | 不变 |
| 潜没 | 104层 active 快照、31层 dormant 快照增加运行态；47层有潜没个体 | 52层 active、14层 dormant；18层有潜没个体 |
| 回池 | 61层物品状态、59层药水清单、101层计量记录变化；19层 RNG/金币，18层完整格子状态；2层地形指纹 | 56层计量记录；14层 RNG/金币/格子状态；1层地形指纹 |
| 最终复核修正 | 与 pool 所有观测相同 | 相同 |

所有阶段派生通行/遮挡属性与权威层标志不一致数均为0；怪物数量/种类、物品总数、宝石产量未漂移。潜没样本总计380个。三个地形指纹变化均在seed777：D8、D10、D27。详见 [generation-attribution.json](x2g-evidence/generation-attribution.json)。

复核期间完善的腐气直接伤害出口/染色，以及潜没抓取/纷争筛选，另建立 `rot-complete` 与 `submerged-review` 单族反事实分支，验证其生成和 UR2/3/4 均不改变。后续即死伤害接线、潜没选线/闪现/陷阱边界、环境死亡归属分别保存为 `rot-lethal`、`submerged-complete`、`final`，逐段复核同一160层和三组trace；结果登记于 `lethal-attribution.json`、`subm-final-attribution.json`、`death-final-attribution.json`。保留原时序源码快照，不把事后修正冒充原阶段实现。

UR2、UR4 原方法候选全部不变；UR3 在潜没阶段120处摘要变化，回池阶段116处。UR3 分解记录原摘要、各快照字段摘要、完整机器观察、RNG和日志；潜没只增 `submerged` 字段，回池保留真实地图/计量/随机变化，不通过扩大归一化掩盖。最终 review 不再增加 trace 变化。所有120个原UR3摘要在各阶段均与原观察器吻合；潜没归一化后剩余差异0，review剩余差异0。回池116个摘要均保留实质快照差异：run计量记录116处、grid与缓存levels各21处、物品5处、waypoints4处、RNG22处；机器药水名称的逐值变化另列29条。详见 [trace-audit-summary.json](x2g-evidence/trace-audit-summary.json)，精确归一化字段值另存压缩证据。

## 4. 守卫、反事实与验收项

新增 `x2g_native_effects.test.ts` 共17项行为测试。最终冻结前的14文件定向复核共41项通过，覆盖全部新增测试及发现轮红灯；该定向结果不代替全量验收。原始 C oracle 由 `scripts/x2g-ce-oracle.py` 提取本地 CE 原函数/原算式，编译 `cc -std=c99 -O0`：1024潜没资格、16观察者、8000腐气流血组合，共9040组。适配器只提供结构、标志和地形查询，不重写被测判定。

10个隔离反例全部被新测试检出：毒浓度累加、错误繁殖率、删除黑暗光源、错误整数截断、错误喷气量、错误潜入概率、删除潜没隐藏、错误 bolt 碰撞、遗漏保存字段、错误气体染色权重。见 [negatives.json](x2g-evidence/negatives.json)。

十六份原守卫完整保留为 `original-*.test.ts.txt`，首批五份在 HEAD 的生产源码快照上 **65通过/0失败**，在回池候选上 **59通过/6失败**。全量期间另发现十份目录或调用上下文守卫：原版定向检查在 HEAD **17通过/0失败**，在 review **0通过/17失败**；补齐前提后 **17通过/0失败**。另有 Discoveries 整文件在 HEAD **3通过/0失败**，在 review **2通过/1失败**，修后 **3通过/0失败**。十六份原文件的 SHA-256 均核对 HEAD，见 [premise-original-provenance.json](x2g-evidence/premise-original-provenance.json)。这些失败源于载体未实现、目录未收录或仍退池的旧前提。以下前提修订提交验收方裁决：

| 文件 | 原前提及反事实失败 | 修订 |
|---|---|---|
| c_7_lighting | tile期望表不含新3行；非零光源集合缺 darkness，共2断言 | 加入3行精确光源值，继续穷尽比对全目录 |
| g_2_gas_df_wiring | ROT/DARKNESS无tile/DF | 保留HEALING缺载体约束，为新2气体和DF增加正向精确断言；未新增旧 GasType 别名 |
| invented_content_pool | darkness仍必须退池 | 移出原生待补列表，并校验两者各frequency=7；自创排他断言不变 |
| t_1_tail | creeping death蓝图抽样次数必须0 | 必须实际出现；frequency=0项、类别RNG次数与其他分布约束不变 |
| u_15e_potions | darkness不在生成池 | 要求进入；原状态时长与药水语义断言不变 |
| c_4b_dungeon_feature | DF历史目录、外部来源起点和调用方清单缺新增链，3项 | 保留135条历史投影；新增6条精确DF值、5个来源起点和Monster流血调用方；完整闭包与源码扫描不变 |
| c_4a_terrain_catalog | 历史135行投影和总数190缺新增3行，1项 | 历史投影仍135，总数193；保留所有键和全部字段的逐项检查 |
| c_4a_0_layer_model | layer/priority完整期望表缺新增3行，1项 | 补SURFACE/GAS/GAS及60/35/35，继续整表严格相等 |
| r_1_appearance | 枚举计数及可见/记忆黄金表缺3行，3项 | 原190行CE黄金表不动，独立从CE提取新增3行；全193行可见和记忆态逐项核对 |
| w_4_bolt_reflection / u_06_monster_damage | BE_ATTACK 调用 options 只允许旧 isWeaponAttack 字段，共5项 | 精确期望增加当前 Grid；仍要求 isWeaponAttack=true，原命中、伤害、反射、武器免疫和RNG检查不变 |
| u_17a_df_transaction / u_08_terrain_bolts | 历史DF投影140/139条未扣除新增6条，各1项 | 历史投影维持原数量，新增6条由C-4b及X2g精确值守卫覆盖 |
| b_2_throwing | darkness投掷未实现、仍退池，1项 | 完整DF链后要求进入自然池，frequency=7 |
| u_14a_status_gaps | darkness与fear均退池，1项 | 只更新darkness入池；fear源码注释及恐惧卷轴退池保持不变 |
| engine/UI/Discoveries.test.ts | 药水发现表只有15种，1项 | 黑暗入池后精确16种，正向检查黑暗/地衣身份；鉴定、真名、未知概率和法杖隐藏附魔断言不变 |

W-15 原死亡次数守卫发现真实实现错误，**没有修改该守卫**：环境伤害改走 `Monster.takeDamage` 后，旧分支重复调用 `die()`。移除坠落到达、燃烧、爆炸及持续地形伤害中的重复死亡/吸收中断调用，保持盾结算和死亡归属；原W-15及新增三类致死场景均要求死亡回调恰一次。另增即死符文血雾测试，旧实现红、补齐Grid上下文后绿；新增潜没选线、闪现落点/静默移除、踩陷阱三个边界测试也保留修前红与修后绿。见 `death-fixed.json`、`lethal-test-summary.json`、`subm-edge-summary.json`。

未改 UR2/3/4 比较规则，未删除真正的语义守卫，未放宽统计阈值。原始前后结果见 `premises-s0.json`、`premises-pool.json`、[source-premises-summary.json](x2g-evidence/source-premises-summary.json)、[catalog-premises-summary.json](x2g-evidence/catalog-premises-summary.json)、[extra-premises-summary.json](x2g-evidence/extra-premises-summary.json)、[discoveries-premise-summary.json](x2g-evidence/discoveries-premise-summary.json)。新增外观值由 `scripts/x2g-ce-appearance.mjs` 直接读取 CE 的 tile、颜色和平台字形源码生成，没有从 web 的显示实现反推黄金值。

R∪S 用生产文件反向 import 闭包、效果/状态符号、全部读源码测试并集生成，共199个文件，最终全量199/199执行。强制覆盖 p1_30、U24、U01/U03、U13、U15e、U17a–f、U18、f_*、g_*、invented_content_pool、w_10/w_15、UR2–UR4，零遗漏；65份读源码守卫全部执行。证据见 [closure-coverage.json](x2g-evidence/closure-coverage.json)、[named-guard-coverage.json](x2g-evidence/named-guard-coverage.json)、[source-guard-coverage.json](x2g-evidence/source-guard-coverage.json)。

## 5. 浏览器与人工检查

按 develop-web-game 技能运行 Playwright 客户端及定制场景：真实菜单开局、按键背包开关/等待，场景通过真实引擎入口设置。检查了地衣投掷/饮用、负光黑暗、腐气染色和扩散、水上隐藏/心灵位置/水下识别/攻击浮出/保存恢复；最终14个场景另含即死符文腐气与闪现安置潜没者，浏览器错误数组为空。见 [browser.json](x2g-evidence/browser.json) 和 `browser-*.png`。

人工打开全页截图确认腐气扩散黄褐染色、地衣字形、黑暗区域和潜没出口。技能通用客户端的 canvas 导出为黑图，不能用作视觉通过证据；保留该原始结果，视觉结论来自已打开核验的全页截图。

## 6. 最终门禁、基线登记与限制

完整发现轮于2026-09-27 08:00:40–09:04:57（Asia/Shanghai）结束：206文件，3851通过、20失败、8既有跳过、5既有todo；build、浅层drift、独立深层及diff-check均通过。19项失败为上文列明的旧前提，1项为W-15发现的重复死亡实现错误，均已保留修前结果。发现轮期间生产源码和测试保持review版本，但两个辅助脚本发生变化，因此明确不作为最终冻结验收；全套结果归档于 [first-full](x2g-evidence/first-full/README.md)。更早一次中止的预检登记在 `preflight-status.json`，不计入完成的门禁。

最终复跑于 **2026-09-27 09:10:26–09:47:23（Asia/Shanghai）** 完整执行。以下用时按命令开始至退出计，包含启动开销。

| 门禁 | 结果 | 用时 |
|---|---|---:|
| `npm run build` | 退出0 | 7.249秒 |
| `npm test -- --maxWorkers=4`（default与JSON双reporter，无文件或名称筛选） | 206文件；3876通过、0失败、8既有跳过、5既有todo；退出0 | 2145.183秒 |
| `npm run test:drift -- --maxWorkers=1` | 1/1，4种子×D1–26；退出0 | 25.590秒 |
| `npx vitest run src/test/u_26a_deep_baseline.test.ts --maxWorkers=1` | 1/1，4种子×D27–40；退出0 | 38.021秒 |
| `git diff --check` | 退出0 | 0.668秒 |

最终摘要见 [final-summary.json](x2g-evidence/final-summary.json)，逐文件结果见 [final-results.md](x2g-evidence/final-results.md)。全源码树应执行206份测试、实际206份，缺失及额外文件均为0；浅层漂移按项目原命令独立执行。13项既有跳过/todo集合与完整发现轮完全相同，所在五份测试文件与入场HEAD逐字节相同，见 [deferred-provenance.json](x2g-evidence/deferred-provenance.json)。

**最终冻结声明：**959个输入覆盖生产源码、测试、脚本、配置、公共资源、CE源码和被测试读取的外部夹具。整轮前后新增、删除、内容变化均为0；两份冻结清单文件的SHA-256均为 `91b0e84d36b1525f335b002d348994007d98f4620d582a67b73d509a57376dac`。最终111份生产文件逐字节等于最后归因候选，见 [production-final-proof.json](x2g-evidence/production-final-proof.json)；浅/深/trace及P2基线均符合下表登记，意外变化0。被检代码输入CRLF为0，点名守卫与R∪S缺失0。

终验后只补报告、进度与派生验收证据，未修改冻结输入，未再次捕获基线。浏览器与本轮开发服务器均已关闭；HEAD保持 `b5c0d481831b5f32fdac79892168b33df915becc`，未暂存、未提交。

既有构建大包警告不属于本任务回归。未扩展旧幽灵 `GasType.CREEPING_DEATH` 的使用；本轮原生地衣链与它完全分开。没有声称完成其他尚未迁移的气体/怪物DF或整个 CE 复刻。

### 6.1 一次性重捕获登记

浅层、深层各写1次，UR3按原方法写1次且逐值等于 review 候选；UR2、UR4不写。完整记录见 [recapture.json](x2g-evidence/recapture.json)。

| 文件 | 写入次数 | 旧 SHA-256 | 新 SHA-256 |
|---|---:|---|---|
| src/test/fixtures/generation_baseline.json | 1 | `4a6476b413be035fd07c29debd8546bdf74468b81d25b14f68a78a87e35e3eac` | `8de4bb7a4f3fa40f72bd2f5b511699dff771b846131c65d72f4c3e6788ec8580` |
| src/test/fixtures/deep_generation_baseline.json | 1 | `c094786fde5f54eb6b54b630bbc6dc8f7614cf3aa8a1ef2f30267247b1f38aff` | `88292abc0246369d5f4fcf5291a3e102ab44c40ed19accf1f28032de87716155` |
| ai_docs/reports/u-r2-trace.json | 0 | `4d6b62462fc8962732dd39a58f1c1a714909c7e8e3d9b98200b7f4804ec17bb9` | `4d6b62462fc8962732dd39a58f1c1a714909c7e8e3d9b98200b7f4804ec17bb9` |
| ai_docs/reports/u-r3-trace.json.gz | 1 | `776c713cbf0cc44b776d6b4c02eebb837922096c4bab0076be3b6aea3e2566e1` | `8a081c57d5ef8639f94ec3e74cb70f837205313a1c0c09bc955c53de7e5f184e` |
| ai_docs/reports/u-r4-trace.json.gz | 0 | `86609968c4a08ee469a4deb2e816741b07ad0e3c87bceda69e918380067810b2` | `86609968c4a08ee469a4deb2e816741b07ad0e3c87bceda69e918380067810b2` |
| src/test/fixtures/p2_baseline.json | 0 | `f1690f3748c3e49c0df692cbee283fb962719d9b290131b9507282a6b504fc4b` | `f1690f3748c3e49c0df692cbee283fb962719d9b290131b9507282a6b504fc4b` |
| src/test/fixtures/p2_2_baseline.json | 0 | `ba5cfdab37e2bdf633714ac9da1b54c5db71318967c54cffdb47da7519f51726` | `ba5cfdab37e2bdf633714ac9da1b54c5db71318967c54cffdb47da7519f51726` |
| src/test/fixtures/p2_3_baseline.json | 0 | `9b3bb0c149e968f6eccae04752e13390beaf4602c6e8216aa65426432f5ecf2e` | `9b3bb0c149e968f6eccae04752e13390beaf4602c6e8216aa65426432f5ecf2e` |
