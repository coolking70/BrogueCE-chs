# B2：抄录错列回填

基准 HEAD：`f5e2938`。16 个任务点位中，12 处回填，4 处依据仍有效的缺地形登记驳回；没有改引擎或 CE 源码。E40 按任务口径算一个点位（包含五个 personalSpace 字段）。

## 1. 逐点核验与历史留形

CE 行号均指 `BrogueCE-master/src/variants/GlobalsBrogue.c`。Web 旧值取自入场文件；未把“找不到登记”说成“已经证明作者当时无意”。

| 点位 | CE 原值 | Web 旧值 | 本轮处置 |
|---|---|---|---|
| E31，31/F1，:380 | personalSpace=5；含 MF_NOT_IN_HALLWAY | 3；漏该位 | 两项均补。9b 报告未登记这两项留形，映射报告 §5 也已指出不等。 |
| E39，39/F0，:431 | personalSpace=2 | 3 | 改为 2；未找到该字段的留形依据。 |
| E44，44/F3，:469 | personalSpace=2 | 1 | 改为 2；未找到该字段的留形依据。 |
| E40，40/F0–F4，:438–442 | 全部 personalSpace=2 | 全部 1 | 五条改为 2；F5/F6 保持 1。6 轮重写登记未说明这五条需缩小间距。 |
| F10，10 头，:248 | frequency=12 | 8 | 改为 12；6 轮犬舍重写记录没有保留 8 的设计理由。 |
| B55，55 头，:538 | 含 BP_MAXIMIZE_INTERIOR | 漏该位 | 补位。引擎仍过滤 CE55，当前潜伏，不能解释本轮漂移。9d “旧表没有”仅描述 Web 状态。 |
| E71，71/F0，:619 | MK_SENTINEL（Web id 应为 sentinel） | MK_SENTINEL | 改为 sentinel；8 轮没有为无效怪物 id 登记留形。14 号原本正确，未改。 |
| D6，6/F2，:225 | DF_MAGIC_PIPING | 无 featureDF | **驳回**：4 轮 §2.2 的 PIPE_GLOWING 缺 tile 登记仍有效，目录 :906–913、DF_MISSING_TILES 同步保留；接上即抛错。 |
| D7，7/F2，:231 | DF_MACHINE_FLOOR_TRIGGER_REPEATING | 无 featureDF | **驳回**：4 轮 §2.2 的 MACHINE_TRIGGER_FLOOR_REPEATING 缺 tile 登记仍有效，目录 :926–939；CARPET 传播地形存在不等于目标存在。 |
| D15，15/F0，:291 | DF_LUMINESCENT_FUNGUS | 无 featureDF | 补列。4 轮 §2.2 的旧缺 tile 理由已由 7 轮解除；FeatureDef 也已有载体。CE15 仍零频且无生产强制入口，当前潜伏。 |
| D22，22/F0，:324 | DF_MEDIUM_HOLE | 无 featureDF | **驳回**：3 轮 A7/A8 的数据起点、TRAP_DOOR 缺 tile 登记仍有效；目录 :742–755。 |
| D28，28/F1，:363 | DF_MEDIUM_HOLE | 无 featureDF | **驳回**：同上；4 轮 §2.3(b) 明确沿用压力板留形，不能因已有压板载体就假设中洞也实现。 |
| L16，16/F0，:300 | DUNGEON | 未声明 layer | 补。CE :1454 只写指定层；本条另有先行 doorTerrain 清层，实际影响见 §4。 |
| L17，17/F0，:303 | DUNGEON | 未声明 layer | 补。发现 SECRET_DOOR 缺引擎映射，本条当前潜伏，见 §4。 |
| L27a，27/F0，:358 | DUNGEON | 未声明 layer | 补。ALTAR 别名保持；逐层写入保留已有其他层。 |
| L27b，27/F1，:359 | DUNGEON | 未声明 layer | 补。SECRET_DOOR 缺映射导致当前潜伏，见 §4。 |

历史依据：[映射轮 §5](bp-mapping.report.md#5-既存错误与留形偏差本轮全部只登记)、[3 轮 A7/A8](v-2b-3.report.md)、[4 轮 §2.2/2.3](v-2b-4.report.md)、[1 轮三条蓝图](v-2b-1.report.md)、[6 轮犬舍/毒气重写](v-2b-6.report.md)、[8 轮 CE71](v-2b-8.report.md)、[9b 登记](v-2b-9b-finish2.report.md)、[B1 过滤说明](b1-retire-invented.report.md)。1 轮逐字表未登记“省略 layer 是为了清其他层”；6 轮 §3 的“27 号数据不动”讨论的是 ALTAR_INERT 别名，不是 layer 留形授权。

缺 DF 四处并非认定 CE 原值为 0。`DungeonFeature.catalogFeature` :612–630 明确对 `tile === null` 响亮失败，未实现地形不会被静默跳过；新守卫逐条确认“数据暂不接线 + 缺 tile 登记存在 + 实际调用抛错”。本轮没有为补列而扩建地形。

## 2. E71：建成与实化分别计数

固定样本在数据编辑前选定：seed 1–30 加 `424242/777/20260913/31337`，每个种子在同一 Game 内连续下潜 D1–D26，共 884 层。记录 `Game.populateLevel` 已提交的扁平 machines，避免把失败/回滚的机器算入，也避免子机器重复计数。构造器的时间种子开局不入样本，只观测显式 seed 开局后的最后一次 handoff。

连通性按 C-8 相同的 `canMoveTo ∪ SECRET_DOOR` 八向移动图检查上下楼梯；D26 本来没有下楼梯，分母为 34×25=850。C-8 原文件另外完整运行，包含 30 seed×D1–D25 的原覆盖面与机制对抗用例。

| 状态 | CE71 建成 | 实化哨兵 | 逐台情况 | 楼梯坏层率 |
|---|---:|---:|---|---|
| 入场旧数据 | 2 | 0 | 2 台各有 3 条指令、0 个实体 | 0/850（0%） |
| 只修 E71 | 3 | 9 | 每台 3 只，其中一只为 grappling Sentinel | 0/850（0%） |
| B2 全部数据修正 | 5 | 15 | 5 台每台均 3 只 | 0/850（0%） |

旧机器是 seed5/D16、seed9/D16。只修 E71 后两台仍在相同深度，另在 seed9/D18 新建一台；全修后再出现 seed13/D14、seed14/D13。没有钉精确台数作为永久门槛；自然覆盖门是建成 >0，再逐台要求 3 个真实哨兵。

测量原件：`/private/tmp/b2-before.json`、`b2-sentinel-only.json`、`b2-after.json`。单变量原件的初版 `realized` 汇总为 8，因为当时以显示名完全相等计数，漏了变异哨兵；原始逐格记录明确为 9 个实体，均在本机器落点且 machineHome 匹配。本报告按逐格记录校正为 9，最终测试已改用稳定物种数据识别，最终全修实跑正确统计 15。没有把实际怪物名称不同误当成缺失，也没有仅凭 spawn.monsterId 算作实化。

修复前 C-8 7/7 通过；修复后首轮 C-8 7/7 通过（其中固定 750 层坏层 0）。最终状态另复跑，见 §7。

CE71 原结构（:617–620）是 size={40,40}、frequency=0、BP_NO_INTERIOR_FLAG；F0 在 STATUE_INERT 上生成恰 3 只，personalSpace=2，带 NOT_IN_HALLWAY / TREAT_AS_BLOCKING / IN_VIEW_OF_ORIGIN，**没有 PERMIT_BLOCKING，也没有 DORMANT**。频率 0 不代表无调用：autoGenerator index47（CE :169）在 D12 起强制请求 MT_SENTINEL_AREA。Web 仍沿用既有区域机器选址近似，没有顺手改变此机制。

雕像在旧版本就已经铺下；修复新增的是同坐标上的怪物。`canMoveTo` 按全部地形层判通行，雕像本来不可走；生成时单格阻断否决仍经过 CE 与 Web 两种连通图检查。CE 的三只哨兵属于炮台型怪，怪物落在雕像上并不新增一块原本可走的障碍。上述解释必须与实测坏层率一起看，不能代替实测或宣称穷尽所有种子。

## 3. 五个 DF 点位的递归闭包

| 起点 | tile / propagationTerrain / subsequentDF | 结论 |
|---|---|---|
| 6/F2 MAGIC_PIPING | PIPE_GLOWING=null；无传播地形、无后继 | 根缺 tile，保留断开。CE Globals.c:794。 |
| 7/F2 MACHINE_FLOOR_TRIGGER_REPEATING | MACHINE_TRIGGER_FLOOR_REPEATING=null；CARPET 存在；无后继 | 根缺 tile，保留断开。CE :799。 |
| 15/F0 LUMINESCENT_FUNGUS | LUMINESCENT_FUNGUS；fire→PLAIN_FIRE→EMBERS→ASH；无缺 tile | 四条 DF、四种地形齐全。每种地形都实跑普通与 fire 晋升，全部 deferred=null。CE :608；地形 :450。 |
| 22/F0 MEDIUM_HOLE | TRAP_DOOR=null；后继 SHOW_TRAPDOOR_HALO→CHASM_EDGE（已实现，无后继） | 链尾完整不等于根完整；暂不接线。CE :813→:627。 |
| 28/F1 MEDIUM_HOLE | 同上 | 同上。 |

新守卫对接活的发光菌按 tile、promoteType、fireType、propagationTerrain、subsequentDF 递归，不只检查起点字符串。完整集合导出 `/private/tmp/b2-closure.json`。缺 tile 四处没有填活，因此没有伪造它们 `deferred=null` 的通过结果。

## 4. L 类：清层差异与新发现的潜伏入口

`Grid.setTerrain` :1051 经 `writeTerrainHome` :822 把其他三层全部置 NOTHING，**LIQUID、GAS、SURFACE 都会清**，并无条件写 char/color；`setTerrainLayer` :1031 仅写目标层，并刷新通行/遮挡派生值，不清其他层。蓝图显式层分支 :1526–1537 在目标成为有效地形时更新字形颜色。

CE `Architect.c:1434–1455` 先执行 featureDF，再在成功时做 `pmap[featX][featY].layers[feature->layer] = feature->terrain`。四条 CE 原表都明确 DUNGEON；所以补列符合 CE，并非格式清理。

四个点位各自做受控前后对照：起始 `[FLOOR, WATER_SHALLOW, METHANE_GAS, GRASS]`（顺序 DUNGEON/LIQUID/GAS/SURFACE）。旧 API 得到 `[目标, NOTHING, NOTHING, NOTHING]`，显式层得到 `[目标, WATER_SHALLOW, METHANE_GAS, GRASS]`。另真实调用 `applyBlueprint` 的 terrain/layer 分支；测试隔离了无关的物品外包与 doorTerrain 预写，没有把隔离实验冒充整台原蓝图的自然生成效果。

生产上需分三种情况：

- **16/F0** 的 feature 分支确实支持 LOCKED_DOOR；但是本蓝图此前还有 `doorTerrain: LOCKED_DOOR` 预写（BlueprintEngine :1324–1332），先清层再执行 feature。因此补 layer 不会恢复已经被前一步清掉的层。保留该既有行为，不改引擎。
- **27/F0** 的 ALTAR 有映射，补 layer 真正避免 feature 清除其他层。ALTAR_INERT→ALTAR 的既有别名不动。
- **17/F0、27/F1** 的 SECRET_DOOR 在 TerrainType 中存在，却不在私有 `TERRAIN_MAP` / `TERRAIN_VISUALS` 中。当前 `applyBlueprint` 跳过写地形，仍能记录 featureSpawns；同一合成夹具里补层前后都是原来的 FLOOR+其他层，不能宣称密门落地。新测试明确把此事实与 Grid API 的 CE 层语义分开。本轮补正确 layer 数据，但这两条是潜伏修正。补映射需要改引擎，按任务 §7 **到此停止该修复分支，仅登记，不动手**；后续应补映射并反转这两条缺口守卫。

## 5. 基线与成因

入场 884 层扫描中四个滚动基线 seed 的 104 层、416 字段与旧 fixture **0 差异**。重捕获只能在所有数据、守卫、既有测试编辑完成后进行。

固定 884 层的全修前后：241 层变化；fp/n/species/items 分别变化 238/229/235/206，合计 908 字段。四个滚动 seed 的 104 层：46 层变化，四字段分别 46/44/45/41，合计 **176 字段**。

在旧数据背景逐次只开启一组修改，跑相同四个 seed 的 104 层；每层额外记录 substantive RNG 抽取累计数与完整四层数组 SHA，避免把有效地形指纹相同当作分层完全相同。old/final 两端都与独立 884 层 census 的对应四字段逐层全等，证明实验装配正确。结果：

| 单变量（其余保持旧值） | 变化层（四基线字段） | fp | n | species | items | RNG 计数变化层 | 完整四层变化层 |
|---|---:|---:|---:|---:|---:|---:|---:|
| personalSpace + E31 hallway 位 | 25 | 25 | 23 | 24 | 21 | 24 | 25 |
| F10 frequency 8→12 | 21 | 21 | 21 | 21 | 20 | 21 | 21 |
| E71 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| B55 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| D15 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| L 四处 | 0 | 0 | 0 | 0 | 0 | 0 | **1** |
| 全部修改 | 46 | 46 | 44 | 45 | 41 | 45 | 46 |

单变量数值不是逐层因果分摊，不把它们相加冒充一般叠加定律。E71 在四个基线 seed 内没有建成样本，因此该小样本零漂移不代表一般零影响：固定 884 层单独修 E71 时，fp/n/species/items 分别变化 **20/21/22/17**，且多建一台机器、实化 9 只。原始实验 `/private/tmp/b2-isolated.json`；临时实验附加在获准的新测试文件中，测完已删除，最终文件不依赖 /private/tmp 输入。

**L 的真实自然层对照**：seed424242/D3、(44,24)、machineNumber=12，旧值 `[ALTAR, NOTHING, NOTHING, NOTHING]`，只补 L 后为 `[ALTAR, WATER_SHALLOW, NOTHING, NOTHING]`；有效地形都是 ALTAR。即 27/F0 真实保住浅水，旧 baseline.fp 看不到该差异。坐标复跑原件 `/private/tmp/b2-layer-detail.json`；另有 §4 四条 API/生产分支守卫，避免只靠历史样本。

成因分类：①E31/39/40/44 改落位间距，E31 还补走廊排除位；②F10 改抽签权重，可能连失败尝试一起改变 RNG；③E71 新建 Monster 与突变抽取消耗 RNG，影响当层及后续层；④D 类本轮只接通 CE15，而它当前没有自然入口，四处缺 tile 未接通，故不能虚报 DF 随机消耗是这次自然漂移主因；⑤L 类四处语义见 §4。B55 的 MAXIMIZE 被原过滤挡住，当前零新增自然生成贡献。

所有数据与测试编辑（包括移除临时实验）结束后，另用 B1 construction census 重新生成 16 seed × 26 层，输出 `/private/tmp/b2-recapture.json`；其中四个基线 seed 的 104 层与 B2 全修 census 四字段全等。随后才写 fixture（最后一次源码/测试/fixture 编辑），保持原 seed、层数与比较字段不变。实际 fixture 差异为 176 字段，另更新说明 note；SHA-256：`eea88f2e7e4937bffd951320cc85bc526169843f37b574777a40790250c5debe`。最终复跑在此之后启动。

## 6. 对抗性与浏览器核验

E71 守卫不是只查 JSON / monsterSpawns：逐真实提交机器核对 3 个互异落点的 `game.getMonsterAt`，检查活怪的稳定物种数据与炮台旗标、所属 machineHome、雕像地形。突变可能改变名字，所以不以显示名称完全相等计数。另有 40 格受控机器夹具，旧 id 与修正 id 各真实建造一次并交给 Game.populateLevel，要求实化数 `[0,3]`；正例额外确认怪物在活动表、没有进入 dormantMonsters。旧数据实跑该守卫得到 `[0,0]`，确实翻红。

另做“数据正确、消费端坏掉”的反向实测：只在测试侧临时 spy `resolveBlueprintMonster` 返回 null，数据仍为 sentinel；同一实化用例失败（落点被普通 Goblin 占据时也因物种不符被抓获），退出码 1。日志 `/private/tmp/b2-adversary.log`。恢复测试原字节（SHA `08a77610c1f8bba9b82ba284119dcd08063b5d10badd6e106f9bc6d6ac55c60b`）后该用例通过；引擎从未改写。因此仅保留正确 JSON、只写生成指令、或放一只别的怪物来冒充都不能过。

浏览器调用项目既有渲染与自动化接口核验。技能客户端的 Canvas WebGL 导出在无头和有界面模式下均黑屏；改用浏览器整页截图后确认三只哨兵可见，坐标 `(12,14)/(12,12)/(16,10)`、machineHome=1，与实际怪物记录一致；控制台/pageerror 均为空。证据 `/private/tmp/b2-browser.png`、`b2-browser.json`。这是受控房间渲染检查，不能替代自然流 census。

## 7. 最终门禁

首轮完整门禁：28 文件 / 436 用例，433 通过、3 失败，527.30 秒。三条全属穷举连带：

- v_2b_2a_placement_flags 的 NOT_IN_HALLWAY 总数 78→79（CE31/F1）。
- v_2b_7_features 的 CE55 头行全等表补 MAXIMIZE。
- v_2b_9d_dungeon_profile 的全库 MAXIMIZE 所有者由 [13,14] 顺延为 [55,13,14]。

没有既有行为断言撞断，没有换种子、降低覆盖门或调整可达性要求，未触及 >5 个行为断言失败停工阈值。开发期新建 L 守卫曾按“SECRET_DOOR 已有映射”假设失败，查明原因后以 §4 的真实缺口登记替代该假设；这不是把既有守卫放宽。

**这是最终状态下的运行结果，不是中途快照。**

所有数据、源码、测试、fixture 编辑完成后，2026-09-22 18:50:42（Asia/Shanghai）启动最终指定门禁，耗时 **562.14 秒**：**28 文件 / 436 passed / 0 failed / 0 skipped**。`npm run build` 退出 0（仅已有的大 chunk 提示）；`npm run test:drift -- --maxWorkers=1` **1 passed**、15.03 秒。没有运行无参数全量 vitest。

| 最终复跑文件（src/test/） | 用例 | 结果 |
|---|---:|---|
| b1_retire_invented.test.ts | 44 | 通过 |
| b2_transcription.test.ts | 21 | 通过 |
| b_4b_item_placement.test.ts | 15 | 通过 |
| blueprint_ce_coverage.test.ts | 18 | 通过 |
| blueprint_center.test.ts | 5 | 通过 |
| c_4b_dungeon_feature.test.ts | 31 | 通过 |
| c_6_autogenerators.test.ts | 17 | 通过 |
| c_8_connectivity.test.ts | 7 | 通过 |
| g_2_gas_df_wiring.test.ts | 17 | 通过 |
| p1_20_item_placement.test.ts | 1 | 通过 |
| p1_26_invariants.test.ts | 5 | 通过 |
| p1_31_35_placement_snapshot.test.ts | 10 | 通过 |
| p1_33_machine_chokepoint.test.ts | 7 | 通过 |
| p1_37_machine_flag_i18n.test.ts | 9 | 通过 |
| v_1a_blueprint_items.test.ts | 8 | 通过 |
| v_1b_alternative.test.ts | 9 | 通过 |
| v_1c_machine_structure.test.ts | 12 | 通过 |
| v_2a_vestibule_return.test.ts | 3 | 通过 |
| v_2b_2a_placement_flags.test.ts | 27 | 通过 |
| v_2b_2b_blueprints.test.ts | 24 | 通过 |
| v_2b_3_wired.test.ts | 28 | 通过 |
| v_2b_4_altars.test.ts | 36 | 通过 |
| v_2b_5_dormant.test.ts | 17 | 通过 |
| v_2b_6_keys.test.ts | 18 | 通过 |
| v_2b_7_features.test.ts | 22 | 通过 |
| v_2b_9b_environment.test.ts | 4 | 通过 |
| v_2b_9c_effects.test.ts | 10 | 通过 |
| v_2b_9d_dungeon_profile.test.ts | 11 | 通过 |
| generation_baseline.test.ts（单独 drift） | 1 | 通过 |

命令：`npx vitest run` 显式列出上表前 28 文件，附 `--maxWorkers=2 --reporter=default --reporter=json --outputFile=/private/tmp/b2-final-gates.json`。build 与 drift 也在同一冻结状态下运行。完整日志：`/private/tmp/b2-final-gates.log`、`b2-final-build.log`、`b2-final-drift.log`；机器可读逐文件结果 `b2-final-gates.json`。最终 census 与先前全修 census **整个 JSON 对象全等**，再次确认 5 台/15 哨兵、0/850 坏层。

SHA-256 自证：冻结 `src/` 所有文件（含新测试、fixture），加 package/lockfile、Vite、三份 tsconfig、progress 与本报告，共 **190 文件**。逐文件 SHA 按相对仓库路径排序成紧凑 JSON，再对 manifest 求总 SHA。复跑前与全部门禁/build/drift 完成后逐字全等，总摘要均为：

`882561d8b2c28a169049f5abec46df2206d9ae9abbbe6821e06538462593cc7d`

CE 的 **113 个 Git 跟踪文件**前后 manifest 同样全等，总摘要均为：

`7f1aef5df3a0beb3d31ebeb4496c6d1461bb8a0450110c5ef5f38c6e17dbf2c2`

证据：`/private/tmp/b2-final-before-sha.json`、`b2-final-after-sha.json`。冻结期间本报告也未改动；验证全等后仅补填本报告的最终结果，不再编辑源码、测试、fixture、配置或 progress。

## 8. 清单外改动与边界

- `progress.md`：develop-web-game 技能要求的进度追加；保留原始 prompt 与历史内容，在此申报。
- 本报告是任务 §9 明确要求的产物。其余持久改动仅限授权数据、新守卫、最后重捕获的 fixture 和撞红既有测试。
- 没有改 `BlueprintEngine.ts`、`Game.ts` 或任何其他引擎；`BrogueCE-master/` 只读。
- 本地依赖从同机主工作树复制，相同 lockfile 经 cmp 确认，依赖清单和锁文件未改。测量脚本、JSON、日志、浏览器截图位于 `/private/tmp/b2-*`，不进仓库。
- 未执行 git add、commit、push。
