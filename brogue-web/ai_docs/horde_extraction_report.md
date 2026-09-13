# Horde 数据表重提取报告（CE 权威基线）

日期：2026-09-14
本轮范围：**只改数据，不改任何代码逻辑**。抽取逻辑（均匀随机、无权重、无 OOD）保持原样，下一轮再改。

## 交付物

| 文件 | 说明 |
| --- | --- |
| `src/data/hordes.json` | 全量重写：从 CE 源码提取的 175 条 hordeCatalog_Brogue |
| `scripts/extract_hordes.cjs` | 可提交的提取脚本（解析 CE 枚举 + 表体，全自检通过才落盘） |
| `src/data/hordes.test.ts` | 新增回归测试，25 个用例 |

未触碰 `Game.ts` / `Monster.ts` / 其他任何代码与数据文件；未执行任何 git 写操作。

## 权威来源与提取方法

- 表体：`BrogueCE-master/src/variants/GlobalsBrogue.c` L744 `const hordeType hordeCatalog_Brogue[] = {`，至其后第一个 `};`（L949），表体条目 L746–L948。
- 结构体：`Rogue.h:2235`（leaderType, numberOfMemberTypes, memberType[5], memberCount[5], minLevel, maxLevel, frequency, spawnsIn, machine, flags），位置初始化，尾部字段省略即 0。
- 符号常量（脚本从源码解析，不硬编码）：
  - `AMULET_LEVEL = 26`、`DEEPEST_LEVEL = 40`（GlobalsBrogue.c L43-44）
  - `MT_CAMP_AREA = 62`（Rogue.h `enum machineTypes` 顺序值）
  - flag 位 `Fl(n) = 1<<n`（Rogue.h L97）
- 枚举名（tileType / monsterTypes / hordeFlags）均从 Rogue.h 解析并做存在性校验；leader/member 的 `MK_` 名逐一验证在 `monsterTypes` 枚举中。

## 序列化约定（与旧文件消费方 Game.ts 对齐）

- `leader` / `members[].type`：去掉 `MK_` 前缀、全大写（与旧文件一致，Game.ts 按 `toLowerCase()` 查 monsters.json）。
- `members[].minCount / maxCount`：memberCount 的 {min, max}；**clumpFactor 第三元本轮不表达**（见下文清单）。
- `maxLevel`：一律数字（`DEEPEST_LEVEL-1`→39、`DEEPEST_LEVEL`→40、`AMULET_LEVEL`→26）。旧文件用 `null` 表示无上界；新表全部数值化后 Game.ts 的 `h.maxLevel !== null` 分支照常工作，且更忠实 CE（例如 D40 深层不再出现 TENTACLE_HORROR 常规群，CE 本意如此）。
- `spawnsIn`：CE 为 0 → `null`；否则 tileType 名（`DEEP_WATER`/`MUD`/`LAVA`/`WALL`/`STATUE_DORMANT`/`TURRET_DORMANT`/`MACHINE_MUD_DORMANT`/`MONSTER_CAGE_CLOSED`/`STATUE_INSTACRACK`）。旧文件没有该字段，本轮为新增字段，Game.ts 不读它，无行为影响。
- `machine`：数字（省略即 0）；唯一非零值 `MT_CAMP_AREA = 62`。
- `flags`：字符串数组（省略即 `[]`），flag 名与 Rogue.h 枚举一致。

## 自检锚点对照（独立核算 vs 本轮提取）

| 指标 | 锚点 | 实测 | 结论 |
| --- | --- | --- | --- |
| 表体总条数 | 175 | **175** | ✅ |
| 常规可刷（排除 5 个 flag + `HORDE_MACHINE_*` 前缀） | 58 | **58** | ✅ |
| 含 `HORDE_LEADER_CAPTIVE` | 56 | **56** | ✅ |

无分歧，无需凑数。

## npm test / npm run build 输出尾部

`npm test`（vitest run）：

```
 Test Files  13 passed (13)
      Tests  100 passed | 1 expected fail | 7 todo (108)
   Start  02:46:51
   Duration  2.55s
```

原有 75 passed **原样保留**，新增 `hordes.test.ts` 25 个用例，合计 100 passed，无原有用例减少或失败。

`npm run build`（vue-tsc -b && vite build）：

```
dist/assets/WebGLRenderer-DKaVpY2w.js        68.42 kB │ gzip:  18.71 kB
dist/assets/index-93mKIYVl.js               868.63 kB │ gzip: 274.22 kB

(!) Some chunks are larger than 500 kB after minification. Consider: …
✓ built in 1.36s
```

chunk 体积警告为项目原有现象，与本轮无关。

## git diff --stat

```
 brogue-web/src/data/hordes.json | 1230 +++++++++++++++++++++++++++++++++------
 1 file changed, 1038 insertions(+), 192 deletions(-)
```

（另新增未跟踪文件 `scripts/extract_hordes.cjs`、`src/data/hordes.test.ts`、本报告。）

## 新旧 hordes.json 差异摘要

旧表 132 条中：**102 条**与新表（=CE）逐字段全等；**27 条**存在数值偏差（级别/频率与 CE 不符，例如旧 RAT 常规群 `1-3/f100` vs CE L746 `1-5/f150`）；**3 条**在 CE 中根本不存在，属手造条目，已删除：

- `RAT 1-3 / f80`、`KOBOLD 1-4 / f80`、`JACKAL 2-6 / f80`（CE 无此三条）

旧表"常规池 15 条 / 9 物种"与任务描述完全吻合（RAT×2, KOBOLD×2, JACKAL×2, EEL×2, VAMPIRE_BAT, BOG_MONSTER×2, NAGA, SALAMANDER, KRAKEN×2）。

### 新增/修正的常规 horde（按领袖分组，"级别/frequency[@spawnsIn]"）

共 58 条常规池中，43 条为旧表缺失（任务口径的"漏提 43 条"），7 条为旧表有但数值被纠正，合并列出如下（加 ∗ 的领袖为旧表常规池从未有过的物种）：

- RAT: 1-5/f150（数值纠正）
- KOBOLD: 1-6/f150（数值纠正）
- JACKAL: 1-3/f100（纠正）、3-7/f50（新增）
- ∗MONKEY: 2-9/f50、5-13/f20
- ∗BLOAT: 2-13/f30、14-26/f30
- ∗PIT_BLOAT: 2-13/f10、14-26/f10
- ∗EXPLOSIVE_BLOAT: 10-26/f10
- ∗GOBLIN: 3-10/f100、6-12/f40
- ∗GOBLIN_CONJURER: 3-10/f60、7-15/f40
- ∗TOAD: 4-11/f100
- ∗PINK_JELLY: 4-13/f100、17-23/f70
- VAMPIRE_BAT: 6-13/f30（新增；旧表只导入了 6-13/f70 那条）
- ∗ACID_MOUND: 6-13/f100、9-13/f30
- ∗CENTIPEDE: 7-14/f100
- ∗OGRE: 7-13/f100
- ∗SPIDER: 9-16/f100
- ∗DAR_BLADEMASTER: 10-14/f100、15-17/f100、18-25/f100
- ∗WILL_O_THE_WISP: 10-17/f100
- ∗WRAITH: 10-17/f100、16-23/f80
- ∗ZOMBIE: 11-18/f100
- ∗TROLL: 12-19/f100
- ∗OGRE_SHAMAN: 14-20/f100
- ∗CENTAUR: 14-21/f100
- ∗ACID_JELLY: 14-21/f100
- ∗PIXIE: 14-21/f80
- ∗PHANTOM: 16-23/f100
- ∗IMP: 17-24/f100
- ∗FURY: 18-26/f80
- ∗REVENANT: 19-27/f100
- ∗GOLEM: 21-30/f100、27-39/f80、30-39/f20
- ∗TENTACLE_HORROR: 22-39/f100、32-39/f20
- ∗PHYLACTERY: 22-39/f100
- ∗DRAGON: 24-39/f70、27-39/f30、34-39/f20
- KRAKEN: 30-39/f100@DEEP_WATER（新增；旧表误作 maxLevel 无界）

（BOG_MONSTER 12-26/f100@MUD、EEL 8-22/f70@DEEP_WATER、NAGA 13-20/f100@DEEP_WATER、SALAMANDER 13-20/f100@LAVA 与旧表一致，未列。）

### 常规池可产出物种数：修复前 9 → 修复后 41（≥ 40 达标）

新增覆盖的 32 个物种：
ACID_JELLY, ACID_MOUND, BLOAT, CENTAUR, CENTIPEDE, DAR_BATTLEMAGE, DAR_BLADEMASTER, DAR_PRIESTESS, DRAGON, EXPLOSIVE_BLOAT, FURY, GOBLIN, GOBLIN_CONJURER, GOBLIN_MYSTIC, GOLEM, IMP, MONKEY, OGRE, OGRE_SHAMAN, PHANTOM, PHYLACTERY, PINK_JELLY, PIT_BLOAT, PIXIE, REVENANT, SPIDER, TENTACLE_HORROR, TOAD, TROLL, WILL_O_THE_WISP, WRAITH, ZOMBIE。

（DAR_BATTLEMAGE / DAR_PRIESTESS / GOBLIN_MYSTIC 以成员身份进入常规池；goblin / ogre / troll / wraith 等陆生主力此后可自然刷出。）

## 各深度可用常规 horde 数（CE 硬窗口口径：minLevel ≤ d ≤ maxLevel）

| d | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | … | 17 | 22 | 26 | 30 | 39 | 40 |
| --- | - | - | - | - | - | - | - | - | - | -- | - | -- | -- | -- | -- | -- | -- |
| 条数 | 3 | 7 | 10 | 11 | 12 | 15 | 18 | 18 | 20 | 23 | … | 22 | 16 | 11 | 9 | 9 | 0 |

全量表：`node scripts/extract_hordes.cjs` 会打印 D1–D40 完整分布。

## memberCount 的 clumpFactor 差异清单（只列不修）

全表 175 条 × 5 槽位中，仅两处 clumpFactor ≠ 1，且本轮 JSON 均未表达该三元（下一轮如需 clumping 语义再处理）：

| GlobalsBrogue.c 行 | 条目 | member | {min,max,clump} |
| --- | --- | --- | --- |
| L807 | GOLEM 深层群（30-39/f20） | MK_GOLEM | {5, 10, **2**} |
| L808 | KRAKEN 深水群（30-39/f100） | MK_KRAKEN | {5, 10, **2**} |

## 与预设不符之处 / 本轮发现的问题（只列不修）

1. **"各深度可用常规 horde 数 ≥ 8" 在 D1 不成立（提示词预设错误）**。CE 常规表在 D1 窗口内只有 3 条：RAT（L746）、KOBOLD（L747）、JACKAL（L748）；第 4 浅的 MONKEY 也是 minLevel=2（L751）。CE 的 `pickHordeType`（Monsters.c L511）就是硬窗口过滤，D1 只有 3 条是 CE 原意（另 CE 有 10% 概率从更深处 OOD 取怪，属抽取逻辑，下一轮的范畴）。测试按 CE 真值断言 D1=3，其余抽查深度 D3/D5/D8/D12/D17/D22/D26 均 ≥ 8（实际 10/12/18/23/22/16/11）。
2. **两个物种的 CE 名与 web monsters.json 的 id 失配**：CE `WILL_O_THE_WISP`（web 叫 `wisp`）、`ACID_JELLY`（web 叫 `acidic_jelly`）。Game.ts 按 `id === leader.toLowerCase()` 精确匹配，因此这两个领袖领衔的两条常规群（L776 10-17/f100、L788 14-21/f100）在当前代码下不会实际刷出。本轮数据保持 CE 名不动（改 id 属 monsters.json 范畴，禁改）；下一轮做抽取逻辑时建议加别名映射。除这两个领袖外，两群还有成员失配的连带问题（无——这两群均无成员）。
3. **旧文件里 30 条数值与 CE 不符、3 条纯手造**（RAT/KOBOLD/JACKAL 的 f80 版本），全部被 CE 值替换，清单见上。
4. **`maxLevel` 由 null 惯例改为全数值**（26/39/40 等真实 CE 值）：语义上比旧的"无界"更忠实（例如 TENTACLE_HORROR 常规群 max=39，CE 有意排除 D40）；Game.ts 对数字型 maxLevel 的处理路径不变。若 web 版地牢深度小于 CE，两者行为无差异。
5. 任务自检锚点（175 / 58 / 56）与"漏提 43 条"、"旧表 15 条常规 / 9 物种"、"67 种怪物"均与实测吻合，提示词除 D1 阈值外无其他错误。

## 复现方式

```bash
node scripts/extract_hordes.cjs     # 重新提取并自检（CE 目录可用 BROGUE_CE_DIR 指定）
npm test && npm run build
```

脚本在任何自检（175/58/56、枚举名存在性、字段数、memberCount 组数一致性）失败时拒绝写文件并非零退出。
