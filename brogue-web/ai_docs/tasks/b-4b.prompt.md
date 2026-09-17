# B-4b：物品生成规则对齐 ——「落在哪 / 多少个」（**独占轮，移动 RNG 流**）

## 0. 角色与授权反驳条款

你是**开发方**。本任务书由**验收方**撰写，验收方**会写错 CE 事实**。
凡本文引用的 CE 行号、公式、字段，你都**必须打开
`BrogueCE-master/src/brogue/*.c|*.h` 与 `BrogueCE-master/src/variants/GlobalsBrogue.c`
逐字核对**。冲突时**以 CE 源码为准**，并在最终回复开 `## 对任务书的反驳` 一节，
写明：验收方原话 / CE 实际内容（文件:行号 + 原文片段）/ 你据此做了什么。

**没有反驳节 = 你没核对。** 上一轮（B-3）执行方的四条反驳里有两条是对的，
其中一条还补上了验收方**根本没给**的 CE 事实（`DF_SHATTERING_SPELL` 的目录条目）。
这一节不是形式，是本项目防错的主力。

## 1. 本轮范围

B-4a 已经把**「生成什么」**对齐了（计量表 / 频率加权 / 附魔模型 / 投掷物 / 缺失种类）。
本轮 B-4b 管**「落在哪、落多少」**，即 CE `populateItems`（`Items.c:537-800`）的另一半。

| 本轮做 | 本轮不做 |
|---|---|
| 每层物品数量公式 | 物品种类/附魔（B-4a 已完成，**不要回改**）|
| 热力图落位 | `AutoGenerator.ts` 的 `CRYSTAL_WALL` 缺口（见 §3）|
| 金币投放与产量调度 | UI/渲染 |
| 钥匙的来源与数量 | |
| 食物保底与落位例外 | |

**本轮授权重新捕获 `generation_baseline`。**

## 2. 五件事

### 2.1 每层物品数量（CE `Items.c:573-608`）

```c
numberOfItems = 3;
while (rand_percent(60)) { numberOfItems++; }      // 无上界几何分布
if (rogue.depthLevel <= 2)      numberOfItems += 2;
else if (rogue.depthLevel <= 4) numberOfItems++;
numberOfItems += gameConst->extraItemsPerLevel;
```

web 现在是 `const numItems = rng.randRange(3, 6)`（`Game.ts` 附近，自己定位）
—— **均匀分布、有上界**，与 CE 的**无上界几何分布**分布形状完全不同。
`extraItemsPerLevel` 去 `GlobalsBrogue.c` 查 Brogue 变体的实际值（**不要假设是 0**）。

深度 > `amuletLevel` 时走另一分支（`lumenstoneDistribution`，`numberOfGoldPiles = 0`），
web 若无流明石系统，登记 deferral 但**保留分支结构**（本项目的「照抄留形」惯例）。

### 2.2 热力图落位（CE `Items.c:463-535` + `:612-650`）

这是本轮的主菜，也是 web 完全没有的东西。web 现在是 `floorTiles.pop()` ——
**从一个预先洗好的牌堆里弹出**，等价于均匀随机，没有任何空间偏置。

CE 的模型（**逐行核对，验收方只给骨架**）：

1. **初始化**：全图 `heatMap[i][j] = 50000`。
2. **`fillItemSpawnHeatMap(heatMap, 5, upstairs)`**（`:463-482`）：从上行楼梯**递归泛洪**，
   起始 heat = 5；途经 `DOOR` 则 `heatLevel += 10`，途经 `SECRET_DOOR` 则 **`+= 3000`**；
   每格取**最小值**（`if (heatMap > heatLevel) heatMap = heatLevel`）；
   向**四正方向**扩散（`dir < 4`，不是八方向），且邻格须
   `!cellHasTerrainFlag(T_IS_DEEP_WATER | T_LAVA_INSTA_DEATH | T_AUTO_DESCENT)`
   且 `isPassableOrSecretDoor(neighbor)` 且 `heatLevel < heatMap[neighbor]`。
   ⚠️ **递归**，不是 BFS 队列 —— 展开顺序影响结果，照抄递归形态。
3. **归零 pass**（`:612-628`）：满足下列任一的格子 heat 置 0 ——
   `T_OBSTRUCTS_ITEMS | T_PATHING_BLOCKER`、
   `IS_CHOKEPOINT | IN_LOOP | IS_IN_MACHINE`、`passableArcCount(i,j) > 1`。
   CE 注释：*"Not in walls, hallways, quest rooms, loops or chokepoints, please."*
   另有一条失效保护：仍等于 50000 的格子（泛洪没到达的孤岛）置 0 **并把该格改成 `WALL`**。
   同时累加 `totalHeat`。
4. **选点 `getItemSpawnLoc`**（`:507-535`）：`randIndex = rand_range(1, totalHeat)`，
   然后按 `i` 外层、`j` 内层的扫描序累减 —— **heat 越高越容易被选中**。
   因为泛洪是"离楼梯越远、尤其隔着密门越远，heat 越高"，
   所以**密门后的房间被极大偏好**（heat +3000 一次）。这正是 CE 注释说的
   *"This is why there are often several items in well hidden secret rooms."*
   ⚠️ **扫描序（i 外 j 内）决定同 heat 时选谁，不能换成 j 外 i 内。**
5. **降温 `coolHeatMapAt`**（`:484-505`）：选中格 heat 归零并从 `totalHeat` 扣除；
   然后 `k,l ∈ [-5,5]` 的邻域里，**heat 恰等于 currentHeat 的格子**
   降为 `max(1, heat/10)`，并同步扣 `totalHeat`。
   ⚠️ 条件是 `== currentHeat`（同热区），不是 `<=` 也不是全邻域。

**落位例外**（`:645-652`）：`FOOD` 与 `POTION_STRENGTH` **不走热力图**，
改用 `randomMatchingLocation(FLOOR, NOTHING, -1)` 并 `do…while (passableArcCount > 1)`
（即**不许落在走廊**）。CE 注释：*"Food and gain strength don't follow the heat map."*

### 2.3 金币（CE `Items.c:545-550`、`:593-606`、`:774-783`、`:377`）

web **全库没有任何生成期金币投放点**（P1-50 已复核确认：金币恒 0）。
唯一的金币来源是怪物掉落（`Game.ts` 的 `goldDropChance`），
而且拾取时是 `this.stats.gold += 10`，**硬编码 10、无视 `quantity`**
（那行旁边还留着 `// Or whatever gold value` 的占位注释）。

CE：

- 堆数 `numberOfGoldPiles = min(5, depthLevel * depthAccelerator / 4)`，
  然后 `for (goldBonusProbability = 60; rand_percent(goldBonusProbability) && numberOfGoldPiles <= 10; goldBonusProbability -= 15) numberOfGoldPiles++;`
  ⚠️ 概率**每轮递减 15**（60 → 45 → 30 → 15 → 0），不是固定值；
- **产量调度**（`:598-606`）：`depthLevel >= goldAdjustmentStartDepth` 时，
  若 `rogue.goldGenerated` 低于 `aggregateGoldLowerBound(...)` 则堆数 +2，
  高于 `aggregateGoldUpperBound(...)` 则 −2。上下界用 `POW_GOLD[]` 表
  （`:545-548`，b^3.05，26 项）加 `320*d` / `420*d`。**表要逐个数字抄**；
- 每堆数量（`:377`）：`rand_range(50 + depth*10*depthAccelerator, 100 + depth*15*depthAccelerator)`；
- 金币**走热力图**（`:776-780`），且 `rogue.goldGenerated += theItem->quantity`；
- 金币在主物品循环里被**排除**（`:673` `theCategory = ALL_ITEMS & ~GOLD`，
  CE 注释 *"gold is placed separately, below, so it's not a punishment"*）。

拾取侧的 `+= 10` 必须改成 `+= theItem.quantity`。

### 2.4 钥匙（P1-50：每局 140-166 把）

**CE 里钥匙不由 `populateItems` 产生，一把都不。** 它只来自蓝图里**与锁具绑定**的
四个 feature 条目（`GlobalsBrogue.c:250 / 258 / 262 / 300`，自行核对）：

```
KEY, KEY_CAGE   … MF_GENERATE_ITEM | MF_OUTSOURCE_ITEM_TO_MACHINE | MF_SKELETON_KEY | MF_KEY_DISPOSABLE
KEY, KEY_CAGE   … （吸血鬼棺材那条，MF_MONSTER_TAKE_ITEM）
KEY, KEY_PORTAL … ALTAR_KEYHOLE
KEY, KEY_DOOR   … LOCKED_DOOR，MF_BUILD_AT_ORIGIN | MF_IMPREGNABLE
```

全部带 `ITEM_IS_KEY | ITEM_PLAYER_AVOIDS`，且 `MF_OUTSOURCE_ITEM_TO_MACHINE`
表示钥匙被放到**另一个机器里**（"守卫着的钥匙"），而不是随便找块地板。

web 现在是：机器房、陷阱库、笼子、蓝图锁门**各自**
`floorTiles.pop()` 出一个随机地板格再 `spawnKey('iron_key', …)`，无上限、无绑定。
这就是 140-166 的来源。

本轮要把钥匙改成**由锁具驱动**：有几个锁，就有几把钥匙，
且钥匙与锁的对应关系要能被查询（CE 的 `theItem->keyLoc[]`，`Items.c:65-67` / `:4040-4043`）。
web 若无 `keyLoc` 载体，本轮补一个最小可用的绑定字段，并在测试里断言
**钥匙数 == 锁数**。

### 2.5 食物保底（CE `Items.c:658-666`）

```c
if ((rogue.foodSpawned + foodTable[RATION].power / 3) * 4 * FP_FACTOR
    <= (POW_FOOD[rogue.depthLevel-1] + (randomDepthOffset * FP_FACTOR))
       * foodTable[RATION].power * 45/100) {
    theCategory = FOOD;
    if (rogue.depthLevel > gameConst->amuletLevel) numberOfItems++;
}
```

`POW_FOOD[]` 是 50 项定点数表（`:551-563`），`FP_FACTOR` 见 `Rogue.h`。
**定点数运算不要改写成浮点** —— 会与 CE 的整数截断结果不同。
`randomDepthOffset` 与 B-4a 同一个值（`depthLevel > 2` 时两次 `rand_range(-1,1)` 之和）。

web 若无 `foodSpawned` 累计器，本轮补。

## 3. 绝对禁止

- **不得修改 `BrogueCE-master/` 下任何文件**（只读参考，D6）。
- **不得回改 B-4a 的产物**（计量表、附魔模型、投掷物、物品表条目）。
  发现 B-4a 有错 → 写进反驳节登记，**不要顺手改**，由验收方裁决。
- **不得修改 `src/engine/Map/AutoGenerator.ts`。**
  B-3 已把 `CRYSTAL_WALL` 地形就位，但 `DF_CRYSTAL_WALL` 尚未入目录、两条自动生成器仍未接线。
  那是**独立的一小轮**，不要塞进本轮 —— 本轮范围已经够大了。
- 不得修改 §4 授权清单之外的任何测试。
- 不得为了让测试变绿而放宽断言。**守卫要顺延，不要放宽**
  （见 `project_conventions.md` 的「第四种形态」一节）。

## 4. 允许修改的文件

先按下面的**三段 grep** 自己再核一遍（验收方的清单历史上漏过 9 次）：

```bash
# ① 本轮主题
grep -rln "populateItems\|heatMap\|goldGenerated\|iron_key\|foodSpawned\|numItems" src/test --include="*.test.ts"
# ② 结构性穷举表
grep -rln "toEqual(\[" src/test --include="*.test.ts"
# ③ 跨轮公共目录（按标识符，不按主题）——第四种漏授权形态
for sym in TERRAIN_FLAGS DUNGEON_FEATURE_CATALOG DF_MISSING_TILES \
           LIGHT_CATALOG TERRAIN_HOME_LAYER DRAW_PRIORITY; do
  echo "== $sym =="; grep -rl "\b$sym\b" src/test --include="*.test.ts"
done
```

**生产代码：**
- `src/engine/Core/Game.ts`（数量、落位、金币、钥匙的主场）
- `src/engine/Items/ItemLoader.ts`、`src/engine/Items/Item.ts`（金币 quantity、钥匙绑定字段）
- `src/engine/Generator/Architect.ts`（若热力图要建在生成器侧）
- 新建 `src/engine/Items/ItemSpawnHeatMap.ts`（建议：热力图独立成文件，便于单测）
- `src/locales/**`

**测试（授权修改）：**
- `src/test/generation_baseline.test.ts` + `src/test/fixtures/generation_baseline.json`
  —— ✅ **授权重新捕获**。重捕获**必须保留并追加 `note` / `capturedAt` / `d` 字段**
  （历史上三次被脚本写丢）。`note` 写明本轮授权理由。
- `src/test/p1_20_item_placement.test.ts`（落位可通行性）
- `src/test/p1_31_35_placement_snapshot.test.ts`（落位快照）
- `src/test/p1_33_machine_chokepoint.test.ts`（归零 pass 排除 chokepoint/machine）
- `src/test/p1_29_lake_connectivity.test.ts`、`src/test/c_0_add_loops.test.ts`（IN_LOOP 排除）
- `src/test/p1_37_machine_flag_i18n.test.ts`（钥匙/机器）
- `src/test/invented_content_pool.test.ts`、`src/test/p1_30_i18n_gate.test.ts`
- 新建 `src/test/b_4b_item_placement.test.ts`

**清单外红了：停下，不要改**，写进 `## 需要追加授权的测试`。
本轮移动生成流，**撞击面比 B-4a 还大**，这一节非空是正常的。

## 5. 测试要求

### 5.1 必须覆盖

1. **数量分布**：大样本统计每层物品数，验证是**无上界几何分布**
   （出现过 ≥ 9 件的层），而不是 3-6 的均匀分布。
2. **热力图偏置**：构造一张有密门隔间的图，统计物品落在密门后的比例
   **显著高于**面积占比 —— 这是热力图的**行为终点**，不是实现细节。
3. **归零 pass**：物品**从不**落在 chokepoint / IN_LOOP / 机器格 / `passableArcCount > 1`
   的走廊格上。
4. **食物/力量药水的落位例外**：它们**不**受热力图偏置，且**不**落在走廊。
5. **金币**：每层金币堆数在 CE 公式区间内；每堆 quantity 符合
   `rand_range(50+d*10, 100+d*15)`；拾取后 `stats.gold` 增加的是 **quantity 而非 10**；
   跑满一局后 `goldGenerated` 落在 `aggregateGoldLowerBound/UpperBound` 附近。
6. **钥匙数 == 锁数**：一局下来铁钥匙总数与锁具总数相等，且每把钥匙能查到它对应的锁。
   （P1-50 的 140-166 必须消失。）
7. **食物保底**：长局不会饿死 —— 统计 `foodSpawned` 随深度的累计曲线贴合 `POW_FOOD`。

### 5.2 对抗性测试（强制，至少三条）

每条都必须**真的能被某个具体的错误实现打红**：

- ① 把 `fillItemSpawnHeatMap` 的 `SECRET_DOOR += 3000` 改成 `+= 10`（与 DOOR 同）
  → 测试 2 的密门偏置断言必须红；
- ② 把 `coolHeatMapAt` 的 `== currentHeat` 改成 `<= currentHeat`
  → 降温范围扩大，落位分布改变，相应断言必须红；
- ③ 把 `getItemSpawnLoc` 的扫描序从「i 外 j 内」换成「j 外 i 内」
  → `generation_baseline` 必须红（同 heat 时选点不同）。

### 5.3 反向验证（强制）

每条对抗断言：**真的改坏 → 跑 → 贴真实失败输出 → 还原 →
`grep -rn "REVERT-ME" src/` 必须为 0**。只写「我验证过了」判不合格。

### 5.4 哨兵纪律

本轮**移动生成期 RNG 流**。新哨兵只许三种形态：
① `rng.randomNumbersGenerated` 增量；② `createHeadlessGame(seed,'test')` 完全隔离合成层
（清怪清物后 reseed）；③ 性质断言（分布/区间/单调性）。
**不许**锚定 RNG 流绝对位置 —— S-1 已为此还过一整轮的债。
撞见既有哨兵因位移而断，**改成上述三种之一**，不要硬填新数值。

## 6. 纯测量先行（强制）

本轮几乎所有断言都依赖真实分布。**先写一次性测量脚本**
（N 个 seed × D1-D26，统计每层物品数 / 落位分布 / 金币产量 / 钥匙数 / 食物曲线），
把**改造前后的对比数据**贴进回复，**再**据此写断言区间。
宽到永远不会红的断言等于没有断言；没有测量数据，验收方无法复核你的区间。

B-4a 的测量文件叫 `zz_b4a_measure.test.ts`，照此命名 `zz_b4b_measure.test.ts`，
并在 §8 说明它是留还是删。

## 7. 门禁

**二级门禁（全量串行）**：

```
npx vitest run --fileParallelism=false
```

约 18 分钟；外加 `npx tsc --noEmit` 无新增错误。
`generation_baseline` 允许因重捕获而变化，但**重捕获后必须绿**。

## 8. 最终回复必须包含的小节

1. `## 对任务书的反驳`
2. `## 纯测量数据`（改造前 / 改造后对比）
3. `## 改动清单`
4. `## 对抗性测试与反向验证`（含**真实失败输出**粘贴）
5. `## 哨兵处置`
6. `## 需要追加授权的测试`
7. `## 门禁结果`（全量串行真实输出尾部）
8. `## 遗留与登记`（含测量文件去留、`AutoGenerator.ts` 缺口现状、任何 B-4a 疑似错误）
