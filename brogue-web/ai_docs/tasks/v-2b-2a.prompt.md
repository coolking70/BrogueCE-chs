# V-2b-2a 放置旗标轮：把 CE 的 feature 落位资格判定接进来

## 0. 本轮是 V-2b-2 的前半（验收方拆分说明）

勘察报告把 V-2b-2 定为「放置旗标 + 纯地形」一轮，范围是 18 个旗标 + 17 个地形条目 + 6 条蓝图 + 基座蓝图拆分。**验收方判断这一轮太大**，按经验：V-2a 跑了 163 分钟死在半途、B-2/C-7 死在写报告那一步。所以拆成两半：

- **V-2b-2a（本轮）**：feature 级落位资格与物品资格旗标。**零新地形、零新蓝图。**
- **V-2b-2b（下一轮）**：BP_* 内部改造旗标 + 17 个地形条目 + 6 条蓝图 + 基座拆分。

拆分不改目的地也不改顺序，只改粒度。勘察报告的耦合理由（「没有 BUILD_IN_WALLS，STATUE_INERT 进不了墙」）说的是**落蓝图**需要旗标先在，本拆分正好满足这个先后。

## 1. 主干：CE 的 `cellIsFeatureCandidate`

CE 把 feature 的落位资格集中在一个函数里（`Architect.c:497-590`）。web 的对应物 `findFeaturePosition`（`BlueprintEngine.ts:1030` 一带）目前只认两个旗标（`MF_BUILD_AT_ORIGIN` / `MF_NEAR_ORIGIN`）。本轮把 CE 那套判定逐条接进来。

**CE 的判定顺序（照抄，顺序本身有语义）**：

1. `MF_NOT_IN_HALLWAY`（:507-510）——`passableArcCount(x,y) > 1` 即拒。**注意 CE 的注释**：这条检查**先于** origin 检查，所以 area machine 的 origin 落在走廊、而必须建在 origin 的 feature 又不许走廊时，**整台机器失败**。这个顺序不能调。
2. `MF_NOT_ON_LEVEL_PERIMETER`（:513-516）——`x==0 || x==DCOLS-1 || y==0 || y==DROWS-1` 即拒。
3. `MF_BUILD_AT_ORIGIN`（:519-）——origin 恒合格（web 已有）。
4. `MF_BUILD_IN_WALLS`（:558-575）——必须是墙（`T_OBSTRUCTS_PASSABILITY`）、不在 interior、且 `machineNumber` 为 0 或等于本机器；再要求四正方向之一是 interior 格（且不是 origin），或在 `MF_BUILD_ANYWHERE_ON_LEVEL` 下是非 `T_PATHING_BLOCKER` 且 machineNumber==0 的格。否则拒。
5. **否则**若该格是墙 → 拒（:576-577，「不许建在墙里除非明令」）。
6. `MF_BUILD_ANYWHERE_ON_LEVEL`（:578-585）——带 `MF_GENERATE_ITEM` 时额外排除 `T_OBSTRUCTS_ITEMS | T_PATHING_BLOCKER` 与 `IS_CHOKEPOINT | IN_LOOP | IS_IN_MACHINE`；否则只要求不在机器内。
7. 否则 `interior[x][y]` 为真则合格。

**逐条给出你落地时对应的 web 行号**，并说明 web 缺失的判据怎么处理（例如 `passableArcCount`、`IN_LOOP` 这些 web 有没有对应物——有就用，没有就**登记为缺口**并说明近似方式，不要假装有）。

## 2. 其余 feature 级旗标

| 旗标 | CE 位置 | 要点 |
|---|---|---|
| `MF_EVERYWHERE` | `Architect.c:1387` | `feature->flags & MF_EVERYWHERE & ~MF_BUILD_AT_ORIGIN` —— 铺满所有合格格，注意那个 `& ~MF_BUILD_AT_ORIGIN` 的屏蔽不是笔误 |
| `MF_FAR_FROM_ORIGIN` | `:1340-1341` | `distanceBound[0] = distance75`。**web 用曼哈顿距离近似 CE 的路径距离分位界**（V-2b-1 已登记该留形）。本轮沿用同一近似，不要顺手改近似方式——那会动 `MF_NEAR_ORIGIN` 的既有行为 |
| `MF_PERMIT_BLOCKING` / `MF_TREAT_AS_BLOCKING` | `:1439-1446` | 阻断否决：无 PERMIT 且（地形带 `T_PATHING_BLOCKER` 或 feature 带 TREAT_AS_BLOCKING）时走 `levelIsDisconnected` 判定。**web 已有该判定**（`DungeonFeature.ts` 的 `levelIsDisconnectedOnMovementGraph`，C-8 落地），接上即可 |
| `MF_IMPREGNABLE` | `:1491` | 落位后给格子打上不可挖掘标记 |

**物品资格（Q 族）**：`MF_NO_THROWING_WEAPONS`、`MF_REQUIRE_GOOD_RUNIC`、`MF_REQUIRE_HEAVY_WEAPON` —— 在 `MF_GENERATE_ITEM` 的取物路径上做过滤。CE 依据自行定位并在报告里给行号。

**`MF_REPEAT_UNTIL_NO_PROGRESS` 改为真循环**：web 现在只把它当作「豁免 min 检查」（`BlueprintEngine.ts:881` 一带）。CE 的语义是反复尝试直到一轮下来没有新增落位。改成真循环。

## 3. 本轮的生成流影响（验收方已实测，据此安排验证）

生产数据里**带着、但引擎尚未消费**的旗标只有 5 种：

| 旗标 | 出现次数 | 本轮处置 |
|---|---|---|
| `MF_PERMIT_BLOCKING` | 7 | 本轮实现 → **会动生成流** |
| `MF_IMPREGNABLE` | 1 | 本轮实现 → 会动 |
| `MF_TREAT_AS_BLOCKING` | 1 | 本轮实现 → 会动 |
| `MF_NOT_IN_HALLWAY` | 1 | 本轮实现 → 会动 |
| `MF_KEY_DISPOSABLE` | 2 | **本轮不实现**（归 V-2b-6 钥匙轮） |

其余旗标（`BUILD_IN_WALLS` / `EVERYWHERE` / `FAR_FROM_ORIGIN` / `NOT_ON_LEVEL_PERIMETER` / `BUILD_ANYWHERE_ON_LEVEL` / Q 族）在生产数据里**零载体**，所以：

- 它们**必须用合成蓝图验证**（哨兵形态②：`createHeadlessGame(seed,'test')` 完全隔离层 + 重播种）。没有生产载体不等于可以不验——那正是「写了没人用的代码」最容易混过去的地方。
- 它们**不应该移动生成流**。若你发现某个零载体旗标的实现改变了基线，那是实现漏了条件、误伤了不带该旗标的 feature，**停下来查**，不要直接重捕获基线把它盖掉。

基线重捕获照旧是**最后一步**（§5）。

## 4. 授权改动清单

**引擎**
- `src/engine/Generator/BlueprintEngine.ts`
- `src/engine/Map/DungeonFeature.ts`（仅在接 `levelIsDisconnectedOnMovementGraph` 时需要读；**非必要不改**）

**测试与固件**
- `src/test/fixtures/generation_baseline.json`（仅 §5 最后一步）
- 新建 `src/test/v_2b_2a_placement_flags.test.ts`（本轮主验证面，合成蓝图）
- `src/test/blueprint_center.test.ts`
- `src/test/p1_33_machine_chokepoint.test.ts`
- `src/test/v_1a_blueprint_items.test.ts`
- `src/test/v_1b_alternative.test.ts`
- `src/test/v_1c_machine_structure.test.ts`
- `src/test/v_2a_vestibule_return.test.ts`
- `src/test/p1_20_item_placement.test.ts`
- `src/test/p1_31_35_placement_snapshot.test.ts`
- `src/test/p1_37_machine_flag_i18n.test.ts`
- `src/test/c_8_connectivity.test.ts`
- `src/test/p1_26_invariants.test.ts`

**不许动**：`src/data/blueprints.json`（本轮零数据改动——这是本轮与 2b 的分界线，破了这条线就是把两轮又合回去了）、`BrogueCE-master/`（只读）。

**守卫顺延不放宽**。撞断 > 5 个时停下来在报告里说明，不要硬改。

## 5. 基线重捕获

§1-2 全部改完、其余门禁项全绿之后，**最后一步**重捕获 `generation_baseline.json`。seeds 不变，note 追加本轮段。

报告里要写明：偏离层数，以及**逐个归因到那 4 个有生产载体的旗标**（哪个旗标贡献了多少层）。零载体旗标若也贡献了偏离，那是 bug，见 §3。

## 6. 授权反驳

以上 CE 判断若与你读源码所得不符，**驳回并纠正**，给出 `BrogueCE-master/src/...` 的文件:行号。

特别请复核两条：
1. **§1 那七步的顺序**——验收方是按 `Architect.c:497-590` 的行序读的，尤其第 1 条「NOT_IN_HALLWAY 先于 origin 检查」是 CE 注释自己强调的。若实际顺序不同，指出来。
2. **§3 的「零载体」判定**——验收方是扫 `blueprints.json` 的 feature `flags` 数组得出的。若某旗标以别的途径进入生产路径（默认值、代码硬编码、蓝图级旗标下放），指出来。

## 7. 门禁与报告

```
npx vitest run
npm run build
```

并行跑，不要加 `--fileParallelism=false`；类型门禁必须用 `npm run build`（`noUnusedLocals`）。失败清单完整输出，不要 `| tail`。全量门禁墙钟约 9 分钟（V-2b-1 后实测，比之前的 23 分钟快了不少）。

报告写到 `ai_docs/reports/v-2b-2a.report.md`，含：

1. §1 七步逐条的 web 落地位置，以及 web 缺失判据（`passableArcCount` / `IN_LOOP` 等）的处置
2. §2 各旗标的 CE 行号与落地位置
3. §3 那 4 个有载体旗标的逐个偏离归因；零载体旗标的合成蓝图验证结果
4. 撞断的守卫清单与处置
5. 任何行使授权反驳之处
6. 门禁两条命令的完整输出结尾
