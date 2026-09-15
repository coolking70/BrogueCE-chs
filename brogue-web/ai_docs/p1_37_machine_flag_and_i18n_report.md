# P1-37 交付报告：机器旗标取代 CHARRED_FLOOR 冒充 + 硬编码英文接入 i18n

> 轮次：P1-37（worktree `round/p1-37`，与并行轮次隔离；无任何 git 写操作）
> 日期：2026-09-16
> 授权反驳条款有效：本报告所有 CE 行号均经本轮实测核对，与任务书不符之处见 §7。

---

## 0. 结论速览

| 事项 | 结果 |
|---|---|
| 宝库地板改判 CHARRED_FLOOR（每层 ~54 格假焦土） | **已废除**；390 层 CHARRED_FLOOR 格数 **20935 → 0** |
| 坏层（15 种子 × D1-D26） | **0 → 0**（硬闸门保持） |
| 机器旗标 | `cell.machineNumber ≠ 0`（方案理由见 §1） |
| 旗标穿存档往返 | **已实现**（P1-35 同一不变式的第五处，读档从网格重建 `machineCells`） |
| 硬编码英文 | 登记的 6 条 + **实测另发现 2 条漏网**，共 8 条全部接入 i18n |
| B-1 登记的"猛烈突刺"专用措辞 | **已补**（CE Combat.c:1298-1299 确有此文案） |
| 扫描器增强 | **已做**（`findHardcodedLogStrings`，英文硬编码红灯 + 中文清单留痕） |
| RNG 流 | 楼梯位置指纹 **389/390 层逐条不变**；424242/D26 一层位移，归因与论证见 §4 |
| 预期内红灯 | p1_33 结构合同（留痕断言，需验收方反转）、generation_baseline（100 处 fp + 1 层内容）、armor_model_effect（并跑超时假红，单跑绿） |
| 门禁 | `npm test` 609/625 过（3 失败 = 上表）；`npm run build` 绿 |

---

## 1. 旗标方案与理由

### 1.1 选择：`cell.machineNumber ≠ 0` 即旗标，不新增字段

任务书给了两个方向（cell 布尔位 / 独立机器掩码图），实测代码后选择了第三条路：
**Cell 上已有 `machineNumber` 字段（Grid.ts:88，P1-31 引入），且已被四处按
`≠ 0` 当作 IS_IN_MACHINE 使用**：

- `BlueprintEngine` 选址三处（findGateRoom 候选门、findSuitableRoom、floodFillRoom）
- `LoopMap.analyzeChokeMap` 的 `isMachineCell` 默认实现（LoopMap.ts:470）
- `LakeSystem` 两处（createWreath 镶边排除、isSecretTerrain 联合判断）
- `Game.findTerrainSpawnLocation`（Monsters.c:3822 路径，Game.ts 注释 "CE IS_IN_MACHINE"）

CE 本身就是**双轨**：pmap 既有 `machineNumber`（Rogue.h:1318）又有
`IS_IN_MACHINE` 旗标（Rogue.h:1113，`= IS_IN_ROOM_MACHINE | IS_IN_AREA_MACHINE`）。
web 的 machineNumber 恰好写在同一类格子上（BlueprintEngine.applyBlueprint 第 1 步，
机器房全部 room.cells）。再引入一个并行布尔位只会制造**两个可漂移的事实来源**
（写 machineNumber 忘写布尔位 = 楼梯回避但 chokeMap 不排除，反之亦然）。
故本轮不新增任何字段，`machineNumber ≠ 0` 即 IS_IN_MACHINE 等价物，
本报告与代码注释统一用它指代。

### 1.2 CE 行号对照（全部实测）

| CE 位置 | 语义 | web 对应（本轮落地） |
|---|---|---|
| Rogue.h:1113 | `IS_IN_MACHINE = IS_IN_ROOM_MACHINE \| IS_IN_AREA_MACHINE` | `cell.machineNumber !== 0` |
| Architect.c:3712 / 3738 | placeStairs 的 down/up 落点 forbiddenFlags 含 IS_IN_MACHINE | `populateLevel` 牌堆收集时排除机器格（楼梯/护符/钥匙/随机物品/怪群领袖全出自同一牌堆，一处排除全覆盖） |
| Architect.c:3597 | restoreItems 落点回避 IS_IN_MACHINE | 同上（随机物品 pop 自同一牌堆） |
| Architect.c:3543 | spawnHorde 落点回避 IS_IN_MACHINE | 同上 + `spawnHordeAt` 成员铺开的环形搜索排除机器格（Monsters.c:809-819 → getQualifyingLocNear） |
| Monsters.c:1110 | getRandomMonsterSpawnLocation **回退池**才排 IS_IN_MACHINE（远格池不排） | `findPeriodicSpawnLocation`：仅 `near` 池排除机器格，`far` 池不排（两段式照搬） |
| Architect.c:1697 | 机器废弃时清 IS_IN_MACHINE | web 无机器废弃路径，不适用（登记，未实现） |

### 1.3 改动清单

- **BlueprintEngine.ts**：删除 applyBlueprint 第 5 步的"机器内部裸 FLOOR →
  CHARRED_FLOOR"改判循环（保留 machineNumber 写入，第 1 步原样）；注释更新；
  gateSealsOnlyInterior 的"炭化地板可走"过时措辞改为"普通地板可走"。
- **Game.ts populateLevel**：floorTiles 牌堆收集加 `machineNumber !== 0` 排除。
- **Game.ts spawnHordeAt**：成员环形搜索加 `machineNumber === 0` 条件。
- **Game.ts findPeriodicSpawnLocation**：`near` 池排除机器格（`far` 池照 CE 不排）。
- **Game.ts 存档往返**：见 §3。
- **Gas.ts：零改动**。宝库地板恢复 FLOOR 后，长草机制的
  `terrain === CHARRED_FLOOR` 判定天然不再作用于宝库，无需按旗标加排除
  （AD4 用例证明机制仍活着且不碰机器格）。

---

## 2. 修复前后实测对比（15 种子 × D1-D26 = 390 层，同口径脚本）

| 指标 | 修复前 | 修复后 |
|---|---|---|
| CHARRED_FLOOR 总格数 | **20935** | **0** |
| 平均每层假焦土 | 53.68 格 | 0 格 |
| 出现焦土的层数 | 373 / 390 | 0 / 390 |
| 坏层（下楼梯不可达） | 0 | **0** |
| 楼梯位置指纹（390 条） | — | 389 条逐条一致；424242/D26 一条位移（§4） |

任务书预期"从每层 ~56 格降到只有真的被烧过的格"：生成期**没有任何机制
产生真焦土**（火焰只发生在玩法期：火焰陷阱、祭坛碎裂、燃烧蔓延），
所以修复后生成层焦土是严格的 0，比"只剩真烧过的"更干净——玩家走进宝库
看到的就是普通地面，"烧焦的地面"描述（Game.ts terrain 描述分支）与长草
机制从此只作用于真正的燃烧残迹。

---

## 3. 存档往返核查（P1-35 不变式的第五处）

P1-35 给 loopMap / waypoint / 气味图补了读档面；本轮新增的机器旗标是同一
不变式的第五处，**已实现穿透**，没有登记为"不穿"：

- `GameSnapshot.grid[]` 新增可选字段 `machineNumber?`（toSnapshot 只在 ≠0 时
  写出，绝大多数格子无机器，控制体积；旧存档无字段 → 读入为 0）。
- `loadSnapshot` 逐格恢复 `cell.machineNumber`，并**从网格重建
  `machineCells`**——顺手闭环了 P1-35 报告里"机器格读档后为空集、落位检查
  退化为不查机器"的登记项（Game.ts 原注释同步更新）。
- AD3 用例四段断言：快照含旗标 / 读档后 cell 旗标在 / `machineCells` 重建
  （数量 = 该层全部机器内部格数）/ 旧存档（删字段）读入为无机器且不抛。

---

## 4. RNG 流说明（§四 约定的强制披露）

**机制分析**：牌堆排除本身**零流移动**——旧世界机器格是 CHARRED（不在
`terrain === FLOOR` 牌堆），新世界机器格是 FLOOR+旗标（被旗标排除），
两个世界牌堆逐格相等、shuffle 与后续抽取完全一致。楼梯指纹 389/390 层
逐字节一致即为实证。

**唯一的例外**：`spawnHordeAt` 成员铺开排除（CE Monsters.c:809-819 语义）
会罕见地改变 RNG **值序**（不是抽数）：旧世界成员可落进机器格
（CHARRED 可通行），splice 在牌堆里找不到该格、无操作；新世界成员跳过
机器格、落在普通格上，`floorTiles.splice` 多删一格 → 后续
`randRange(0, floorTiles.length - 1)` 上界变化 → 该层后续抽取值 diverge
（抽数不变）。实测 424242 全种子 walk 的分歧点在 D25 后段/D26 前段，
**只有 424242/D26 一层**的楼梯位移（44,19 → 47,21）及其怪物数
（26→33）、物种、物品数（21→19）变化；隔离实验（分别撤除成员排除/
牌堆排除/旧转换）证实归因唯一。

**取舍**：按 D1（一律按 CE）保留成员排除——CE 的怪群成员本来就不允许
被放进机器（否则会被锁死在密库里永远打不到/打不到人）。generation_baseline
因此红 103 处：100 处 fp（宝库地形恢复，纯预期）+ 424242/D26 一层的
n/species/items（本节机制）。**未刷新基线**（任务书禁改），交验收方重采。

---

## 5. 六条（实为八条）硬编码英文清单与译文

任务书登记 `Game.ts:3510-3594`，实际已漂移至 3707-3798 区间，共 6 条；
另实测发现 2 条同病漏网（5612、6541），一并接入。**8 条全部改造**：

| # | 位置（改前） | 原文 | 键 | zh_CN 译文 |
|---|---|---|---|---|
| 1 | rechargeArcanaItem | `${name} is already fully charged.` | `item.already_charged` | {{name}}的充能已经满了。 |
| 2 | rechargeArcanaItem | `${name} is fully recharged.` | `item.fully_recharged` | {{name}}的充能完全恢复了。 |
| 3 | uncurseItem | `${name} is not cursed.` | `item.not_cursed` | {{name}}没有被诅咒。 |
| 4 | removeCurseFromInventory | `${name} is no longer cursed.` | `item.uncursed` | {{name}}不再受诅咒了。 |
| 5 | enchantEquippedItem | `${name} awakens a ${runic} rune!` | `item.runic_awakened` | {{name}}觉醒了一枚{{runic}}符文！ |
| 6 | rechargeRandomArcana | `${name} crackles with restored power.` | `item.power_restored` | 力量重新涌入{{name}}。 |
| 7 | tickArcanaResources（漏网） | `${name} regains a charge.` | `item.regains_charge` | {{name}}恢复了一点充能。 |
| 8 | 自动寻路（漏网） | `Path blocked.` | `move.path_blocked` | 此路不通。 |

译文风格对齐既有条目（简洁、口语、中文标点、`{{}}` 插值变量名保留）。
P1-30 红灯测试全绿（含"无死键"检查——9 个新键全部被代码引用）。

**已知呈现缺口（既有，本轮只登记不修）**：`{{runic}}` 插值的是符文内部 id
（如 `paralyzing`），符文 id 尚无中文映射——与物品名显示 `{paralyzing}`
（Item.ts:106）同病，属于独立的翻译清单工作，不在"六条英文接 i18n"范围。

**中文硬编码 3 条（未动，已钉住）**：`测试模式：`（2048，测试模式专用）、
`重置踏板触发：`（6216）、`告示牌：`（6227）。这三条是中文、当前语种玩家
可正常阅读，改造它们超出"六条英文"的任务边界；扫描器门把它们登记为
`KNOWN_CJK` 清单（超出一律红，注释写明"转化后请收缩清单"）。

### 5.1 B-1 登记项：猛烈突刺

CE 确有此文案：Combat.c:1298-1299，lungeAttack 命中时
`explicationClause = " with a vicious lunge attack"` /
`chineseExplication = "（猛烈突刺）"`。B-1 当时因 zh_CN.json 在文件边界外
无法补键而登记。本轮补齐：

- `resolvePlayerMeleeAttackOn` 命中分支改为三分：`res.backstab` →
  `combat.backstab`；`lungeAttack` → **`combat.lunge_hit`**（"你猛烈突刺了
  {{monster}}，造成 {{damage}} 点伤害！"，对齐 backstab 句式）；否则普通
  `combat.hit`。
- AD5b 用例：突进命中出现"猛烈突刺"、普通近战不出现（背刺/游荡目标会抢
  分支，测试目标显式置 HUNTING，对应 CE 突进对象是清醒怪的事实）。
- 击杀动词差异（CE 中文 UI 对突进击杀用"消灭了"、web 的 `combat.defeat`
  恒为"击败了"）**未实现**：web 对背刺击杀也从未区分，单独给突进加击杀
  动词会与背刺的既有呈现不一致；登记为呈现缺口，不在本轮口径内。

### 5.2 扫描器增强（已做，成本可控）

`i18n_scan.ts` 新增 `findHardcodedLogStrings(srcDir)`：

- 复用既有词法器（把 `findCallSites` 泛化为 `findCallStarts(code, callee, firstChars)`，
  t() 扫描行为逐字节不变），在**代码态**识别 `logger.log(` 调用点（跳过
  注释/字符串/模板/正则），首参为裸字符串字面量或模板时提取静态文本
  （模板取拼接后的静态段，纯插值模板跳过）。
- 分类：静态文本含 ASCII 字母 = **英文硬编码**（玩家可见语言缺陷，红灯）；
  纯 CJK = 中文硬编码（登记清单，见 §5）。
- 误报评估：全仓非测试代码 `logger.log` 裸字符串共 11 处（全部 Game.ts），
  其中 8 条英文本轮已改造，3 条中文进清单——**不存在误报压力**，
  故按任务书"成本可控则做"执行。
- 盲区登记：只覆盖 `logger.log` 首参；`temporaryMessage`、漂浮文字、
  UI 直写文案不覆盖（后者多数已走 `$t()`，由 P1-30 闸门管辖）。

---

## 6. 对抗性测试与反向验证

新增 `src/test/p1_37_machine_flag_i18n.test.ts`（8 用例全绿）：

| 用例 | 对抗的错误实现 | 结果 |
|---|---|---|
| AD1 | 牌堆不排机器格（楼梯/护符/牌堆钥匙/随机物品/怪群落进宝库）——5 种子 × D1-D26 逐层逐格 | 绿；曾真实抓到 key_guard 蓝图内置钥匙（§6.1 口径修正） |
| AD2 | 宝库地板仍是 CHARRED_FLOOR（改判回退） | 绿 |
| AD3 | machineNumber 不穿存档 / machineCells 不重建 / 旧存档不兼容 | 绿 |
| AD4 | 焦土长草作用机器格 / 长草机制整体空转（1976 格焦土 150 回合 ≥1 复绿兜底） | 绿 |
| AD5a | 任一充能/解咒/回复文案以英文渲染（真实 zh_CN 资源实跑，断言无 ASCII 字母） | 绿 |
| AD5b | 突进命中不带"猛烈突刺"/ 普通近战误带 | 绿 |
| AD5c | 觉醒符文文案不走 i18n | 绿 |
| 扫描器门 | 裸字符串英文硬编码复活 / 清单外中文硬编码混入 | 绿 |

测试文件自身迭代中真实抓到过两个 bug（既是对抗性的证据）：AD3 首版拿
"单台机器格数"比对"全部机器格"（该层有多台机器，33≠14）；AD1 首版把
key_guard 蓝图**按数据设计**布在机器内部的一次性钥匙误判为牌堆泄漏
（blueprints.json `key_rat_trap` 等的 `MF_KEY_DISPOSABLE` 特征）——口径修正
为"非机器布点的钥匙不得落机器格"，门钥匙本身（牌堆抽取）的排除仍被
严格钉住。

### 反向验证（真实改坏、真实失败输出、已还原）

**RV1（改坏 BlueprintEngine：加回 CHARRED 改判）→ AD2 翻红**：

```
FAIL src/test/p1_37_machine_flag_i18n.test.ts > ... > AD2: 生成层不含任何
CHARRED_FLOOR——宝库地板已恢复普通 FLOOR（改判转换回退即红）
AssertionError: 生成层仍出现 CHARRED_FLOOR（宝库地板改判被回退？）
seed424242/D2: 22 格
seed424242/D3: 19 格
seed424242/D4: 41 格
seed424242/D5: 51 格
seed424242/D6: 88 格
...
```
（还原后 AD2 复绿。）

**RV2（改坏 Game.ts：`move.path_blocked` 退回裸英文）→ 扫描器门翻红**：

```
FAIL src/test/p1_37_machine_flag_i18n.test.ts > ... > 扫描器门：全仓
logger.log 裸字符串零英文；中文硬编码钉死在既有清单
AssertionError: logger.log 首参出现英文硬编码 1 处（玩家会看到英文）：
  engine/Core/Game.ts:6579  "Path blocked.": expected [ …(5) ] to deeply equal []
```
（还原后复绿；同时 `move.path_blocked` 键变为无引用，P1-30 的死键门
也会红——双保险。）

---

## 7. 与预设不符之处（只列不修）

1. **【最重要】p1_33_machine_chokepoint.test.ts 用例 a 的"机器结构合同"
   子断言必然翻红，且任务书没有把它列入允许修改。**
   该断言（"机器内部没有裸 FLOOR"）正是 CHARRED_FLOOR 冒充旗标这件事的
   留痕——任务书必做 #3 要求把宝库地板恢复 FLOOR，与本断言直接矛盾，
   不可能同时满足。这正是项目常识《留痕测试与文件边界》记载的系统性冲突
   的第五次发生（前四次：P1-27/P1-31/B-1/P1-33），且常识明文要求
   "写任务书时必须把该测试文件列入允许修改并写明反转意图"，本轮任务书
   漏了。按惯例（执行方停下申报、验收方补刀），本轮**未改该测试**，
   现状：p1_33 的坏层=无、机器数（1506≥1200）、锁门数（1025≥700）、
   零机器层（17≤40）及 b/c/c2/d/e/f 六个用例全部通过，唯一红的是该
   结构合同子断言，失败消息自证（"密库地板退出楼梯牌堆的转换被回退？"）。
   **建议验收方按 B-1 范式反转**：断言改为"机器内部 FLOOR 格的
   machineNumber 必须 ≠ 0 且楼梯/钥匙牌堆不取它们"（p1_37 AD1/AD2 已提供
   现成断言可移植），测试名改为"P1-33 结构合同已随 P1-37 旗标化反转"，
   注释保留原断言内容。

2. **generation_baseline 变红（103 处）**：100 处 fp 为宝库地形恢复的
   直接结果（任务书预授权"可能变红，不许刷新，如实报告"）；另有
   424242/D26 一层 n/species/items 差异，归因 §4（成员铺开排除的 CE 忠实
   改动移动了该层值序）。**基线需要验收方重采**。

3. **任务书"六条"实为八条**：`tickArcanaResources` 的 "regains a charge"
   与自动寻路的 "Path blocked." 同病且同文件，超出登记清单 2 条；已一并
   接入 i18n（若验收方认为超范围，回退这 2 处即可，但扫描器门会红，
   需同步登记清单——不建议）。

4. **任务书说 Gas.ts"仅在确认需按旗标排除时"修改——实测不需要**：
   长草机制按 terrain 判定，宝库恢复 FLOOR 后天然退出；Gas.ts 零改动，
   AD4 用例双向验证（机器格零变化 + 焦土区确实在复绿）。

5. **任务书引述 Game.ts:3510-3594 已漂移**至 3707-3798（P4 系列在其后
   追加了代码）；B-1 的"猛烈突刺"登记原文在 Game.ts:4795 附近注释中，
   位置无误。

6. **`findPeriodicSpawnLocation` 的 CE 口径修正**：CE 的周期刷怪远格池
   **不**排机器、仅回退池排（Monsters.c:1103-1116 两段式），任务书未提及
   此细节；web 原实现两池都不排，本轮按 CE 补齐为"仅 near 池排"。

---

## 8. 文件边界自查

允许修改清单内：`Game.ts`、`BlueprintEngine.ts`、`zh_CN.json`、
`i18n_scan.ts`、新增测试文件。
**未触碰**：Architect.ts、RoomBuilder.ts、LoopMap/SafetyMap/WaypointMap/
Connectivity、BrogueCE-master/、src/data/、src/test/fixtures/、Random.ts、
vite.config.ts、任何既有测试文件。Gas.ts 未修改（无需）。
临时探针/测量脚本（_p1_37_measure.test.ts、_p1_37_probe.test.ts）用完即删，
工作区无残留。无 git 写操作。

```
git diff --stat：
 brogue-web/src/engine/Core/Game.ts                 | 76 ++++++++++++-----
 brogue-web/src/engine/Generator/BlueprintEngine.ts | 30 +++----
 brogue-web/src/locales/zh_CN.json                  |  9 ++
 brogue-web/src/test/i18n_scan.ts                   | 97 ++++++++++++++++++--
 4 files changed, 167 insertions(+), 45 deletions(-)
 （另有新增 src/test/p1_37_machine_flag_i18n.test.ts）
```

## 9. 门禁输出

见附录 A/B（`npm test` 与 `npm run build` 完整输出尾部）。

### 预期红灯清单（非本轮回归）

| 测试 | 状态 | 定性 |
|---|---|---|
| p1_33 用例 a（结构合同子断言） | 红 | 留痕断言前提失效，§7.1，待验收方反转 |
| generation_baseline | 红 | 100 fp（预期）+ 424242/D26 内容（§4），待验收方重采 |
| armor_model_effect | **超时假红** | 全量并跑时被该文件自带的 180s 超时杀掉（跑了 242s 仍在出数）；**单独重跑通过**（51s，2/2 绿）——任务书预警的"两边抢 CPU 集体假红"实例，非真失败 |
| 其余全部（57 文件 / 609 用例，含 p1_26 / p1_30 / snapshotQuantity / 本轮 8 用例） | 绿 | — |

扫描器死函数清理（TS6133，build 抓到后删除）后已复验 p1_30 + p1_37 两文件
24 用例全绿（该编辑为纯删除、零行为差异）。

---

## 附录 A：`npm test` 输出尾部（2026-09-16 01:23 全量，60 文件）

```
 FAIL  src/test/armor_model_effect.test.ts > 护甲模型改造前后配对对照（5 档 × 20 seed × 400 回合） > 聚合对比：玩家被命中率 / 累计受伤 / 死亡次数
⎯⎯⎯⎯⎯⎯⎯[1/3]⎯
 FAIL  src/test/generation_baseline.test.ts > 滚动生成基线：地图生成无非预期漂移 > 4 seed × D1-D26：地形指纹 / 怪物数 / 物种集合 / 物品数与基线一致
⎯⎯⎯⎯⎯⎯⎯[2/3]⎯
 FAIL  src/test/p1_33_machine_chokepoint.test.ts > P1-33 机器阶段不切断关卡 > a) 端到端复验：15 种子 × D1-D26 零不可达 + 机器非塌缩 + 机器结构合同
⎯⎯⎯⎯⎯⎯⎯[3/3]⎯

Test Files  3 failed | 57 passed (60)
     Tests  3 failed | 609 passed | 8 skipped | 5 todo (625)
Start at  01:23:26
Duration  580.21s
```

三处失败定性见 §9 表格：两处预期内（p1_33 留痕断言、generation_baseline
待重采），一处超时假红（armor_model_effect，单独重跑绿）。
armor 单独重跑尾部：

```
 Test Files  1 passed (1)
      Tests  2 passed (2)
   Start at  01:43:28
   Duration  51.18s
```

p1_33 全量中的实测行（证明硬指标全过、只红结构合同）：

```
[p1_33] 修复后 15 种子 × D1-D26 = 390 层：坏层=无；机器 1506 台（平均 3.86/层，
零机器层 17），锁门机器 1025 台。修复前基线：1920 台（4.92/层）、坏层 5。
AssertionError: 机器结构合同被破坏：
seed424242/D2 vestibule_locked 内部 (56,3) 仍是 FLOOR（密库地板退出楼梯牌堆的转换被回退？）
...
```

generation_baseline 偏差分类：`100 fp + 1 n + 1 species + 1 items`
（后者全在 424242/D26，见 §4）。

## 附录 B：`npm run build` 输出尾部

```
> brogue-web@0.0.0 build
> vue-tsc -b && vite build

dist/assets/CanvasRenderer-DHhLNFHz.js       22.67 kB │ gzip:   7.08 kB
dist/assets/WebGPURenderer-B0SmeJQg.js       38.19 kB │ gzip:  10.65 kB
dist/assets/browserAll-CeZSSaIo.js           41.30 kB │ gzip:  10.82 kB
dist/assets/RenderTargetSystem-Cch9sua7.js   45.60 kB │ gzip:  12.57 kB
dist/assets/WebGLRenderer-BWnZgUKQ.js        68.42 kB │ gzip:  18.71 kB
dist/assets/index-BpaK7RmC.js               763.03 kB │ gzip: 232.60 kB

(!) Some chunks are larger than 500 kB after minification. Consider: ...
✓ built in 3.85s
```

（vue-tsc 零错误；chunk 体积警告为既有现象。首次 build 曾红于
`i18n_scan.ts(78,10): TS6133 'matchCallStart' is declared but its value is
never read`——本轮重构遗留的死包装函数，删除后复绿。）
