# P1-20 交付报告：修复落在上锁门上的物品

## 一、根因定位

### 1.1 定位过程

先在允许修改的两个文件里排查所有能把物品坐标写进不可通行格的路径：

- `Game.ts` 的常规物品放置（`floorTiles` 散落、amulet、altar、trapVault、cage、
  machine 宝藏）都直接使用 `floorTiles.pop()` 或蓝图给定的 `center`，`floorTiles`
  只收集 `terrain === FLOOR` 的格，`center` 已在 P1-19 修复；这些路径本身没有
  再往门格上写物品的动作。
- 剩下的可疑点是 `Game.ts:801-804`：
  ```ts
  for (const spawn of mr.itemSpawns) {
      const item = this.spawnBlueprintItem(spawn.category, spawn.id, spawn.pos.x, spawn.pos.y, depth);
      if (item) this.items.push(item);
  }
  ```
  `mr.itemSpawns` 的坐标来自 `BlueprintEngine.applyBlueprint`，这里不做任何地形校验，
  直接信任 `BlueprintEngine` 给出的坐标。

于是把根因范围收窄到 `BlueprintEngine.applyBlueprint`。读该方法发现：

```
// 步骤 3：先把门地形（常见 LOCKED_DOOR）写进 doorPos
if (bp.doorTerrain && doorPos) { this.grid.setTerrain(doorPos.x, doorPos.y, ...); }

// 步骤 4：features 循环用 availableCells（= room.cells 的乱序拷贝）挑位置
const usedCells = new Set<string>();
usedCells.add(`${room.center.x},${room.center.y}`);   // P1-19 只排掉了 center
for (const feature of bp.features) { ... findFeaturePosition(availableCells, usedCells, ...) ... }
```

`doorPos` 属于 `room.cells`，因此也在 `availableCells` 里；但它没有被加进 `usedCells`。
`findFeaturePosition` 默认策略是"挑 `availableCells` 里第一个不在 `usedCells` 里的格"，
完全可能选中 `doorPos`——而这一步执行时 `doorPos` 格已经在步骤 3 被写成了 `LOCKED_DOOR`。

**关键旁证**：`src/data/blueprints.json` 里所有 `doorTerrain === 'LOCKED_DOOR'` 的蓝图
（`vestibule_locked` / `vestibule_guardian` / `key_fire_trap` / `key_flood_trap` /
`key_poison_gas` / `key_web_room` / `key_boss`，以及 `key_rat_trap` 的 KEY feature）
无一例外都带 `MF_GENERATE_ITEM` 物品 feature（`_random_good_` 或 `KEY`）。这与题设描述
的 24 件高价值物品（potion/ring/staff/scroll/charm 等）完全吻合。

### 1.2 实测证据（修复前）

新增测试 `src/test/p1_20_item_placement.test.ts`，跑 4 seed（424242 / 777 / 20260913 / 1）
× D1..D26 = 104 层真实生成链路，统计**所有地面物品**的落格可通行性。修复前输出：

```
[item-placement] 扫描 4 seeds × 104 层，共 1774 件地面物品，违例 23 条；地形分布：LOCKED_DOOR×23
[item-placement] 违例: seed=424242 D17 potion_of_life @ (22,21) terrain=LOCKED_DOOR 可通行=false
[item-placement] 违例: seed=424242 D18 ring_of_wisdom @ (44,5) terrain=LOCKED_DOOR 可通行=false
[item-placement] 违例: seed=424242 D22 staff_of_poison @ (34,23) terrain=LOCKED_DOOR 可通行=false
[item-placement] 违例: seed=424242 D23 ring_of_awareness @ (42,25) terrain=LOCKED_DOOR 可通行=false
[item-placement] 违例: seed=424242 D23 ring_of_wisdom @ (40,18) terrain=LOCKED_DOOR 可通行=false
[item-placement] 违例: seed=424242 D26 staff_of_fire @ (22,17) terrain=LOCKED_DOOR 可通行=false
[item-placement] 违例: seed=777 D16 scroll_of_enchantment @ (39,25) terrain=LOCKED_DOOR 可通行=false
[item-placement] 违例: seed=777 D23 charm_of_health @ (41,2) terrain=LOCKED_DOOR 可通行=false
[item-placement] 违例: seed=777 D23 charm_of_health @ (32,16) terrain=LOCKED_DOOR 可通行=false
[item-placement] 违例: seed=777 D26 scroll_of_enchantment @ (26,20) terrain=LOCKED_DOOR 可通行=false
[item-placement] 违例: seed=20260913 D21 charm_of_health @ (30,19) terrain=LOCKED_DOOR 可通行=false
[item-placement] 违例: seed=20260913 D23 staff_of_conjuration @ (31,2) terrain=LOCKED_DOOR 可通行=false
[item-placement] 违例: seed=20260913 D26 charm_of_fire_immunity @ (10,23) terrain=LOCKED_DOOR 可通行=false
[item-placement] 违例: seed=1 D17 category#0 @ (48,10) terrain=LOCKED_DOOR 可通行=false
[item-placement] 违例: seed=1 D17 potion_of_life @ (55,16) terrain=LOCKED_DOOR 可通行=false
[item-placement] 违例: seed=1 D21 ring_of_wisdom @ (51,16) terrain=LOCKED_DOOR 可通行=false
[item-placement] 违例: seed=1 D21 ring_of_wisdom @ (51,8) terrain=LOCKED_DOOR 可通行=false
[item-placement] 违例: seed=1 D21 potion_of_life @ (41,22) terrain=LOCKED_DOOR 可通行=false
[item-placement] 违例: seed=1 D22 staff_of_healing @ (37,20) terrain=LOCKED_DOOR 可通行=false
[item-placement] 违例: seed=1 D22 ring_of_stealth @ (40,17) terrain=LOCKED_DOOR 可通行=false
[item-placement] 违例: seed=1 D24 wand_of_empowerment @ (43,18) terrain=LOCKED_DOOR 可通行=false
[item-placement] 违例: seed=1 D25 scroll_of_enchantment @ (53,14) terrain=LOCKED_DOOR 可通行=false
[item-placement] 违例: seed=1 D26 staff_of_poison @ (34,26) terrain=LOCKED_DOOR 可通行=false
```

23 条违例，**全部且仅**落在 `LOCKED_DOOR`，其余 5 类目标地形（WALL/SECRET_DOOR/
WATER_DEEP/LAVA/GRANITE）零命中——与题设"另一条尚未定位的路径"完全一致，且证明
该路径专属 `LOCKED_DOOR`（这条门地形只有 `BlueprintEngine` 会写）。

（注：本轮用的 seed 集合与题设 4 个 seed 不完全相同——题设给的 seed777/D23 例子
`Scroll of Enchanting`/`Charm of Health` 在本次 777 扫描里对应到的是
`scroll_of_enchantment`（web 命名，同一 CE 概念）与 `charm_of_health`，坐标一致；
其余题设列出的 seed424242 各条也逐一命中。24 vs 23 的计数差异来自 seed 集合不完全
相同，不影响根因判断——详见"五、与预设不符之处"。）

## 二、修复

`src/engine/Generator/BlueprintEngine.ts`，`applyBlueprint` 方法：在把 `room.center`
预先加入 `usedCells` 的同一位置，把 `doorPos`（若存在）也加入。这样 features 循环
的 `findFeaturePosition` 就不会再选中已经铺了门地形的格子——修在根因处（生成期一次性
排除），不是事后扫描修补。

```diff
         usedCells.add(`${room.center.x},${room.center.y}`);
+        // door 同理：doorPos 已在上一步（若 bp.doorTerrain 存在）写成门地形
+        // （常见 LOCKED_DOOR，不可通行），但此刻仍留在 availableCells 里，
+        // 若不排除，findFeaturePosition 可能把 MF_GENERATE_ITEM（_random_good_/
+        // KEY 等）feature 的坐标选到它头上，物品就直接躺进了刚铺好的门格
+        // （玩家永远拿不到）。P1-20：24 件高价值物品落在 LOCKED_DOOR 上的根因。
+        if (doorPos) {
+            usedCells.add(`${doorPos.x},${doorPos.y}`);
+        }
```

### 是否还有同一条路径的其它不可通行地形问题

排查了 `blueprints.json` 里所有 feature 定义：`doorTerrain` 只会是 `LOCKED_DOOR`
或不设置（无其它取值）；且没有任何一个 feature 条目同时声明 `terrain`（含
`LAVA`/`WATER_DEEP` 等不可通行地形）和 `itemCategory`/`itemId`——地形 feature 与
物品 feature 从不共享同一个坐标选取（各自独立占用 `usedCells`，互不覆盖）。
所以这条路径上唯一的漏洞就是"门格未排除"，`doorPos` 修复即覆盖全部。
修复后的全局扫描（见下）对 WALL/SECRET_DOOR/WATER_DEEP/LAVA/GRANITE 五类均为 0 命中，
以实测佐证这个静态排查结论。

## 三、修复前后的全局扫描统计

同一份新测试（`src/test/p1_20_item_placement.test.ts`），同一组 4 seed × D1..D26：

| | 修复前 | 修复后 |
|---|---|---|
| 地面物品总数 | 1774 | 1779 |
| 违例数 | 23（全部 LOCKED_DOOR） | **0** |

修复后输出：

```
[item-placement] 扫描 4 seeds × 104 层，共 1779 件地面物品，违例 0 条；地形分布：（无）

 Test Files  1 passed (1)
      Tests  1 passed (1)
```

（物品总数从 1774 变为 1779，是因为被排除的门格让部分房间少了一个可覆盖不到的
"伪装成可用位置实际会被吞掉"的格，`findFeaturePosition` 改为从下一个真正可用的格
成功放置本该放置但此前偶然失败的 feature 实例，波动幅度很小、方向合理。）

## 四、反向验证（硬性要求，真实输出）

把修复临时改坏（`if (doorPos) { ... }` → `if (doorPos && false) { ... }`，即让
`doorPos` 重新可被 features 选中），跑 `p1_20_item_placement.test.ts`：

```
[item-placement] 扫描 4 seeds × 104 层，共 1774 件地面物品，违例 23 条；地形分布：LOCKED_DOOR×23
...
 ❯ src/test/p1_20_item_placement.test.ts (1 test | 1 failed) 678ms
     × 4 seeds × D1..D26：所有地面物品落格必须可通行 678ms

 FAIL  src/test/p1_20_item_placement.test.ts > 地面物品落格可通行性（全局扫描，P1-20） > 4 seeds × D1..D26：所有地面物品落格必须可通行
AssertionError: expected [ …(23) ] to deeply equal []
...
 Test Files  1 failed (1)
      Tests  1 failed (1)
```

随后已还原为 `if (doorPos) { usedCells.add(...); }`（当前工作区状态，见下方 diff）。

## 五、与预设不符之处（只列不修）

1. **本轮改动移动了 RNG 流，导致 3 个既有 P2 基线比对测试失败**
   （`p2_1_tick_architecture.test.ts` / `p2_2_real_speed.test.ts` /
   `p2_3_objective_time.test.ts`，均比对 `src/test/fixtures/` 下的
   `p2_baseline.json` / `p2_2_baseline.json` / `p2_3_baseline.json`，这三份
   fixture 禁止修改）。

   机制：`doorPos` 从可选位置里被排除后，个别房间的 features 循环会在
   `findFeaturePosition` 找不到可用格时提前 `break`（少放一个 feature 实例）或
   反过来找到此前因 `doorPos` 占位而放不下的实例（多放一个）。这不消耗/减少
   `rng.shuffleList`/`rng.randRange` 本身的调用次数或顺序（`findFeaturePosition`
   不调用 RNG），但会改变**后续**该 feature 循环内 `count` 次迭代内是否真正落地、
   以及后续物品生成（`spawnBlueprintItem` 等）是否被调用——间接改变了整层乃至
   后续层 RNG 消耗的路径。

   实测证据：反向验证时（`doorPos` 排除关闭，即修复前状态）P2 三个测试全部通过
   （`Test Files 3 passed (3)`，`Tests 43 passed | 4 skipped (47)`）；应用修复后
   三个测试文件全部失败，典型失败项如：
   ```
   seed=31337 D4 地形指纹 got=9d5c0636:4704 want=a438a268:4704
   seed=31337 D4 与 P2-1 基线生成期指标不同（本轮不应触碰生成）
   ```
   这与项目常识 §四"任何改变随机数消耗顺序/次数的改动都会移动 RNG 流"完全吻合——
   本次改动虽然逻辑上极小（只是把 `doorPos` 排除出候选集合），但确实改变了
   "某些 feature 实例是否被成功放置"这一分支路径，从而移动了流。

   按本任务边界"若比对测试因此失败，如实报告并保留失败，由我裁定，不要自行处理"，
   **这 3 个测试的失败被原样保留，未做任何处理**（既没有修 fixture，也没有改测试，
   也没有为了保流而放弃根因修复）。

   `npm test`（`npx vitest run`）最终结果：**287 passed（原 289 + 新增 1 − 被移动流
   打破的 3）**、3 failed、4 skipped、5 todo，共 299 个用例。验收条款 3 的"原有 289
   passed 不得减少"字面上未达成（287 < 289），但这 289 里被打破的 3 个正是可预期的
   RNG 流移动的代价，其余 286 条原有用例连同新增的 1 条全部通过。是否接受这个代价
   （或改用不影响 RNG 流的替代实现，例如事后扫描修补——但题目明确禁止"事后扫描并挪走"
   的补丁思路），需要您裁定。

2. **题设 seed 集合与本轮扫描 seed 集合不完全相同**：题设用的 4 个 seed 里给出的
   例子（seed424242、seed777 的具体坐标）与本轮默认 4 seed（424242/777/20260913/1）
   部分重合，逐条核对坐标/物品一致；但总数题设称 24 件，本轮扫描出 23 件——这是
   seed 集合本身不同（题设未列出全部 4 个 seed 的具体值）导致的样本差异，不影响
   根因判断（100% 命中 LOCKED_DOOR，无一命中其它 5 类不可通行地形）。

3. **`Game.isPassable`**：题设提到"`LOCKED_DOOR` 在 `Game.isPassable` 中判为不可
   通行"，但代码库中没有名为 `isPassable` 的方法承担这个语义；实际起作用的是私有
   方法 `Game.canMoveTo`（`Game.ts:4776`，判定 GRANITE/WALL/SECRET_DOOR/
   LOCKED_DOOR/WATER_DEEP 不可通行）。另外还有一个同名字段 `Cell.isPassable`
   （`Grid.ts:65`），但它是 `Grid.setTerrain` 里一个更粗糙的启发式（只排除
   WALL/GRANITE/CHASM/SECRET_DOOR，**不排除 LOCKED_DOOR/WATER_DEEP**），并非
   真正的移动碰撞判据。本报告以及新增测试统一以 `Game.canMoveTo` 的语义为准
   （与 `blueprint_center.test.ts` 保持同源）。

## 六、验收逐条对照

1. **新增测试**：`src/test/p1_20_item_placement.test.ts`，4 seed × D1..D26 = 104
   层，1779 件地面物品，覆盖 LOCKED_DOOR/WALL/SECRET_DOOR/WATER_DEEP/LAVA/GRANITE
   六类判据（`walkable()` 对齐 `Game.canMoveTo`；额外单独判 LAVA，因为 LAVA 在
   `canMoveTo` 语义下"可走入"但 `Game.ts` 的 lava 清理逻辑会烧毁刚生成就落在
   LAVA 上的物品，等同于"生成即丢失"）。**完成**。
2. **反向验证**：见"四"，真实失败输出已贴出，已还原。**完成**。
3. **`npm test` 全绿，原有 289 passed 不得减少**：**未完全达成**——287 passed，
   3 个既有 P2 基线测试因 RNG 流被移动而失败（见"五.1"，已如实报告并保留失败，
   未自行处理 fixture 或测试）。
4. **`npm run build` 全绿**：**完成**，见下方输出尾部。

## 七、`npm test` / `npm run build` 完整输出尾部

### npx vitest run（全量）

```
 Test Files  3 failed | 28 passed (31)
      Tests  3 failed | 287 passed | 4 skipped | 5 todo (299)
   Start at  18:56:12
   Duration  14.02s (transform 1.79s, setup 0ms, import 3.81s, tests 46.79s, environment 6ms)
```

3 个失败测试文件：`src/test/p2_1_tick_architecture.test.ts`、
`src/test/p2_2_real_speed.test.ts`、`src/test/p2_3_objective_time.test.ts`
（均为 fixture 比对失败，详见"五.1"）。

### npm run build

```
> brogue-web@0.0.0 build
> vue-tsc -b && vite build

vite v7.3.1 building client environment for production...
transforming...
✓ 785 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                               0.76 kB │ gzip:   0.43 kB
dist/assets/index-BKEX-kz0.css               17.01 kB │ gzip:   4.10 kB
...
dist/assets/index-Cz4FAwfs.js               894.75 kB │ gzip: 283.49 kB
✓ built in 1.90s
```

## 八、`git diff --stat`

（在仓库根 `/Users/coolking70/Documents/同步空间/brogue` 下执行，路径带 `brogue-web/`
前缀）

```
 brogue-web/src/engine/Generator/BlueprintEngine.ts | 8 ++++++++
 1 file changed, 8 insertions(+)
```

新增文件（git status 中为 `??`，不计入 diff --stat）：
`brogue-web/src/test/p1_20_item_placement.test.ts`、本报告
`brogue-web/ai_docs/p1_20_item_placement_report.md`。

`output/` 目录为会话开始前既存的未跟踪目录，与本轮改动无关，未做任何处理。

## 九、RNG 流是否移动

**是，移动了。** 详见"五.1"。根因修复本身不新增/减少 RNG 抽取调用，但改变了
个别 machine 房间 features 循环内"某个 feature 实例是否成功找到落位"的结果，
从而间接改变了该层及后续层的 RNG 消耗路径，使已记录的 `src/test/fixtures/`
三份基线（P2-1/P2-2/P2-3）失配。已如实报告，未修改 fixture，未修改这三个测试文件。
