# P1-2c 修复报告：有地形要求的 horde（spawnsIn）真正刷出

日期：2026-09-14
涉及文件：`src/engine/Core/Game.ts`（唯一实现改动）、`src/test/horde_terrain_spawn.test.ts`（新增测试）、本报告。

---

## 1. 缺陷与修复概述

**缺陷**：`populateLevel` 的落点池 `floorTiles` 只收集 `TerrainType.FLOOR` 格（Game.ts:625-635 旧口径），而 `hordeFitsTerrain` 对 `spawnsIn === 'DEEP_WATER'` 要求 `WATER_DEEP` 等——两个集合永不相交。因此所有带 `spawnsIn` 的 horde 在 failsafe 50 次重抽内永远匹配失败、被跳过，EEL / KRAKEN / BOG_MONSTER / NAGA / SALAMANDER 等水生/泥沼/熔岩群落**自然生成恒为 0**。

**修复口径**（对齐 CE Monsters.c:830-868 + Architect.c:3822）：抽中 horde **之后**，按其 `spawnsIn` 作为目标地形全图找匹配格；找不到才在 failsafe 50 内重抽 horde。`spawnsIn` 为空仍走原 FLOOR 池路径，行为不变。

## 2. 实现内容（Game.ts，+86/-19 行）

1. **`SPAWNS_IN_TERRAIN` 静态映射表**：`DEEP_WATER→WATER_DEEP`、`SHALLOW_WATER→WATER_SHALLOW`、`MUD→MUD`、`LAVA→LAVA`；`hordeFitsTerrain` 改查该表（行为与原 switch 完全一致，未知名仍 false），与新的取格路径共用同一口径。
2. **`findTerrainSpawnLocation(spawnsIn)`**：CE `randomMatchingLocation` 的 spawnsIn 路径等价（见 §3 对照）；在全图收集 terrain 匹配且无占用的格，随机取一；无合法格返回 `null`。
3. **`passableArcCount(x, y)`**：CE Architect.c:171 的弧段计数移植（cDirs 顺序一致），实现调用方 Monsters.c:836 的 `passableArcCount(loc) > 1 → 重抽`（排除走廊/路口格）。
4. **populateLevel horde 循环重构**：`cand.spawnsIn` 有值 → `findTerrainSpawnLocation`；为空 → 原 `floorTiles` 随机取格 + splice 路径逐字保留。failsafe 50 结构复用：任一路径找不到格都重抽 horde。
5. **未触碰**：`floorTiles` 的其他职责（楼梯、D26 护符、机器房/宝库/笼子钥匙、物品落点、成员落格移除）全部原样；`spawnPeriodicHorde` 的"落点固定"分支（CE Monsters.c:814-828 固定位置语义）原样。

## 3. 与 CE `randomMatchingLocation` 的语义对照

CE 调用（Monsters.c:835）：
```c
while (!randomMatchingLocation(&loc, FLOOR, NOTHING, (spawnsIn ? spawnsIn : -1))
       || passableArcCount(loc.x, loc.y) > 1) {
    if (!--failsafe) return NULL;
    hordeID = pickHordeType(...);   // 找不到格 → 重抽 horde
}
```

`randomMatchingLocation`（Architect.c:3822-3845）逐条对照：

| CE 条件（spawnsIn 有值时生效项） | web 实现 | 一致性 |
|---|---|---|
| `cellHasTerrainType(loc, terrainType)`（地形匹配） | `cell.terrain === SPAWNS_IN_TERRAIN[spawnsIn]` | ✅ 一致（CE 的 `cellHasTerrainType` 检查格上最终地形，web 的 `cell.terrain` 同义） |
| 占用位 `HAS_PLAYER \| HAS_MONSTER \| HAS_STAIRS \| HAS_ITEM \| IS_IN_MACHINE` | 排除 `getMonsterAt` / 玩家位 / `items.some` / `machineNumber !== 0`；楼梯是独立 terrain 值与目标地形互斥，天然排除 | ✅ 一致 |
| 随机采样 ≤500 次的拒绝采样（均匀分布） | 全图收集合法格后 `randRange` 取一（同为合法格上的均匀分布） | ✅ 分布等价，采样方式不同（任务书指定的收集式） |
| 调用方 `passableArcCount(loc) > 1 → 重抽` | `passableArcCount` 移植（cDirs 环游顺序一致），`>1` 的格不入池 | ✅ 一致 |
| 调用方找到格后，若在入口楼梯 FOV/视野内则重找（≤25 次） | 以"玩家切比雪夫距离 ≤5 的格排除"代理——与既有 FLOOR 池同口径 | ⚠️ 近似（见 §7-1） |
| `terrainType < 0` 分支（dungeon 层 = FLOOR、`T_OBSTRUCTS_ITEMS`） | 不适用——`spawnsIn` 为空仍走既有 FLOOR 池路径（任务书要求保持现有行为） | ✅ 按任务书保持 |
| 外层 failsafe 50 内重抽 `pickHordeType` | 完全一致 | ✅ 一致 |

CE 里 `passableArcCount` 对无 `spawnsIn` 的 horde 同样生效；web 的 FLOOR 池路径未加该检查（属既有行为，本轮不改，见 §7-2）。

## 4. 验收自测结果

### 4.1 npm test 与 npm run build 输出尾部

```
> brogue-web@0.0.0 test
> vitest run

 RUN  v4.1.11 /Users/coolking70/Documents/同步空间/brogue/brogue-web

 Test Files  22 passed (22)
      Tests  199 passed | 5 todo (204)
```
原有 189 passed 全部保留（199 = 189 + 本轮新增 10）。

```
> brogue-web@0.0.0 build
> vue-tsc -b && vite build

✓ 784 modules transformed.
...
dist/assets/index-CPaLh1xt.js   885.39 kB │ gzip: 281.21 kB
✓ built in 1.33s
```
（>500 kB chunk 警告为既有现象，非本轮引入。）

### 4.2 git diff --stat

```
 brogue-web/src/engine/Core/Game.ts | 105 ++++++++++++++++++++++++++++++-------
 1 file changed, 86 insertions(+), 19 deletions(-)
```
另有新增文件 `src/test/horde_terrain_spawn.test.ts`（未跟踪）。**未触碰** Architect.ts、BlueprintEngine.ts、Monster.ts、Combat*.ts、Player.ts、Item*.ts、Gas.ts、Bolt.ts、src/data/ 下任何 json，未修改任何既有 .test.ts。

### 4.3 新增测试（src/test/horde_terrain_spawn.test.ts，10 条全绿）

1. 深水地图上 `findTerrainSpawnLocation('DEEP_WATER')` 返回 WATER_DEEP 格，`spawnHordeAt(EEL horde, pos)` 后领袖确实落在该深水格（验收 1）。
2. 取格纯度：50 次取样全部为目标地形格、切比雪夫距离 >5、无怪物占用。
3. 无深水/无 LAVA/未知 spawnsIn（STATUE_INSTACRACK）时返回 null → 调用方 failsafe 重抽。
4. D8 普通池含 2 条 EEL(DEEP_WATER) horde 且 1000 次加权抽取命中 120 次（≈freq 份额 11.8%）——修复的前提条件。
5. `passableArcCount` 有界性 + 开阔地 0 / 贴墙 ≥1 的一致性。
6. `hordeFitsTerrain` 口径不变：spawnsIn=null 恒真（含深水格）；DEEP_WATER 只认 WATER_DEEP（验收 2）。
7. 仅以"无 spawnsIn 领袖"身份出现的物种（toad/centipede/spider/wisp/zombie/acidic_jelly/explosive_bloat），排除笼子/机器区既有路径后，40/40 全部落在 FLOOR 格（验收 2 的端到端版）。
8. 4 seed × D1-D26：楼梯（D<26 有下行梯、D>1 有上行梯）全部存在且可站立；护符/钥匙（floorTiles 路径）不落墙（验收 3）。
9. 盐渍深水图 × 30 轮 `populateLevel`：EEL 经真实铺怪路径落深水格（修复前恒 0）。
10. 8 seed × D1-D26 全流程统计（见 §5）。

## 5. 多 seed × D1-D26 统计（验收 4）

seed = [424242, 20260914, 20260915, 20260916, 314159, 271828, 141421, 999983]，共 208 层。

### 5.1 修复前 vs 修复后

| 指标 | 修复前 | 修复后 |
|---|---|---|
| 水生 horde 精确落在目标地形的次数 | **0** | **249** |
| 有水生怪出现的层数 | 0/208 | 104/208（50.0%） |

### 5.2 分物种（修复后）

| 物种 | spawnsIn | 总出现 | 精确落目标地形 |
|---|---|---|---|
| EEL | DEEP_WATER | 89 | 78 |
| BOG_MONSTER | MUD | 182 | 129 |
| KRAKEN | DEEP_WATER | 48 | 32 |
| NAGA | DEEP_WATER | 20 | 10 |
| SALAMANDER | LAVA | 11 | **0**（原因见 §6-3） |
| 合计 | | 350 | 249 |

非目标地形出现的 101 次均为既有路径：笼子随机池/蓝图随机怪（全部带机器区标记）与 horde 成员环搜溢出（泥沼 horde 成员落外围门/草地等，CE 同款 r≤5 环搜语义）。

### 5.3 前置约束量化：地图深水覆盖

| 指标 | 数值 |
|---|---|
| 完全没有 WATER_DEEP 格的层数 | **97/208（46.6%）** |
| 有 WATER_DEEP 格的层数 | 111/208（53.4%） |
| 有 MUD 格的层数 | 106/208（51.0%） |
| 有 LAVA（露天岩浆湖）格的层数 | **0/208**（仅机器/宝库房内有人工岩浆，20/208 层） |

分深度水生层占比：D1 为 0/8（EEL minLevel=2，CE 语义正确），D2 起每深度 1-7/8 层不等，中段（D18-D20）最高达 7/8。逐层数据：

```
D 1: 0/8    D 2: 4/8   D 3: 1/8   D 4: 2/8   D 5: 1/8   D 6: 4/8   D 7: 6/8
D 8: 4/8    D 9: 2/8   D10: 2/8   D11: 4/8   D12: 4/8   D13: 3/8   D14: 5/8
D15: 6/8    D16: 6/8   D17: 3/8   D18: 7/8   D19: 7/8   D20: 6/8   D21: 5/8
D22: 5/8    D23: 5/8   D24: 3/8   D25: 4/8   D26: 5/8
```

**结论**：落点匹配修复后，约半数层能出现水生群落；但上限受地牢生成器制约——近半数层（46.6%）因 0-2 团小 blob 的深水覆盖不足而无法承载水生 horde，CE 的四类完整湖泊系统（岩浆/深水/深渊/硫矿）仍待 §5 生成器里程碑补齐。

## 6. 其他 spawnsIn 地形覆盖情况（任务书要求项）

- **MUD（BOG_MONSTER）**：覆盖最好。MUD blob（D≥3 每层 0-2 团）+ 106/208 层有泥沼 → 129 次正确落格，D7-14 窗口内出现稳定。
- **SHALLOW_WATER**：hordes.json 普通池中**没有** spawnsIn=SHALLOW_WATER 的条目（仅机器专用 horde 使用水系落点），无覆盖率可报；映射表已支持，未来数据接入即生效。
- **LAVA（SALAMANDER）**：普通池有该 horde（D13-20），但地牢生成器**不产生露天岩浆**，岩浆只存在于机器/宝库房内，而 CE 语义（IS_IN_MACHINE 排除）正确地不把机器区格当作自然落点 → SALAMANDER 自然生成仍为 0。这与修复前一致，属生成器（§5 里程碑）前置约束，不是本修复的回归。

## 7. 与预设不符之处（只列不修）

1. **提示词对 `randomMatchingLocation` 的描述有两处不精确**：
   - 提示词称该函数处理 "forbiddenTerrain / 玩家距离"；实际函数签名是 `(dungeonType, liquidType, terrainType)`，没有 forbiddenTerrain/玩家距离逻辑——玩家距离/可见性约束在**调用方**（Monsters.c:836 的 `passableArcCount` 与找到格后对 `ANY_KIND_OF_VISIBLE | IN_FIELD_OF_VIEW` 的 ≤25 次重试）。本实现按真实语义对齐，玩家距离沿用 web 既有 FLOOR 池的切比雪夫 >5 代理。
   - CE 采取的是"抽 horde → 随机拒绝采样找格（≤500 次）"，本实现按任务书指定改为"收集合法格 → 随机取一"，统计分布等价（合法格上的均匀分布），RNG 流消耗不同。
2. **CE 的 `passableArcCount > 1` 检查对无 spawnsIn horde 也生效**，web 的 FLOOR 池路径（既有行为）没有该检查；按"保持现有行为"的边界未加。
3. **既有问题（与本次改动无关，量化自测试日志）**：machine/vault 房宝藏直接放在 `findSuitableRoom` 返回的房间**质心**（BlueprintEngine.ts:185-189），非凸房间的质心可能落在墙里——例：seed=424242 D22 的 Wand of Fire 落在不可通行格。该路径不经 floorTiles，修复前即如此，修需改 BlueprintEngine/Game 宝藏落格逻辑，超出本轮边界。
4. **笼子随机池/蓝图随机怪不受 spawnsIn 约束**（如笼中 Salamander、机器区 Naga）——CE 的机器/笼子放怪同样不走 `randomMatchingLocation`，属既有等价行为，仅影响统计口径（已在 §5.2 拆分）。
5. **monsters.json 显示名与 hordes.json 目录名口径不一**（"Bog monster" vs `BOG_MONSTER`，空格 vs 下划线）——测试内做了归一化；数据层本身未动。
6. **提示词验收 3 的"物品不落在墙里"在既有代码上不可达**（见第 3 条），测试改为断言 floorTiles 路径物品（钥匙/护符）不落墙 + 楼梯可站立，机器区宝藏落墙现象在测试日志中记录。

## 8. 边界遵守声明

- 仅修改 `src/engine/Core/Game.ts`；新增 `src/test/horde_terrain_spawn.test.ts` 与本报告。
- 未执行任何 git 写操作（commit/add/push/reset/checkout）。
- 未在仓库内创建临时文件（调试埋点已全部移除并复核 diff）。
