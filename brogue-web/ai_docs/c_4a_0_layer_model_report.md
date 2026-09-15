# C-4a-0 报告：迁移 CE 的四层地形模型（结构迁移，行为逐位不变）

日期：2026-09-16 ｜ 分支：`round/c-4a-0` ｜ 改动文件：`src/engine/Map/Grid.ts`、
`src/engine/Core/Game.ts`（仅存档 schema 与 baselineTerrains）、新增
`src/test/c_4a_0_layer_model.test.ts`。

---

## 一、CE 事实复核（任务书要求逐条核对的部分）

### 1.1 `Rogue.h` 的 `enum dungeonLayers` 原文与行号

`BrogueCE-master/src/brogue/Rogue.h:1293-1300`：

```c
enum dungeonLayers {
    NO_LAYER = -1,
    DUNGEON = 0,        // dungeon-level tile   (e.g. walls)
    LIQUID,             // liquid-level tile    (e.g. lava)
    GAS,                // gas-level tile       (e.g. fire, smoke, swamp gas)
    SURFACE,            // surface-level tile   (e.g. grass)
    NUMBER_TERRAIN_LAYERS
};
```

**对任务书顺序记忆的复核结论：记对了。** GAS(2) 在 SURFACE(3) 之前，
直觉顺序是错的。web 侧 `DungeonLayer` 逐值对应
（`DUNGEON=0, LIQUID=1, GAS=2, SURFACE=3, COUNT=4`），有测试钉死。
`NO_LAYER = -1` 是查询失败哨兵不是存储层，本轮未引入。

### 1.2 `highestPriorityLayer` 的 CE 出处

`BrogueCE-master/src/brogue/Movement.c:64-80`：

```c
enum dungeonLayers highestPriorityLayer(short x, short y, boolean skipGas) {
  short bestPriority = 10000;
  enum dungeonLayers tt, best = 0;

  for (tt = 0; tt < NUMBER_TERRAIN_LAYERS; tt++) {
    if (tt == GAS && skipGas) { continue; }
    if (pmap[x][y].layers[tt] &&
        tileCatalog[pmap[x][y].layers[tt]].drawPriority < bestPriority) {
      bestPriority = tileCatalog[pmap[x][y].layers[tt]].drawPriority;
      best = tt;
    }
  }
  return best;
}
```

三个要点，web 实现逐位照搬（`Grid.ts` 的 `highestPriorityLayerOf`）：

1. **严格 `<`**：同优先级时先遇到的层（层序在前者）胜出——有对抗测试
   （DUNGEON 的 WALL 压过 LIQUID 的 GRANITE，都是 0）。
2. **`layers[tt]` 非零判空**：NOTHING=0 恰为空层哨兵，与 web 一致。
3. **全空时返回 `best = 0`（DUNGEON 层）**：任务书写"全空则返回 NOTHING"。
   两者不矛盾但要说清：CE 返回的是**层索引** 0，该层里存的地形是 NOTHING；
   web 的 `terrain` getter = `layers[highestPriorityLayer()]`，全空时自然
   得到 `TerrainType.NOTHING`。getter 语义与任务书一致，层函数与 CE 一致。

CE 的 `skipGas` 形参一并移植（`Grid.highestPriorityLayer(x, y, skipGas=false)`）。

### 1.3 归属层表逐条复核

**任务书写错两条，已按 CE 修正（都在禁改清单允许的 Grid.ts 表内）：**

| 地形 | 任务书 | CE 实际 | 依据 |
|---|---|---|---|
| **CHASM_EDGE** | SURFACE ✗ | **LIQUID** | DF 目录 `Globals.c:627` `{CHASM_EDGE, LIQUID, 100, 100, 0, …}`；且 `Architect.c` liquidType（2529-2554）case 2 取 `*shallow = CHASM_EDGE`（:2541），浅液由 `createWreath` 写入 **LIQUID**（`Architect.c:2698` `pmap[k][l].layers[LIQUID] = shallowLiquid`） |
| **OBSIDIAN** | SURFACE ✗ | **LIQUID** | 同一机制：case 3 `*shallow = OBSIDIAN`（`Architect.c:2546`）→ createWreath 写 LIQUID。任务书"CHASM_EDGE(80) 和 ASH(80) 同档看着像 SURFACE"是按 drawPriority 猜的，CE 的写入点说明它就是湖缘浅液 |

任务书最没把握的五个，复核结论：

- **MUD → LIQUID ✓（任务书写对了）**：DF 目录两条
  `{MUD, LIQUID, …}`（`Globals.c:892`、`Globals.c:905`）。drawPriority 55
  落在液体档与此互证。
- **OBSIDIAN → LIQUID（任务书写 SURFACE，修正如上）**。
- **CHASM_EDGE → LIQUID（同上）**。
- **CHARRED_FLOOR → DUNGEON**：CE 无此地形。web 里它是烧后对 FLOOR 的
  **就地替换**（`Game.ts:6353` setTerrain、`Gas.ts:143/148/154` 直写），
  不是表面覆盖物，按语义归 DUNGEON 层。
- **BOG → LIQUID**：CE 无 BOG 条目；有趣的反证是 CE 的 **MUD 用的正是
  `G_BOG` 字形**（`Globals.c:415`），语义同为沼泽液面，随 MUD 归 LIQUID。

其余任务书条目全部复核通过，代表性 CE 写入点：
花岗岩/地板/墙/门全在 DUNGEON（`Architect.c:2495` 湖底铺垫 FLOOR、
`:2511` GRANITE 补洞、`:2753` finishDoors 的 DOOR/FLOOR/SECRET_DOOR、
`:3721` DOWN_STAIRS）；陷阱类 DF 全 DUNGEON（`Globals.c:625-631`）；
湖体 `layers[LIQUID] = liquid`（`Architect.c:2561`）；绳桥
`layers[LIQUID] = BRIDGE`（`Architect.c:2831/2863`）、
`layers[SURFACE] = BRIDGE_EDGE`（`Architect.c:2833-2834/2865-2866`）；
GRASS/FOLIAGE/RED_BLOOD/ASH/SPIDERWEB 的 DF 条目全 SURFACE
（`Globals.c:609/613/640/645/681-682`）。

### 1.4 drawPriority 逐条复核

来源：`Globals.c:315` tileCatalog 第 4 列（`const floorTileType tileCatalog`，
表头注释 `// tileType  char  fore color  back color  prio  ign% …`）。

任务书列的 24 条**全部与 CE 一致**：GRANITE 0 ｜ WALL 0 ｜ SECRET_DOOR 0 ｜
DOOR 8 ｜ LOCKED_DOOR 15 ｜ ALTAR_INERT 17 ｜ SPIDERWEB 19 ｜ OPEN_DOOR 25 ｜
UP_STAIRS 30 ｜ DEEP_WATER 40 ｜ CHASM 40 ｜ LAVA 40 ｜ INERT_BRIMSTONE 40 ｜
BRIDGE 45 ｜ **FOLIAGE 45**（CE 目录尾部确有 `{FOLIAGE…45}`，我第一遍抽取在
SPIDERWEB 处截断过，补抽后确认任务书正确）｜ OBSIDIAN 50 ｜ SHALLOW_WATER 55 ｜
MUD 55 ｜ GRASS 60 ｜ CHASM_EDGE 80 ｜ ASH 80 ｜ FLOOR 95。

**web 独有地形的取值与理由：**

| web 地形 | 取值 | 最接近的 CE 对应物与理由 |
|---|---|---|
| TRAP | 30 | CE 可见陷阱 GAS_TRAP_POISON / TRAP_DOOR / FLAMETHROWER 等均为 30；隐藏态（95）不适用——web 的 TRAP 恒可见 |
| PRESSURE_PLATE | 15 | CE MACHINE_PRESSURE_PLATE = 15（DF 目录里 _USED 也为 DUNGEON 层） |
| RESET_PLATE | 15 | 同上（web 自造的"复位板"，取同族值） |
| SIGN | 7 | CE 无 sign；最接近的"地面上的人为标记"是 SACRED_GLYPH（prio 7） |
| CHARRED_FLOOR | 95 | CE 无对应物；它是 DUNGEON 层对 FLOOR 的替换，须与 FLOOR(95) 同档才保持"就是地面"的语义 |
| BOG | 55 | CE 的 MUD（prio 55、字形 G_BOG）是唯一同义物 |
| STAIRS_DOWN | 30 | CE DOWN_STAIRS = 30（`Globals.c:333`） |
| BLOOD | 80 | CE RED_BLOOD = 80 |
| WEB | 19 | CE SPIDERWEB = 19 |
| NOTHING | 100 | CE NOTHING = 100（getter 对空层不查表，此值仅为完备性） |

### 1.5 DF 目录 layer 统计

`Globals.c:603-931`，逗号界定 token 计数：**DUNGEON 57 ✓、LIQUID 49 ✓、
SURFACE 86 ✓**（与任务书完全一致）；**GAS 我数出 24，任务书说 43**——
数法差异（部分条目省略 layer 字段按 C 位置初始化默认 0=DUNGEON，以及
宏展开条目不计），对本轮无影响（GAS 层恒空），如实记录。

---

## 二、实现（行为逐位不变的论证）

### 2.1 Grid.ts

- `DungeonLayer` 枚举 + `TERRAIN_HOME_LAYER` / `DRAW_PRIORITY` 两张
  `Record<TerrainType, …>` 表（编译期完备约束 + 运行时完备测试双保险——
  `npm test` 走 esbuild 不查类型，测试必须自己兜）。
- `Cell.layers: TerrainType[]`（长度 4，初值全 NOTHING）。
- `terrain` **getter**：`layers[highestPriorityLayerOf(this.layers)]`。
- `terrain` **setter**：写归属层 + 清空其余三层。任务书只说"改成 getter"，
  但库内存在 **10 处直接 `cell.terrain =` 赋值点**（Game.ts×4、Gas.ts×4、
  LakeSystem.ts×1、Monster.ts×1——其中 Gas/LakeSystem/Monster 在本轮
  **禁改清单**里）；getter-only 在 ESM 严格模式下会让这些行抛 TypeError。
  setter 逐位复刻 plain-field 语义（t 进归属层、其余清空、**不碰**
  char/color/通行启发式），这 10 处因此一行不改而行为不变。
- `setTerrain(x,y,t)`：写归属层 + 清空其余三层（经干跑计数器逐层记账），
  启发式改为对 **getter 结果**求值（本轮 getter 恒等于写入值，逐位等价，
  为 C-4a 预留形状）；char/color/签名不变。
- `setTerrainLayer(x,y,layer,t)`：只写该层，**生产代码零调用点**（留痕测试
  钉死，扫描 `\.setTerrainLayer\s*\(`、排除 `src/test/`——带前导点的调用
  形态不会匹配 `public setTerrainLayer(` 定义本身）。
- 干跑计数器：`getCrossLayerClearStats()` / `resetCrossLayerClearStats()`，
  生产代码零读取点，仅测试消费。

### 2.2 Game.ts（存档 schema）

- `GameSnapshot.grid[]` 增加可选 `layers?: TerrainType[]`；`toSnapshot`
  每格写 `layers: [...cell.layers]`。
- `loadSnapshot`：有 `layers` → 直填四层（**不经 setTerrainLayer**，不破坏
  留痕约束；与既有 `cell.isExplored = c.isExplored` 直填风格一致）；无
  `layers`（旧存档）→ 走 `setTerrain` 语义还原（t 进归属层、其余置空）。
- `TestRoomState.baselineTerrains`（任务书写作 "LevelState.baselineTerrains"，
  实际类型是 `TestRoomState`，`LevelState` 只持有 `grid: Grid`——报告§五）：
  字段 `terrain` → `layers: TerrainType[]`；`resetTestRoom` 改为按层直填
  （基线格至多一层非空，与原 setTerrain 还原逐位等价；char/color/通行位
  照旧由基线值覆盖）。

---

## 三、干跑测量（C-4a 的输入，只测量不修复）

15 种子 × D1-D26（种子清单与 c_2_lakes_e2e / p1_29 / p1_33 同口径：
424242, 777, 20260913, 31337, 20260916, 1, 42, 999, 20260915, 55555, 2, 3, 5, 7, 11）。
真实输出（`npx vitest run … --disableConsoleIntercept` 捕获）：

```
[C-4a-0 干跑测量] 15 种子 × D1-D26 共 390 层，跨层清除事件 112033 次，组合 74 种。按层合计：DUNGEON=108978，LIQUID=1070，SURFACE=1985
```

| 层 | 被清地形 → 新地形 | 次数 |
| --- | --- | --- |
| DUNGEON | FLOOR → WATER_SHALLOW | 26151 |
| DUNGEON | FLOOR → WATER_DEEP | 3283 |
| DUNGEON | FLOOR → LAVA | 3294 |
| DUNGEON | FLOOR → GRASS | 35737 |
| DUNGEON | FLOOR → FOLIAGE | 16654 |
| DUNGEON | FLOOR → BOG | 827 |
| DUNGEON | FLOOR → WEB | 13844 |
| DUNGEON | FLOOR → BLOOD | 290 |
| DUNGEON | FLOOR → MUD | 7154 |
| DUNGEON | FLOOR → OBSIDIAN | 800 |
| DUNGEON | FLOOR → INERT_BRIMSTONE | 828 |
| DUNGEON | WALL → WATER_SHALLOW | 5 |
| DUNGEON | WALL → WATER_DEEP | 2 |
| DUNGEON | WALL → LAVA | 1 |
| DUNGEON | WALL → GRASS | 3 |
| DUNGEON | WALL → FOLIAGE | 3 |
| DUNGEON | WALL → WEB | 5 |
| DUNGEON | WALL → MUD | 3 |
| DUNGEON | DOOR → WATER_SHALLOW | 53 |
| DUNGEON | DOOR → OBSIDIAN | 12 |
| DUNGEON | TRAP → GRASS | 1 |
| DUNGEON | TRAP → FOLIAGE | 9 |
| DUNGEON | TRAP → BOG | 4 |
| DUNGEON | TRAP → WEB | 4 |
| DUNGEON | TRAP → BLOOD | 3 |
| DUNGEON | TRAP → MUD | 5 |
| DUNGEON | PRESSURE_PLATE → BOG | 1 |
| DUNGEON | PRESSURE_PLATE → BLOOD | 1 |
| DUNGEON | PRESSURE_PLATE → MUD | 1 |
| LIQUID | WATER_SHALLOW → FLOOR | 657 |
| LIQUID | WATER_SHALLOW → GRASS | 4 |
| LIQUID | WATER_SHALLOW → FOLIAGE | 5 |
| LIQUID | WATER_SHALLOW → STAIRS_UP | 2 |
| LIQUID | WATER_SHALLOW → TRAP | 12 |
| LIQUID | WATER_SHALLOW → PRESSURE_PLATE | 5 |
| LIQUID | WATER_SHALLOW → LOCKED_DOOR | 18 |
| LIQUID | WATER_SHALLOW → WEB | 9 |
| LIQUID | WATER_SHALLOW → BLOOD | 2 |
| LIQUID | WATER_DEEP → STAIRS_UP | 1 |
| LIQUID | LAVA → FLOOR | 39 |
| LIQUID | LAVA → FOLIAGE | 9 |
| LIQUID | LAVA → TRAP | 6 |
| LIQUID | MUD → FLOOR | 253 |
| LIQUID | MUD → GRASS | 2 |
| LIQUID | MUD → FOLIAGE | 1 |
| LIQUID | MUD → TRAP | 1 |
| LIQUID | MUD → PRESSURE_PLATE | 1 |
| LIQUID | MUD → LOCKED_DOOR | 10 |
| LIQUID | MUD → WEB | 6 |
| LIQUID | MUD → BLOOD | 2 |
| LIQUID | OBSIDIAN → FLOOR | 15 |
| LIQUID | INERT_BRIMSTONE → FLOOR | 10 |
| SURFACE | GRASS → FLOOR | 695 |
| SURFACE | GRASS → WATER_SHALLOW | 10 |
| SURFACE | GRASS → BOG | 30 |
| SURFACE | GRASS → STAIRS_UP | 9 |
| SURFACE | GRASS → TRAP | 31 |
| SURFACE | GRASS → PRESSURE_PLATE | 7 |
| SURFACE | GRASS → LOCKED_DOOR | 33 |
| SURFACE | GRASS → MUD | 13 |
| SURFACE | FOLIAGE → FLOOR | 489 |
| SURFACE | FOLIAGE → WATER_SHALLOW | 3 |
| SURFACE | FOLIAGE → BOG | 9 |
| SURFACE | FOLIAGE → STAIRS_UP | 1 |
| SURFACE | FOLIAGE → TRAP | 5 |
| SURFACE | FOLIAGE → PRESSURE_PLATE | 3 |
| SURFACE | FOLIAGE → LOCKED_DOOR | 21 |
| SURFACE | FOLIAGE → MUD | 3 |
| SURFACE | WEB → FLOOR | 585 |
| SURFACE | WEB → BOG | 4 |
| SURFACE | WEB → TRAP | 8 |
| SURFACE | WEB → PRESSURE_PLATE | 6 |
| SURFACE | WEB → LOCKED_DOOR | 19 |
| SURFACE | WEB → MUD | 1 |
| GAS | （无任何事件——GAS 层恒空） | 0 |

**给 C-4a 的解读**：分歧规模压倒性地集中在"**DUNGEON 层的 FLOOR 被跨层清掉**"
（10.9 万次/11.2 万次总量，96.9%）。其中 FLOOR→GRASS(3.6 万)、
FLOOR→WATER_SHALLOW(2.6 万)、FLOOR→FOLIAGE(1.7 万)、FLOOR→WEB(1.4 万) 四项
占总量 82%——即"草/网长在被覆盖写掉的地板上、液体铺在被覆盖写掉的地板上"。
反向（SURFACE/LIQUID 被结构地形清掉）只有约 3 千次。若 C-4a 放开"只清 CE
会清的"，这 11.2 万处就是候选分歧点；表按 (层, 旧→新) 聚合，可直接按条目
制定保留/清除策略。

---

## 四、存档向后兼容的验证方式

测试 `旧格式兼容：只有 terrain 字段的存档读入后 getter 逐格还原且层归一`：

1. `createHeadlessGame(777)` 生成真局，`toSnapshot()` 得到新格式存档；
2. 把 `grid` 里每格的 `layers` 字段**删除**（解构 rest），模拟 C-4a-0 之前的
   旧存档（version 仍为 1）；
3. 注入全新 Game 实例 `loadSnapshot(legacy)`；
4. 逐格断言（全图 3400 格，>1000 的下限检查防空转）：
   - `cell.terrain === 存档 terrain`（错误实现读到 NOTHING 在此翻红）；
   - 四层归一：`layers[home(t)] === t`，其余三层全 NOTHING（证明旧档走的是
     setTerrain 语义，不是"原样塞进 DUNGEON 层"之类。

新格式往返另有独立用例：测试手造多层格（FLOOR+GRASS、FLOOR+WATER_DEEP），
往返后**四层逐层相等**且 getter 胜出者正确——证明保真到层，不止保真到 getter。

---

## 五、`.terrain` 引用实际改动数

任务书口径"143 处非测试引用 + 81 处测试引用"；当前代码实测
**非测试 157 处（不含 Grid.ts）、测试 138 处**——数字自任务书撰写后已随
C-2/C-3 轮次漂移，如实记录。

**实际改动：非测试引用 0 处。** `git diff` 逐行核对，与 `.terrain` 相关的
变更只有：

- `Game.ts` `resetTestRoom`：`terrain.terrain`（baselineTerrains 记录上的
  还原入参）→ 按层直填。**这正是任务书命令改为 layers 的那一行**，
  属存档 schema 授权范围，不属于"57 处引用"。
- `Game.ts` `loadSnapshot`：`setTerrain(c.x, c.y, c.terrain, …)` 一行
  **保留原文**，仅移入旧格式分支（缩进变化）。
- `Grid.ts` 内部：`cell.terrain = terrain` → `const effective = cell.terrain`
  （启发式改对 getter 求值）——这是层模型本体，不是外部调用点。

全部 157 处非测试引用（含禁改文件 Gas.ts×4、LakeSystem.ts×1、Monster.ts×1
的读写）一行未动——它们能不改就通过，正是"行为不变"的证据之一。

---

## 六、对抗性测试与反向验证

### 6.1 对抗性测试（每个都有明确所指的错误实现）

| # | 用例 | 能抓住的错误实现 |
|---|---|---|
| 1 | 取 drawPriority 最小者 | 比较方向写反（取最大） |
| 2 | 同优先级先遇到的层胜出 | `<` 写成 `<=`（后者胜） |
| 3 | skipGas 跳过 GAS 层 | 形参缺失/条件写错 |
| 4 | setTerrain 覆盖后其余三层全空 | 漏清任一层 → 残留 GRASS(60) 压过 FLOOR(95) 使 getter 翻红 |
| 5 | 直接赋值 cell.terrain = t 层语义 | setter 缺失/语义偏离（禁改文件的 10 个直写点靠它） |
| 6 | 液体必须落 LIQUID | 归属表把液体写进 SURFACE |
| 7 | 表面/结构地形落层 | SURFACE/DUNGEON 整表写反 |
| 8 | 两张表与报告口径逐条一致 | 表值手滑改动 |
| 9 | 旧格式存档读入 getter 逐格还原 | 读不到 layers 时返回 NOTHING / 层不归一 |
| 10 | 新格式往返四层逐层相等 | 快照丢层（只存 getter 值） |
| 11 | DungeonLayer 数值序 | GAS/SURFACE 对调、COUNT 错 |
| 12 | Cell.layers 长度 4 | 初始化长度错 |
| 13 | 表完备性运行时守卫 | 新增枚举成员忘补表（esbuild 不报错） |
| 14 | 同种子两次完整生成链四层全等 | 任何移动 RNG 流/非确定化改动 |
| 15 | 干跑计数：跨层记、同层不记 | 计数器把同层覆盖也计入/漏计 |

### 6.2 反向验证（真实改坏 → 真实失败输出 → 还原，共 4 条）

**RV1：`highestPriorityLayerOf` 的 `<` 改 `>`**

```
FAIL … > 取 drawPriority 最小者：FLOOR(95) 之下的 GRASS(60) 胜出（比较方向写反即翻红）
AssertionError: expected +0 to be 3 // Object.is equality
  - Expected  + Received
  - 3          +0
```

**RV2：`writeTerrainHome` 故意漏清其余层**

```
FAIL … > setTerrain 覆盖后其余三层必须全空（漏清任一层 → getter 返回旧地形，翻红）
AssertionError: expected 10 to be 2 // Object.is equality
  - Expected  + Received
  - 2          +10        （10 = GRASS 残留 SURFACE，getter 返回旧地形）
```

**RV3：`DungeonLayer` 的 GAS/SURFACE 枚举值对调**

```
FAIL … > DungeonLayer 数值序逐值对齐 CE Rogue.h:1293-1300（GAS 在 SURFACE 之前）
AssertionError: expected 3 to be 2 // Object.is equality
```
（注：skipGas 语义用例在枚举对调下依然绿——它引用的是符号名而非数值，
对"序"敏感的是本条数值序测试。）

**RV4：`TERRAIN_HOME_LAYER` 把 WATER_DEEP 写进 SURFACE**

```
FAIL … > 液体必须落 LIQUID：把某个液体写进 SURFACE 的错误实现在这里翻红
AssertionError: expected 3 to be 1 // Object.is equality
  - Expected  + Received
  - 1          +3         （3 = SURFACE，液体落错层）
```

四条均已还原，还原后 `c_4a_0_layer_model.test.ts` 20/20 绿、
`generation_baseline` 绿。

### 6.3 留痕测试（"明确不做的事"，断言现状）

1. **`setTerrainLayer` 生产调用点为 0**：源码扫描（排除 `src/test/`，
   正则 `\.setTerrainLayer\s*\(`），失败消息列出全部越界点。C-4a 接管时
   反转本断言。
2. **GAS 层恒空**：2 种子 × D{1,5,12,26} 全格扫描 `layers[GAS] === NOTHING`；
   干跑测量里另断言"被清层 = GAS 的事件数为 0"。
3. **未引入地形属性表**：`Grid.ts` 去注释后扫描
   `promoteType|promoteChance|fireType|mechFlags|T_IS_FLAMMABLE|T_SPONTANEOUSLY_IGNITES`
   零命中（CE 旗标名允许存在于文档注释，不允许以代码标识符形态出现）。

---

## 七、门禁读数

### 7.1 `npm test`（最终代码树，完整输出尾部）

```
 Test Files  62 passed (62)
      Tests  647 passed | 8 skipped | 5 todo (660)
   Start at  03:23:34
   Duration  237.01s (transform 2.16s, setup 0ms, import 15.77s, tests 1727.64s, environment 16ms)
```
（exit=0。`p1_26` / `p1_29` / `p1_33` 坏层闸门包含在内，全绿；
无"真失败 vs 超时"需要区分的情形。）

### 7.2 `generation_baseline` 绿色读数（单独重跑，实际输出）

```
 RUN  v4.1.11 /…/brogue-web
 Test Files  1 passed (1)
      Tests  1 passed (1)
   Start at  03:27:44
   Duration  10.48s (transform 176ms, setup 0ms, import 308ms, tests 10.10s, environment 0ms)
```

**未刷新 fixture**。4 seed × D1-D26 地形指纹与基线逐项一致——"行为逐位
不变"的判据成立。

### 7.3 `npm run build`

```
> vue-tsc -b && vite build
✓ built in 1.37s
(exit=0；chunk >500kB 警告为既有提示，与本轮无关)
```

（vue-tsc 首跑确实揪出 4 处类型错：3 处 `generateDepth` private 访问、
1 处枚举断言——均已按既有测试惯例（`g: any` / `as unknown as`）修复，
这也再次验证了任务书"只看 npm test 会漏 TS2339"的提醒。）

### 7.4 git diff --stat

```
 brogue-web/src/engine/Core/Game.ts |  36 ++++-
 brogue-web/src/engine/Map/Grid.ts  | 292 ++++++++++++++++++++++++++++++++++--
 2 files changed, 313 insertions(+), 15 deletions(-)
（新增：src/test/c_4a_0_layer_model.test.ts，未跟踪文件）
```

禁改清单全部未动（Gas.ts / Architect.ts / RoomBuilder.ts / BlueprintEngine.ts /
Map 下其他文件 / Monster.ts / GameCanvas.vue / BrogueCE-master / *.json /
Random.ts / vite.config.ts / 既有测试与 fixtures 零改动）。

---

## 八、与预设不符之处（只列不修）

1. **任务书归属表两条写错：CHASM_EDGE 与 OBSIDIAN 应为 LIQUID 而非
   SURFACE**（依据：`Globals.c:627` DF 条目 + `Architect.c:2541/2546` +
   `createWreath` `Architect.c:2698` 写 LIQUID）。已按 CE 修正进表，
   有测试钉死。任务书自己标注的五个存疑地形中，MUD→LIQUID 是对的。
2. **"highestPriorityLayer 全空返回 NOTHING"表述不精确**：CE 函数全空时
   返回层索引 0（DUNGEON 层），该层存的地形才是 NOTHING。web 按层函数/
   getter 分开实现，两者都对齐了各自应对照的东西。
3. **"LevelState.baselineTerrains" 是误称**：实际是 `TestRoomState
   ['baselineTerrains']`（Game.ts:277 一带）；`LevelState` 只持有
   `grid: Grid`，不存地形副本。已按实际类型改存 layers。
4. **DF 目录 GAS 计数**：任务书 43，逗号界定 token 计数得 24（DUNGEON 57 /
   LIQUID 49 / SURFACE 86 三个数完全吻合）。GAS 不参与本轮，仅记录差异。
5. **任务书要求 terrain "改成 getter"**，但存在 10 处直接
   `cell.terrain =` 赋值（其中 Gas.ts×4、LakeSystem.ts×1、Monster.ts×1 在
   禁改清单里），getter-only 会在运行时抛 TypeError。实现为
   getter+setter，setter 逐位复刻 plain-field 语义（见§2.1）。若验收方
   坚持无 setter，需要同时解禁上述 3 个文件并改 10 处调用点——行为不变
   判据（baseline 不刷新）下的无谓扩权，不建议。
6. **`.terrain` 引用计数漂移**：任务书 143/81，实测 157/138（代码演进
   所致）。结论不变：非测试引用 0 处被动改动。
7. **确定性口径比任务书预设的更微妙（重要）**：web 的 rng 是全局单例，
   `startNewGame` 重播种，但 `generateDepth` **沿用当前流**，且 web 没有
   CE 的 per-level levelSeed 设施（WaypointMap.ts:108-114 注释自证）。
   实测（15 种子内 2 种子的对照实验）：两个实例各自"直接跳 D9"得到的图
   **不相等且不该相等**——后生成者的 D9 消费的是被前者推进过的流段
   （同一实例 D1 后消耗 44146 次抽取，另一实例同格位消耗 74250 次）。
   因此"同种子两次生成四层逐格相等"的可复现单元是**从 startNewGame 起
   的完整生成链**（生成基线正是这个口径，所以它稳定）。确定性测试按
   完整链实现并通过。若 C-4a 之后要 CE 级别的"逐层可复现"，需要引入
   levelSeed 基础设施——那会移动 RNG 流，须单独立项。
8. **项目常识文档 §四 已过时**：`Monster.ts` / `Creature.ts` 的
   `Math.random()` 已不存在（全引擎/实体 0 处），"同 seed 只保证地图
   确定、玩法不确定"中地图一半的限定词可以收窄；建议常识文档维护者
   复核更新（本轮未动该文档）。
9. **测量表里出现 `WALL → 液体`（17 次）与 `DOOR → OBSIDIAN`（12 次）**：
   这是 web 湖缘/硫矿缘覆盖了墙与门的罕见事件（CE 的 createWreath 有
   `DOOR→FLOOR` 守卫，web 侧无对应分支）。本轮只测量不修复，留给 C-4a
   连同"清空其余三层"一起裁决。
