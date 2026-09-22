# B1：11 条 web 自创蓝图退池留形

## 1. 结论与先测证据

起点为 `dbe7aabb4a92b27d29e588e2386ea1b4ccc1eba4`。先完成退池前扫描，之后才编辑引擎过滤；全部 11 条复核仍为自创，本轮全部退池。`blueprints.json` 字节未改。

**必须纠正任务书 §2 中“建成 0 台 ⇒ 退池不影响生成”的推论。** 本轮有七条零建成，其中六条 `key_guard` 已在抽签前被既有领养过滤排除，属于无生成影响的数据卫生；`vestibule_flammable` 仍参与抽签，虽然本样本建成 0 台，单独退它已经造成漂移，不能算空操作。以下将两种零值分开列出。

固定样本：`[1, 2, 3, 7, 42, 100, 123, 456, 777, 1234, 5678, 9999, 31337, 424242, 20260913, 8675309]`，每个种子连续生成 D1–D26，共 **416 层**。每个种子只启动一局，向下生成时保留跨层配额与随机流，不逐层重新 seed。

观测程序在 `src/test/b1_retire_invented.test.ts` 的 `B1 construction census`。通过 pass-through spy 读取 `Game.populateLevel` 第四参数，即 Architect 交付的最终、已深扁平化 `MachineResult[]`，包含奖励房、递归前厅/领养机器及 autogenerator。没有计入失败尝试或父机器回滚掉的子机器，没有再次递归展开而重复计数；另断言每层机器号唯一。构造器的时间种子 D1 被显式种子开局覆盖，只读取最后一次 handoff。观测不调用 RNG，不改蓝图/网格。

| 自创 id | 数据权重（保留） | 退池前建成 | 退池后建成 | 零值/归因 |
|---|---:|---:|---:|---|
| reward_library | 8 | 3 | 0 | 有建成的抽签竞争者 |
| reward_consumables | 10 | 9 | 0 | 有建成的抽签竞争者 |
| vestibule_flammable | 6 | **0** | 0 | **仍可抽中；单独退池会漂移，非空操作** |
| vestibule_guardian | 7 | 4 | 0 | 有建成的抽签竞争者 |
| vestibule_pit_traps | 5 | 1 | 0 | 有建成的抽签竞争者 |
| key_rat_trap | 8 | **0** | 0 | 既有领养过滤已排除；本轮为数据卫生 |
| key_fire_trap | 6 | **0** | 0 | 同上 |
| key_flood_trap | 5 | **0** | 0 | 同上 |
| key_web_room | 6 | **0** | 0 | 同上 |
| key_lava_moat | 4 | **0** | 0 | 同上 |
| key_boss | 3 | **0** | 0 | 同上 |
| 合计 | **68** | **17** | **0** | 有效抽签竞争涉及前五条，数据权重合计 36；其余 32 已被挡住 |

全部机器 **490 → 459**。其中 reward **124 → 111**、vestibule **138 → 119**、key_guard **90 → 75**、thematic **138 → 154**。后者来自强制 autogenerator，不是顶层抽签放回了 thematic。总数差 31 不能解释成“直接少了 31 台自创机器”：直接观测到的自创仅 17 台，其余变化包含抽签、重试、递归与后续随机流的连带影响。守卫没有钉这些精确台数。

同主题 CE 的自然建成数也保留，避免用资格检查冒充实测建成：

| CE | web id | 前 | 后 |
|---:|---|---:|---:|
| 3 | reward_treasure_room | 12 | 6 |
| 19 | vestibule_flammable_barricade | 1 | 3 |
| 23 | vestibule_pit_trap_field | 10 | 10 |
| 25 | vestibule_guardian_obstacle | 8 | 12 |
| 29 | key_rat_trap_dormant | 2 | 1 |
| 31 | ce_31_environment | 2 | 1 |
| 32 | key_fire_trap_room | 0 | 1 |
| 37 | ce_37_environment | 4 | 1 |
| 38 | ce_38_environment | 0 | 0 |
| 57 | key_boss_secret_room | 10 | 5 |

CE 38 本样本没有建成，不声称已证明其自然建成覆盖；其可抽中性由 §4 的真实 chooseBP 入口守卫逐条证明，包含领养过滤，未走强制 CE 编号建造分支。

### 1.1 零建成但非空操作的单变量实验

在完成退池前扫描后，临时只过滤 `vestibule_flammable`，其余十条保留原资格，运行完全相同的 16 seed × 26 层程序。结果：

- 416 层变化 **162 层 / 619 字段**（fp 162、n 155、species 161、items 141）。
- 原四种子滚动基线子集变化 **24 层 / 91 字段**，均为 seed777 的 D3–D26。
- 该蓝图在原样本的成功交付数确实为 **0**。`chooseBP`、前厅选址和失败重试仍消费 RNG，成功交付数不覆盖这些消费；这正是“仅拿建成数解释漂移”缺失的一部分。

随后将该临时谓词替换为最终 11 条集合过滤，未把单变量状态写入基线。619 与最终 1326 不可相加或相减后分摊到某台机器：随机流变化存在后续连带效应。

### 1.2 key_rat_trap 的现状，以及旧报告的范围纠正

`BlueprintEngine.buildAMachine` 已有 `adoptiveItem === null || bp.features.some(canReceiveAdoptedItem)` 过滤；`canReceiveAdoptedItem` 首先要求 `MF_ADOPT_ITEM`。`key_rat_trap` 的两条 feature 是普通鼠生成和本房 KEY 生成，无领养 feature，因此 V-2b-6 登记的静默丢钥匙死局已被挡住。本轮没有修复/重新触发这个死局，也没有把历史上它曾建成的样本算入本轮基线。

当前六条自创 `key_guard` **全部没有** `MF_ADOPT_ITEM`，不是旧注释/报告所称“key_rat_trap 唯一没有”。顶层只请求 BP_REWARD；领养递归请求 BP_ADOPT_ITEM 并传入非空物品；强制 autogenerator 依 CE 数字编号匹配，不可能命中这些 null 项。因此六条在实际调用链的抽签候选中本来就不存在。此次提前在 `blueprintQualifies` 拒绝它们不改变其候选权重和 RNG 消费。这也解释了六条一致的 0 → 0。旧注释没有借本轮顺手修改。

## 2. §9 身份复核

核对 CE `src/variants/GlobalsBrogue.c:173–622` 的目录，逐 feature 对照下表同主题条目；同时复查 CE 1/2/8、30、39 等相邻可能身份。**11 条判据全部成立，没有应救回的合法 CE 身份。** 认定依据是缺失原型的核心结构，不是仅因 depth/size/frequency 存在抄录偏差。

下表 Web 行号均指 `src/data/blueprints.json`；CE 行号均指只读 `BrogueCE-master/src/variants/GlobalsBrogue.c`。

| id / Web 行 | CE 原表行 | 本轮复核依据 |
|---|---|---|
| reward_library :3 | CE 3 :198–205；1/2 :183–197 | 3 个 feature 为前厅、2–4 卷轴、SIGN；无 CE 3 地毯/药水卷轴二选一/菌林/雕像，也无 CE 1/2 的可借取 ALTAR_CAGE_OPEN 永久物品结构。 |
| reward_consumables :63 | CE 3 :198–205；8 :233–238 | 同时给药水和卷轴并建前厅；无二选一/地毯/菌林/雕像。亦非 CE 8 的无房间外包永久物品结构。 |
| vestibule_flammable :1504 | CE 19 :309–313 | 唯一 feature 为 GRASS 6–12；无门口 WOODEN_BARRICADE 与关卡别处的点火物。 |
| vestibule_guardian :1534 | CE 25 :338–343 | 唯一 feature 为 `_depth_appropriate_` 1–2 只；无门口两种 guardian 替代项及 MACHINE_GLYPH。 |
| vestibule_pit_traps :1568 | CE 23 :327–331 | 唯一 feature 为 TRAP/fire 3–6；无 DOOR/SECRET_DOOR 替代项，亦非 TRAP_DOOR_HIDDEN。 |
| key_rat_trap :1599 | CE 29 :364–368 | 3–6 普通鼠与本房生成钥匙；无领养 ALTAR_SWITCH、麻痹气口、休眠鼠墙。 |
| key_fire_trap :1645 | CE 32 :383–389；30 :369–376 | 只有 GRASS 与 TRAP/fire；无领养祭坛、FLAMETHROWER_HIDDEN、水池 DF、水怪。亦无 CE 30 的围祭坛木栅 DF 与引火解谜结构。 |
| key_flood_trap :1687 | CE 31 :377–382 | 直接铺浅深水；无 FLOOR_FLOODABLE、领养开关祭坛、DF_SPREADABLE_WATER_POOL 与水怪。 |
| key_web_room :1909 | CE 37 :413–419 | 只铺 WEB 并生成 `_spider_`；无领养开关祭坛、CHASM/CHASM_WITH_HIDDEN_BRIDGE 与 DF_ADD_DORMANT_CHASM_HALO。 |
| key_lava_moat :1952 | CE 38 :420–428；39 :429–435 | 只有 LAVA 8–20；两种 CE 岩浆原型的领养祭坛、回缩岩浆/DF、逃生物品均不存在，也没有 CE 38 拉杆替代项。 |
| key_boss :1983 | CE 57 :549–553 | 普通 `_depth_boss_` 加护卫；无领养携物 HORDE_MACHINE_BOSS、骨堆/发光菌 DF 和密门。 |

另复核同名陷阱：CE 15 `:289–294` 为 AMULET_SWITCH / AMULET / Warden / 菌林与火把；CE 43 `:460–463` 为领养 ALTAR_SWITCH 与休眠雕像 horde。`key_statuary = 43` 保持正确，未退池；既有覆盖守卫继续检查二者归属不交换。

CE 8 不补：其无 BP_ROOM、roomSize `{0,0}` 的区域机器路径缺口继续归 9e。未改 B2 抄录项、区域机器路径及 65/66。

## 3. 退池实现

`BlueprintEngine.ts` 新增显式、具名 `RETIRED_INVENTED_BLUEPRINT_IDS: ReadonlySet<string>`，仅在 `blueprintQualifies` 尾部增加成员过滤。保留三条现有 CE 18/52/55 的机制待完成过滤及所有其他生成行为。

集合注释区分：**D2 自创永久退池，只有身份判定被推翻才恢复**；现有三条则等待机制落地。没有改 `frequency`、`flags`、`features`、`ceBlueprintId: null` 或 `ceOrigin`。

## 4. 四条守卫及对抗性

新文件 `src/test/b1_retire_invented.test.ts`：

1. **逐 11 条 × D1–D26 拒绝**：给每条传其类别实际请求旗标（reward/vestibule/key_guard 对应 BP_REWARD/BP_VESTIBULE/BP_ADOPT_ITEM）。漏退某条、仅在部分深度退池会红；不拿 BP_REWARD 去测 key_guard 的天然不合格来冒充退池。
2. **数据留形**：逐条要求存在、frequency > 0、features 非空、CE ID 仍 null、来源说明非空。删行、归零频率、清空 features 或抹掉 provenance 会红。数据全字段未改另由整文件 SHA-256 与 git diff 证明。
3. **逐 CE 反真空**：CE 3/19/23/25/29/31/32/37/38/57 每条在自身全部合法深度、正确请求位下必须 qualifies=true，且 frequency > 0；另用未改的真实蓝图单候选池调用 `buildAMachine(-1, ...)`，key_guard 实传非空 iron_key。保留真实资格/频率抽签/领养过滤，仅在选中后到达的几何选址边界停止并记录蓝图。误退某个同主题 CE、整类过滤、使真实领养候选不可接收物品，都会红。这里证明的是“可被抽中”，不冒充几何上必建成。
4. **集合全等**：引擎具名集合同时等于显式 11 条审计清单及全部 `ceBlueprintId === null` 的目录 ID 集合。新增自创忘退、误纳合法 CE、丢失条目会红；并保留原 `blueprint_ce_coverage.test.ts` 的覆盖与身份归属守卫。

自然流扫描另要求全部 11 条建成 0、reward/vestibule/key_guard 三类都真正建成过，无精确台数门槛。

**对抗性回答：会红，而且已经实跑。** 把整个集合初始化临时替换为 `new Set(blueprintData.filter(bp => bp.category === 'key_guard').map(bp => bp.id))`，只跑 `-t 'B1 anti-vacuum'`，CE 29/31/32/37/38/57 各自两条断言失败，共 **12 failed / 8 passed**，退出码 1；其余 24 条用例因名称筛选跳过。失败包括每条 CE 的 qualifies=true 正例和“确实被 chooseBP 选到选址入口”正例。这不是靠集合全等或自创负例代抓。实验后恢复引擎原字节，再跑正常门禁。

## 5. 基线重捕获与归因

退池前扫描所含四个基线种子 `[424242, 777, 20260913, 31337]` 与旧 fixture 四字段 **0 差异**，排除了入场前已有漂移。

最终 11 条过滤后的同样本对照：

| 样本 | 变化层数 | fp | n | species | items | 变化字段总数 |
|---|---:|---:|---:|---:|---:|---:|
| 16 seed × 26 层 | 345 / 416 | 345 | 330 | 344 | 307 | 1326 |
| 4 seed 滚动基线 | **82 / 104** | **82** | **79** | **82** | **73** | **316** |

四个基线种子的首次变化分别在 D2 / D3 / D16 / D5。成因证据是 §1 的逐条建成对照与单变量实验：四条直接有成功建成的自创退出，另一个零建成但有抽签资格的前厅也会移动随机流；六条既有过滤已排除的 key_guard 没有新增生成贡献。不能把 316 处漂移全记到 `key_rat_trap` 或解释成“68 权重都曾活跃”。

所有源码/测试调整结束后，重新跑固定 416 层 census，输出 `/private/tmp/b1-recapture.json`，与先前 `b1-after.json` 的完整观测对象全等；随后才将四个原基线种子的四字段写入 fixture（最后一次源码/测试/fixture 编辑）。实际 fixture diff 再次确认 **82 层 / 316 字段**；此外仅更新说明 note，不换 seed、不改基线比较口径。最终重捕获文件 SHA-256 为 `f5ac272a3c8a350c55660871e9c4cd36734e77ed57bd6685f3b62f03ffe78726`。

## 6. 最终门禁

首轮指定 25 文件共 346 条用例，344 通过、2 失败：

- `v_1c_machine_structure` Q1 是资格穷举连带：仍预期两条自创 reward 合格。现将 null CE reward 纳入必须拒绝的分支，CE reward 的逐深度全覆盖与反空转门保留；没有跳过自创项，也没有从引擎退池谓词反推期望集合。
- `v_2b_6_keys` E1 是 Kennel 覆盖门无对象（0 台）。额外实测找到 **seed4 / D5** 的 Kennel，以 seed4 替换原八种子里的 seed1，E1/F2 共用这组种子，其他七个保留。DF 最低落点数、网格真实产物、钥匙绑定/可达性和 `>=1` 覆盖门全部原样；F2 原本通过，也加入该真实 Kennel 样本，避免只覆盖 Vampire lair 的笼子。样本搜索临时测试已删除。

首轮只有上述一处覆盖行为失败及一处穷举连带，未触及“行为断言撞断 >5 停止”的阈值；没有通过清数据、放宽断言或提前重采基线消红。

**这是最终状态下的运行结果，不是中途快照。**

全部源码、守卫、样本及 fixture 编辑完成后，2026-09-22 17:58:41（Asia/Shanghai）启动最终复跑；25 文件 **346 passed / 0 failed / 0 skipped**，耗时 531.20 秒。之后 `npm run build` 退出 0；`npm run test:drift -- --maxWorkers=1` **1 passed**，耗时 14.40 秒。构建仅有已有的大 chunk 提示，无类型/构建错误。

| 最终复跑文件（均在 src/test） | 用例 | 结果 |
|---|---:|---|
| b1_retire_invented.test.ts | 44 | 全部通过 |
| blueprint_ce_coverage.test.ts | 18 | 全部通过 |
| v_1a_blueprint_items.test.ts | 8 | 全部通过 |
| v_1b_alternative.test.ts | 9 | 全部通过 |
| v_1c_machine_structure.test.ts | 12 | 全部通过 |
| v_2a_vestibule_return.test.ts | 3 | 全部通过 |
| v_2b_2a_placement_flags.test.ts | 27 | 全部通过 |
| v_2b_2b_blueprints.test.ts | 24 | 全部通过 |
| v_2b_4_altars.test.ts | 36 | 全部通过 |
| v_2b_5_dormant.test.ts | 17 | 全部通过 |
| v_2b_6_keys.test.ts | 18 | 全部通过 |
| v_2b_7_features.test.ts | 22 | 全部通过 |
| v_2b_9b_environment.test.ts | 4 | 全部通过 |
| v_2b_9c_effects.test.ts | 10 | 全部通过 |
| v_2b_9d_dungeon_profile.test.ts | 11 | 全部通过 |
| blueprint_center.test.ts | 5 | 全部通过 |
| p1_20_item_placement.test.ts | 1 | 全部通过 |
| p1_26_invariants.test.ts | 5 | 全部通过 |
| p1_31_35_placement_snapshot.test.ts | 10 | 全部通过 |
| p1_33_machine_chokepoint.test.ts | 7 | 全部通过 |
| p1_37_machine_flag_i18n.test.ts | 9 | 全部通过 |
| b_4b_item_placement.test.ts | 15 | 全部通过 |
| c_6_autogenerators.test.ts | 17 | 全部通过 |
| c_8_connectivity.test.ts | 7 | 全部通过 |
| invented_content_pool.test.ts | 7 | 全部通过 |
| generation_baseline.test.ts（单独 test:drift） | 1 | 全部通过 |

运行命令为 `npx vitest run` **显式列出上表前 25 文件**，附 `--maxWorkers=2 --reporter=default --reporter=json --outputFile=/private/tmp/b1-gates-final.json`；未运行无参数全量测试。之后顺序执行 build 与 drift，均退出 0。

SHA 自证：复跑前与 build/drift 完成后，对 `src/` 下全部文件（含新测试与 fixture）及 package/lockfile、Vite 和三份 tsconfig 共 **187 文件**逐文件取 SHA-256；按相对路径排序的 `{path: sha256}` 紧凑 JSON 再取总摘要。两份完整 manifest 全等，总摘要前后均为：

`f3aa6bceed0ccfd611a36aa1fa7a00ceb6d2050f48ae58fc371a4134685a1303`

CE 的 **115 个 Git 跟踪文件**前后 manifest 也全等，总摘要均为 `3e7baa4d37236167bda7595ea50fb6606d6deb828671bab4d492897c61a27218`；报告在运行期间亦未编辑。证据文件为 `/private/tmp/b1-final-before-sha.json` 与 `b1-final-after-sha.json`，脚本检查整个观测对象相等后成功退出。复跑后仅补填本报告结果，没有再改任何源码、测试、fixture 或配置。

最终三项日志：`/private/tmp/b1-final-gates.log`、`b1-final-build.log`、`b1-final-drift.log`；逐文件机器可读结果为 `b1-gates-final.json`。

## 7. 清单外改动与复现记录

无清单外持久源码改动；报告由任务 §10 明确要求。新测试属于 §7 授权的新建退池守卫。实验变体已经恢复，`/private/tmp/b1-*` 为本地测量/日志/门禁证据，不进入仓库。未写 `BrogueCE-master/`。工作树缺依赖，离线安装没有缓存命中后，从同机相同 lockfile 的主工作树复制了 node_modules 到本工作树；未改依赖清单/锁文件。

测量命令：`B1_SCAN_OUTPUT=/private/tmp/b1-before.json npx vitest run src/test/b1_retire_invented.test.ts --maxWorkers=1`（退池前观测版本）；单变量版本输出到 `b1-flammable-only.json`；最终版本输出到 `b1-after.json`。固定种子与 handoff 计数程序在三个版本中相同；最后一版追加了必须 0 建成的守卫。任何测量都不自动写 fixture。

证据 SHA-256：

| 文件/状态 | SHA-256 |
|---|---|
| blueprints.json，入场值 | `26696a1faad0d0832c0f30f1d1f0434a8c6be2f5f0d3a4a2f93e29411fd23aae` |
| CE GlobalsBrogue.c，入场值 | `e8903aede4fad21b7823ccc547cf4219c76e87e061543188d8d90141cebffa1e` |
| 引擎，退池前 | `0892a5185ed4922196862fdecba5da39e1da4ede69f8f1f996aff2e8aadfc67a` |
| 引擎，最终 11 条过滤 | `57b6181c3ef397577eadc47174d32fff749d787543b3d82aa2250d5936dc2b39` |
| 旧 generation_baseline.json | `5105c219395fc0bc4230b47f2dd5ff9e3e2945389e1a119f483af1fa9f159c0b` |
| /private/tmp/b1-before.json | `0a3789de9cf6dc541de3832b658418cbcff030d7d0752e36e1ab5b3144e3509f` |
| /private/tmp/b1-flammable-only.json | `d9f3817782a978f58e7f4e44f46f4484ccd720febaf4582322d7c334ba6d5f64` |
| /private/tmp/b1-after.json | `e3e57777b73c2974d3d0b278cc6bd642e1f0a609ca493facf34c232d202e5959` |
