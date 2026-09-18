# V-0 勘察报告：库房/蓝图忠实度（纯勘察，零代码）

日期：2026-09-18
性质：只读勘察轮。产出即本报告；`git status` 应只有本文件一个新增项。
参考源码：`BrogueCE-master/src/variants/GlobalsBrogue.c`（蓝图目录 L173–621）、
`BrogueCE-master/src/brogue/Architect.c`（机器构建 L984–1860）、
`BrogueCE-master/src/brogue/Rogue.h`（`machineFeature` L2618、`blueprint` L2657、
旗标 L2580–2665、`machineTypes` L2668）。

---

## 0. 结论摘要（TL;DR）

1. 验收方关于 vestibule/库房分工的初步发现**成立**，且比任务书写的更彻底：
   CE 的锁门门厅（`GlobalsBrogue.c:298`）在机器内**什么都不放**——它生成的是
   KEY/KEY_DOOR，并带 `MF_OUTSOURCE_ITEM_TO_MACHINE` 把钥匙**外包**给本层某处的
   领养机器（BP_ADOPT_ITEM「守卫机器」）去落位；奖励物品只存在于
   BP_REWARD 奖励房里，或是被外包给守卫机器的领养物本身（第二条路径，
   见 §3）。
2. 11 个 web 蓝图**每个都能在 CE 找到主题对应**，没有一个需要判「CE 无对应」；
   但**没有一个复刻了 CE 的结构**：CE 门厅机器不放奖励物（放的是解题工具，
   且放到本层任意处）；CE 守卫机器不放自产物品（只领养）；
   `_random_good_` 的「六选一随机好物」概念在 CE 全源码零命中（已 grep 确认）。
3. `MF_ALTERNATIVE` 已逐行核实（Architect.c:1291–1316）：机器构建**前**一次性
   掷 `rand_range(1, N)` 选出一个替代集成员；`MF_ALTERNATIVE_2` 在 Brogue 蓝图
   目录里**零使用**。web `BlueprintEngine` 完全未实现。
4. 分轮建议：验收方的「V-1 数据 + V-2 结构」两分法**不可行**——web 蓝图表的
   形态（每机一个自产奖励）只有在旧结构下才自洽，掩码必须挂在新结构上。
   建议改为 **V-1a（删直投，纯数据小轮）→ V-1b（引擎补机制）→ V-2（全量数据
   还原）**，理由与细节见 §6。

---

## 1. 对任务书的反驳

逐条核对结果（其余引用行号均已逐字验证无误，不一一列出）：

| # | 任务书说法 | 核对结果 |
|---|---|---|
| 1 | `_random_good_` 在 `Game.ts:885` 起 | **行号不准**：`spawnBlueprintItem` 起于 Game.ts:844，`case '_random_good_'` 在 **Game.ts:911–932**。885 行落在 POTION 分支里。实质无误。 |
| 2 | 「`rng.randRange(0, 5)` 六选一，roll 4 直投附魔卷轴」 | ✓ 属实（Game.ts:913–931：0=魔杖 1=法杖 2=戒指 3=护符 4=附魔卷轴 5=生命药水；roll 5 同样直投 life，任务书只点名了 roll 4）。 |
| 3 | 「11 处引用」 | ✓ 恰好 11 处，与 `blueprints.json` 逐一核对无遗漏。 |
| 4 | 「CE 全源码没有 `_random_good_`」 | ✓ 已 `grep -rn "_random_good_" BrogueCE-master/src/`，零命中。 |
| 5 | §3.2 初步发现（vestibule 生成钥匙、奖励在锁门后另一个机器） | **成立，但需两处细化**，见下。 |
| 6 | CE 用过的类别组合清单 | ✓ 全部核实；另有遗漏：(WAND) 单独出现于 L187（混编图书馆魔杖笼）、(SCROLL\|POTION) 出现于 L286（哨兵圣所杂物）。 |
| 7 | 11 个 web 深度带 | ✓ 全部与 JSON 一致。 |

§3.2 初步发现的两处细化：

- **细化一（锁门守的是"谁"）**：锁门 vestibule 不是独立关卡要素——它是由
  **房间机器**（通常是 BP_REWARD 奖励房，其 feature 表里有一条
  `MF_BUILD_VESTIBULE`，如 L213）在门口**递归**生成的子机器
  （Architect.c:1554：`buildAMachine(-1, featX, featY, BP_VESTIBULE, NULL, …)`）。
  所以完整链条是三台机器：**奖励房（A）→ 锁门门厅（B，A 的门口）→ 守卫机器
  （C，本层另一处，领养 B 外包的钥匙）**。玩家拿 C 里的钥匙开 B 的门进 A。
  任务书说「奖励在锁门后另一个机器里」成立（A 与 B 就是两台机器）。
- **细化二（第二条路径，任务书未提）**：`MT_REWARD_ADOPTED_ITEM`（L233–238，
  "Outsourced item"，BP_REWARD|BP_NO_INTERIOR_FLAG，房间尺寸 {0,0} 即隐形）
  生成的是 runic 武器/护甲/法杖×2/护符（四者 `MF_ALTERNATIVE`），
  直接 `MF_OUTSOURCE_ITEM_TO_MACHINE` 交给守卫机器领养——**这条路径没有
  锁门也没有奖励房**，玩家去解谜房拿的"钥匙"本身就是大奖。
  另 Kennel（L250）/吸血鬼巢（L258）/传奇盟友（L262）也各自用
  MF_OUTSOURCE 发放笼钥匙/传送门钥匙。

---

## 2. CE 蓝图目录总览（对应表的前置事实）

`blueprintCatalog_Brogue[]`（GlobalsBrogue.c:173–621）共 **71 个蓝图**
（下标 0 是空槽），`machineTypes` 枚举（Rogue.h:2668）与目录下标**逐位对齐**
（MT_REWARD_MULTI_LIBRARY=1 ↔ 目录第 1 项，以此类推；已逐项清点核实）。
四类（类名为笔者归纳，CE 无此字段）：

| 类 | 数量 | 顶层产生方式 | 物品特征 |
|---|---|---|---|
| 奖励房（BP_REWARD，下标 1–14） | 14 | 顶层抽签（Architect.c:1770，配额 metering） | 奖励物在此：类别掩码 + `MF_GENERATE_ITEM`，大量 `MF_ALTERNATIVE` |
| 外包奖励（下标 8，MT_REWARD_ADOPTED_ITEM） | （计入上行的 1 个） | 同上 | 生成大奖后 `MF_OUTSOURCE_ITEM_TO_MACHINE` |
| 门厅（BP_VESTIBULE，下标 16–25） | 10 | **只能**作为子机器（`MF_BUILD_VESTIBULE` → Architect.c:1554）；`blueprintQualifies` 在 Architect.c:463 拒绝其被顶层抽中 | 多数无物品；锁门变体发**外包钥匙**；燃烧路障/投掷教程发**解题工具**（`MF_BUILD_ANYWHERE_ON_LEVEL`，放本层任意处） |
| 守卫机器（BP_ADOPT_ITEM，下标 26–57） | 32 | **只能**作为子机器（Architect.c:461 守卫；唯一入口 Architect.c:1552） | **无自产奖励**；个别 `MF_GENERATE_ITEM` 是逃生/解题工具（固定 kind）；领养位靠 `MF_ADOPT_ITEM` |
| 气味机器（下标 58–71，flavor） | 14 | 频率 0，不进抽签；由 `autoGeneratorCatalog`（L150–171）与 horde（Monsters.c:862）驱动 | 个别有掩码物品（神祠 L565） |

顶层配额（Architect.c:1762–1776 + GlobalsBrogue.c:1026–1030）：
`(全局 rewardRoomsGenerated + n)×4 + 2 < depth×1` 才追加配额——**约每 4 层
1 间奖励房**（全局累计，跨层共享计数器）；D1–2 且至今 0 间时 40% 机会、
此后每层 15% 机会追加 1 间；deepestLevelForMachines = 26。

对照 web：`BlueprintEngine.buildMachines`（BlueprintEngine.ts:140）每层尝试
`min(2 + ⌊depth/3⌋, 6)` 台，**全部 20 个蓝图同池抽签**，无资格过滤、无配额、
无全局计数。机器密度比 CE 高一个数量级——这是 `_random_good_` 之外的
第二个发放量放大器（B-4a 的附魔超标背景）。

---

## 3. 对应表（§3.1 核心产出）

通用记法：CE 行号均在 `GlobalsBrogue.c`；「掩码」指 `machineFeature.itemCategory`；
「kind」指 `itemKind`。web 列中「现状」含 Game.ts 消费端行为
（itemSpawns → Game.ts:1264–1289，`_random_good_` → Game.ts:911–932）。

### ① vestibule_locked「Locked Vestibule」 [2,26] freq 12

- **CE 对应**：MT_LOCKED_DOOR_VESTIBULE「Plain locked door, key guarded by an
  adoptive room」，**L298–300**。深度 {1,26}，roomSize {1,1}，freq 100，BP_VESTIBULE。
- **CE 放什么**：恰 1 个 feature——`LOCKED_DOOR` 落在门口 +
  `MF_GENERATE_ITEM` 类别 KEY / kind KEY_DOOR，flags
  `MF_OUTSOURCE_ITEM_TO_MACHINE | MF_KEY_DISPOSABLE | MF_IMPREGNABLE`。
  钥匙**不在本机器落位**（Architect.c:1527–1531 跳过 placeItemAt），
  由 1552 行递归交给 BP_ADOPT_ITEM 机器。**机器内无任何奖励物**。
- **web 现状**：BP_ROOM 机器 + `doorTerrain: LOCKED_DOOR` + 室内
  1×`_random_good_`；钥匙由 needsKey⇔iron_key 配对（Game.ts:1254–1260）
  裸放在本层随机非机器地板上，无守卫。
- **差异**：①CE 门厅零奖励、web 塞 1 件随机好物；②CE 钥匙有专门守卫机器、
  web 钥匙无守卫；③CE 深度 1–26 / web 2–26；④CE 的 roomSize{1,1} 是"门厅"
  口径（机器=门本身），web 的 roomSize[6,20] 是房间口径——**单位语义不同**。

### ② vestibule_flammable「Flammable Barricade」 [3,12] freq 6

- **CE 对应**：MT_FLAMMABLE_BARRICADE_VESTIBULE「Flammable barricade in the
  doorway -- burn the wooden barricade to enter」，**L309–313**。
  深度 {1,6}，roomSize {1,1}，freq 10，BP_VESTIBULE。
- **CE 放什么**：WOODEN_BARRICADE 落门口；WEAPON/INCENDIARY_DART 或
  POTION/POTION_INCINERATION（`MF_ALTERNATIVE` 二选一）——
  **解题工具**，flags `MF_BUILD_ANYWHERE_ON_LEVEL | MF_NOT_IN_HALLWAY`，
  放本层任意处（不进门厅）。无奖励物。
- **web 现状**：GRASS×6–12 `MF_FILL_DOORWAY`（**死旗标**，引擎不认，
  见 §3.0）+ 室内 1×`_random_good_`。
- **差异**：①CE 拦路物是可烧木栅栏，web 是草（GRASS 本就可通行，
  "路障"纯装饰）；②CE 发解题工具放任意处、web 发奖励放屋内；③深度带
  CE 1–6 / web 3–12（CE 此机关只在浅层）。

### ③ vestibule_guardian「Guardian Chamber」 [6,20] freq 7

- **CE 对应**：MT_GUARDIAN_VESTIBULE「Guardian obstacle -- a guardian is in
  the door on a glyph, with other glyphs scattered around.」，**L338–343**。
  深度 {6,26}，roomSize {25,25}，freq 8，BP_VESTIBULE|BP_OPEN_INTERIOR。
- **CE 放什么**：DOOR 落门口 + monsterID MK_GUARDIAN 或 MK_WINGED_GUARDIAN
  （`MF_ALTERNATIVE` 二选一）——守护者**站在门格上**；机关字形散布。
  无锁门、无钥匙、无物品：杀掉或引开守护者即通过。
- **web 现状**：`doorTerrain: LOCKED_DOOR` + 室内 1–2×`_depth_appropriate_` 怪
  + 1×`_random_good_`。
- **差异**：CE 守护者=门本身（无锁），web=锁门+屋里怪+免费奖品；机制完全不同。

### ④ vestibule_pit_traps「Pit Trap Corridor」 [4,15] freq 5

- **CE 对应**：MT_PIT_TRAPS_VESTIBULE「Pit traps -- area outside entrance is
  full of pit traps」，**L327–331**。深度 {1,26}，roomSize {30,60}，freq 8，
  BP_VESTIBULE|BP_OPEN_INTERIOR|BP_NO_INTERIOR_FLAG。
- **CE 放什么**：DOOR 或 SECRET_DOOR 落门口（`MF_ALTERNATIVE`）；
  TRAP_DOOR_HIDDEN×60 `MF_REPEAT_UNTIL_NO_PROGRESS`——陷坑铺在
  **门外区域**（保护房间）。无物品。
- **web 现状**：室内 fire TRAP×3–6 `MF_SCATTER`（死旗标）+ 1×`_random_good_`。
- **差异**：CE 是门外陷坑阵（坠落陷阱）+ 可能暗门；web 是屋内火陷阱 + 奖品。

### ⑤ key_fire_trap「Fire Trap Room」 [5,15] freq 6

- **CE 对应**：MT_KEY_FIRE_TRAP_ROOM「Fire trap room -- key on an altar,
  pools of water, fire traps all over the place.」，**L383–389**。
  深度 {4,26}，roomSize {80,180}，freq 6，
  BP_ROOM|BP_SURROUND_WITH_WALLS|BP_PURGE_LIQUIDS|BP_PURGE_PATHING_BLOCKERS|
  **BP_ADOPT_ITEM**。
- **CE 放什么**：`MF_GENERATE_ITEM` **零条**——ALTAR_INERT + `MF_ADOPT_ITEM`
  （领养位）；FLAMETHROWER_HIDDEN×{40,60}（火焰喷射器阵）；深水池 +
  HORDE_MACHINE_WATER_MONSTER（水怪=灭火活道具）；FOLIAGE。
- **web 现状**：LOCKED_DOOR + GRASS×8–16 + fire TRAP×2–4 + 1×`_random_good_`。
- **差异**：结构错位——CE 守卫房是**领养者**（物品来自外包），web 自产自销；
  机制上也不同（CE 是喷火器+水池灭火的运输谜题，web 是静态草+火陷阱）。

### ⑥ key_flood_trap「Flood Trap」 [4,12] freq 5

- **CE 对应**：MT_KEY_FLOOD_TRAP_ROOM「Flood room -- key on an altar in a room
  with pools of eel-infested waters; take key to flood room with shallow
  water」，**L377–382**。深度 {3,26}，roomSize {80,180}，freq 10，
  BP_ADOPT_ITEM + PURGE_LIQUIDS/PURGE_PATHING_BLOCKERS。
- **CE 放什么**：FLOOR_FLOODABLE 铺底；ALTAR_SWITCH + `MF_ADOPT_ITEM`
  （钥匙即扳机：取钥匙触发灌水）；水怪群；DF_GRASS。`MF_GENERATE_ITEM` 零条。
- **web 现状**：LOCKED_DOOR + WATER_SHALLOW×6–12 + WATER_DEEP×2–4 +
  1×`_random_good_`。
- **差异**：同上——CE 领养制 + 「取钥匙灌水」机关；web 静态水房 + 免费奖品。

### ⑦ key_poison_gas「Poison Gas Chamber」 [5,18] freq 6

- **CE 对应**：MT_KEY_POISON_GAS_TRAP_ROOM「Poison gas -- key on an altar;
  take key to cause a caustic gas vent to appear and the door to be blocked;
  there is a hidden trapdoor or an escape item somewhere inside」，
  **L436–444**。深度 {4,26}，roomSize {35,60}，freq 7，BP_ADOPT_ITEM。
- **CE 放什么**：ALTAR_SWITCH + `MF_ADOPT_ITEM`；毒气喷口；
  **逃生三选一**（`MF_ALTERNATIVE`）：TRAP_DOOR_HIDDEN / SCROLL_TELEPORT /
  POTION_DESCENT（后两者 `MF_GENERATE_ITEM`，固定 kind，非随机好物）；
  隐藏拉杆 + PORTCULLIS_DORMANT 落门口（取钥匙后落闸封门=逃生压力）。
- **web 现状**：LOCKED_DOOR + poison_gas TRAP×3–6 + PRESSURE_PLATE×2–3 +
  1×`_random_good_`。
- **差异**：CE 有「取钥匙→毒气+封门→找逃生口」三件套；web 无逃生结构，
  奖品直放。

### ⑧ key_web_room「Web Room」 [4,14] freq 6

- **CE 对应**：MT_KEY_WEB_CLIMBING_ROOM「Web climbing -- key on an altar,
  room filled with pit, spider at altar to shoot webs, bridge appears when
  you grab the key」，**L413–419**。深度 {7,26}，roomSize {55,90}，freq 10，
  BP_ADOPT_ITEM + PURGE/OPEN/SURROUND。
- **CE 放什么**：ALTAR_SWITCH + monsterID **MK_SPIDER** + `MF_ADOPT_ITEM`
  （蜘蛛守在祭坛上，取钥匙出隐藏桥）；CHASM×120 隐藏桥。
  无 `MF_GENERATE_ITEM`。
- **web 现状**：LOCKED_DOOR + WEB×6–12 + `_spider_`×1–3 + 1×`_random_good_`。
- **差异**：CE 的"网"是chasm+蜘蛛吐网的移动谜题；web 是静态蛛网房+奖品。

### ⑨ key_lava_moat「Lava Moat」 [8,20] freq 4

- **CE 对应（两个变体）**：MT_KEY_LAVA_MOAT_ROOM「Lava moat room」**L420–428**
  （深度 {3,13}，roomSize {75,120}，freq 7，BP_ROOM|BP_ADOPT_ITEM）与
  MT_KEY_LAVA_MOAT_AREA「Lava moat area」**L429–435**（深度 {3,13}，
  roomSize {40,60}，freq 3，BP_ADOPT_ITEM|BP_TREAT_AS_BLOCKING）。
- **CE 放什么**：ALTAR_SWITCH + `MF_ADOPT_ITEM`；LAVA×60 可退却熔岩
  （DF_LAVA_RETRACTABLE——取钥匙熔岩退去）；**解题三选一**
  （`MF_ALTERNATIVE`）：POTION_LEVITATION / POTION_FIRE_IMMUNITY /
  WALL_LEVER_HIDDEN（前两者 `MF_GENERATE_ITEM` 固定 kind，
  `MF_BUILD_ANYWHERE_ON_LEVEL` 放本层任意处）。
- **web 现状**：无门；LAVA×8–20 `MF_RING`（死旗标）围一圈 + 居中
  1–2×`_random_good_`。
- **差异**：CE 是「熔岩护钥匙、拿钥匙熔岩退」+ 场外解题工具；web 是
  「熔岩圈里放奖品」，且 web 玩家可以站圈外等火熄/硬吃伤害拿奖。

### ⑩ key_boss「Boss Chamber」 [10,26] freq 3

- **CE 对应**：MT_KEY_BOSS_ROOM「Boss -- key is held by a boss atop a pile of
  bones in a secret room. A few fungus patches light up the area.」，
  **L549–553**。深度 {5,26}，roomSize {40,100}，freq 18，
  BP_ROOM|BP_ADOPT_ITEM|BP_SURROUND_WITH_WALLS|BP_PURGE_LIQUIDS。
- **CE 放什么**：SECRET_DOOR 落门口（**暗门，不是锁门**）；STATUE_INERT×7 +
  发光菌点缀；领养 feature = HORDE_MACHINE_BOSS +
  `MF_ADOPT_ITEM | MF_MONSTER_TAKE_ITEM | MF_GENERATE_HORDE |
  MF_MONSTER_SLEEPING`——领养物（钥匙或外包大奖）**塞进 boss 怪王手里**
  （Architect.c:1622–1626：机器确认成功后才交接），怪群成员由
  hordeCatalog 决定。无 `MF_GENERATE_ITEM`。
- **web 现状**：LOCKED_DOOR + `_depth_boss_`×1 + `_depth_appropriate_`×2–4 +
  1–2×`_random_good_`。
- **差异**：①CE boss 守的是领养物、web 自产奖品；②CE 入口暗门、web 锁门
  （boss 房配铁钥匙语义完全不同）；③CE 怪群走 horde 系统、web 硬编码
  深度怪+小怪编队。

### ⑪ area_shrine「Shrine」 [4,15] freq 6

- **CE 对应**：MT_SHRINE_AREA「Shrine -- safe haven constructed and abandoned
  by a past adventurer」，**L561–565**。深度 {1,40}，roomSize {15,25}，
  **freq 0——不进蓝图抽签**；由 autoGeneratorCatalog 驱动
  （GlobalsBrogue.c:162：深度 5–26、每层 7%、每层至多 1 座、地基 FLOOR）。
- **CE 放什么**：SACRED_GLYPH 落门口；HAVEN_BEDROLL×1；
  BONES×1 + `MF_GENERATE_ITEM` 掩码 **(POTION|SCROLL|WEAPON|ARMOR|RING)**，
  数量 {1,1}——走 `generateItem(mask, -1)` → `chooseKind` 基表频率加权，
  **enchanting/life 基频 0 永不被抽中**（T-1 已在 web 复刻该口径）。
- **web 现状**：ALTAR×1 + SIGN×1（自创装饰）+ 1×`_random_good_`
  （`MF_ALTAR`）——六选一且 roll 4/5 **直投** enchanting/life。
- **差异**：①掩码：CE 五类普通物品 vs web 六选一保底大奖；②CE 无祭坛无
  告示牌（圣刻+床铺+骸骨）；③CE 不进抽签、全深度、低频 7%/层，web 进抽签
  且深度 4–15。

### §3.0 附：web 引擎已实现 / 未实现的旗标清单

`BlueprintEngine.ts` 实际消费的 feature 旗标只有 7 个：
`MF_GENERATE_ITEM` / `MF_GENERATE_MONSTER` / `MF_NEAR_ORIGIN` / `MF_ALTAR` /
`MF_ALTAR_GROUP` / `MF_MONSTER_IS_ALLY` / `MF_MONSTER_IS_CAGED`。
blueprints.json 里出现的这些是**死旗标**（写入无语义，一律按"随机室内格"
落位）：`MF_SCATTER`、`MF_RING`、`MF_FILL_DOORWAY`、`MF_KEY_DISPOSABLE`
（key_rat_trap 数据里有，引擎与锁具均不读）、`MF_TREAT_AS_BLOCKING`
（无此数据但 CE 侧大量存在，供 V-2 对照）。
蓝图级 `BP_*` flags 同样只有 `BP_PURGE_INTERIOR` 被 applyBlueprint 消费
（BlueprintEngine.ts:422）；`BP_ROOM` / `BP_REWARD` / `BP_NO_INTERIOR_FLAG` /
`doorTerrain` 之外的选址语义（如 BP_TREAT_AS_BLOCKING）无实现。
蓝图 `category` 字段（vestibule/reward/key_guard/thematic）**无任何生产
消费者**（仅 MachineResult 带出后丢弃）。

---

## 4. 结构分工（§3.2）

### CE：三角色机器 + 递归接线

```
顶层（每层）
├─ addMachines()（Architect.c:1730–1778）
│   ├─ D26：MT_AMULET_AREA（护符房）
│   └─ 配额抽签 requiredMachineFlags=BP_REWARD
│       → 只能抽中 BP_REWARD 蓝图（blueprintQualifies 的旗标守卫）
│       → 奖励房 A（BP_ROOM|BP_REWARD）
│           ├─ feature「MF_BUILD_VESTIBULE」（如 L213）
│           │   → 递归 buildAMachine(..., BP_VESTIBULE, 门口)   [Architect.c:1554]
│           │   → 门厅 B：锁门/暗门/栅栏/雕像/守护者…
│           │       └─ 锁门变体（L298）：生成 KEY/KEY_DOOR
│           │           → 递归 buildAMachine(..., BP_ADOPT_ITEM, theItem)
│           │                                          [Architect.c:1552]
│           │           → 守卫机器 C（32 变体之一）：MF_ADOPT_ITEM
│           │             领养钥匙，落在祭坛/笼子/boss 手里
│           └─ 奖励物 = A 自己 feature 表的 MF_GENERATE_ITEM（掩码）
├─ MT_REWARD_ADOPTED_ITEM（L233，隐形奖励机器）
│   └─ 生成 runic 大奖 → MF_OUTSOURCE_ITEM_TO_MACHINE → 守卫机器 C'
│       （此路径无锁门无奖励房：解谜房里的"钥匙"就是大奖）
└─ runAutogenerators() / horde（Monsters.c:862）→ flavor 机器
```

要点：
- **资格守卫**（Architect.c:455–467）：BP_VESTIBULE / BP_ADOPT_ITEM 蓝图
  **不可能**被顶层抽中——只有递归调用传入对应 requiredMachineFlags 时才合格。
- **失败传播**（Architect.c:1535–1573）：子机器 10 次建不成 → 父机器整体
  回滚（copyMap 备份还原 + abortItemsAndMonsters）。
- **领养一次性**（Architect.c:1499–1501）：`adoptiveItem` 交付第一个
  MF_ADOPT_ITEM feature 后即置 NULL。
- **钥匙语义**：kind（KEY_DOOR/KEY_CAGE/KEY_PORTAL）+ keyLocations 记录锁位；
  `MF_KEY_DISPOSABLE` 用后即毁；`MF_SKELETON_KEY` 开本机器全部锁。
- **metering**：全局 `rewardRoomsGenerated` 计数器 + 常量
  （GlobalsBrogue.c:1026–1030：乘 4 偏 2 增 1；D1–2 保底 40%、常规 15%）。

### web：单层平面结构

- 一个抽签：20 个蓝图（不分角色）按 frequency 同池竞争
  （BlueprintEngine.ts:164–179）；无 requiredMachineFlags、无配额、
  无全局计数（每层 `min(2+⌊depth/3⌋, 6)` 台，:140）。
- 每台机器独立成房：`findGateRoom` 割点选址（P1-33 已对齐 CE 的
  BP_ROOM 选址语义）+ `applyBlueprint` 平铺铺 feature。
- 锁⇔钥匙 1:1（Game.ts:1252–1261）：needsKey 机器配一把 iron_key，
  `key.keyLoc=[{loc:门,machine}]`，钥匙落在**随机非机器地板**（无守卫）。
- 物品全部自产：`itemSpawns` → `spawnBlueprintItem`（Game.ts:844–936），
  `_random_good_`/KEY/占位符都在此解析；KEY 类 feature 已被 B-4b 跳过
  （Game.ts:1270）。
- 无递归、无领养、无外包、无失败传播（单机器失败只换下一台尝试）。

### 要对齐需要动的面（V-1/V-2 的 scope 预告）

1. `blueprints.json` 全表按 CE 重写（掩码/数量/房径/频次/旗标逐字对照）；
2. `BlueprintEngine.ts`：抽签资格过滤（BP_REWARD 顶层 only + BP_VESTIBULE/
   BP_ADOPT_ITEM 子机器 only）+ MF_ALTERNATIVE(+_2) + MF_BUILD_VESTIBULE /
   MF_OUTSOURCE_ITEM_TO_MACHINE / MF_ADOPT_ITEM 递归与失败回滚 + metering
   配额 + `MF_BUILD_ANYWHERE_ON_LEVEL`（机器外落位）；
3. `Game.ts`：删除 `_random_good_` case；锁⇔钥匙配对从"needsKey 机器发
   地板钥匙"改为"守卫机器领养落位"；`rewardRoomsGenerated` 全局计数器的
   载体（web 无现成的跨层 run 状态挂点，需定）；
4. 数据缺口：CE 大量地形/DF 载体 web 没有（WOODEN_BARRICADE、ALTAR_SWITCH、
   ALTAR_CAGE_OPEN、PEDESTAL、PORTCULLIS、FLAMETHROWER_HIDDEN、
   FLOOR_FLOODABLE、CHASM_WITH_HIDDEN_BRIDGE…）——按 D2，没有载体的蓝图
   不应"近似模拟"进生成池，应留形待激活（见 §7）。

---

## 5. MF_ALTERNATIVE 的确切语义（§3.3）

**实现位置**：`Architect.c:1291–1316`（`buildAMachine` 内，feature 构建
循环之前）。逐行语义：

1. 两个独立集合：`alternativeFlags[2] = {MF_ALTERNATIVE, MF_ALTERNATIVE_2}`。
2. 对每个集合 j：先把**所有**带该旗标的 feature 标记 `skipFeature=true`；
   若集合非空（totalFreq>0），掷一次 `rand_range(1, totalFreq)`，
   数到第 randIndex 个时 `skipFeature=false` 并 break——即**每集合恰好
   消耗一次 rand_range**（集合为空则一次也不掷）。
3. 时序：**在一切 feature 落位之前**、机器选址成功之后决定。随后正常遍历
   features，被 skip 的直接 continue。选中的替代 feature 按其自身
   `instanceCountRange` 构建全部实例（如宝药/卷轴房 POTION×{5,7}）。
4. 语义是"**几个 feature 条目中选一条**"，不是"一条 feature 几种物品"。
   例：基座大奖（L218–219）是两条 feature（SCROLL/SCROLL_ENCHANTING 与
   POTION/POTION_LIFE）各 {1,1}、同带 MF_ALTERNATIVE → 二选一。
5. `MF_ALTERNATIVE_2`：**Brogue 蓝图目录零使用**（grep 无命中）——
   它是引擎能力而非数据需求；V-1 实现时两者同做成本相同，建议都做
   （忠实 + 防 Bullet/Rapid 变体数据日后回迁踩坑）。
6. RNG 记账：对带替代集合的机器，在特征循环前**多消耗
   `rand_range(1, N)` 一次**——V-2 落地时这条会移动生成期 RNG 流，
   基线必须重捕获。

**web 现状**：`BlueprintEngine` **未实现**——features 顺序全建、无 skip
机制（applyBlueprint 的 feature 循环，BlueprintEngine.ts:461–532）。
当前 web 数据里也没有任何替代集合，故暂无正确性症状；但 V-1b 一旦引入
CE 掩码数据（大量带 MF_ALTERNATIVE），不实现它就会**双份发放**
（例如基座同时躺附魔卷轴和生命药水）。

---

## 6. 分轮建议（§3.4）

**验收方"V-1 数据/掩码 + V-2 结构"的两分法不可行**，理由：
web 蓝图表的形态是围绕"每机一个自产奖励"设计的；CE 的类别掩码大多挂在新
结构上才有意义——守卫机器的 `MF_GENERATE_ITEM` 是**解题工具**（固定 kind、
`MF_BUILD_ANYWHERE_ON_LEVEL`），奖励房的掩码依赖 metering 配额与替代集合。
若 V-1 只把 `_random_good_` 换成掩码而不动结构，会得到"每个守卫房里躺一把
随机武器+每层 2–6 台机器"的怪胎，发放量依旧远超 CE，且不是 CE 的任何一种
机器。**数据与结构必须同轮，或第一步先做减法。**

建议三轮，每轮独立可验收、RNG 位移口径明确：

### V-1a：拆直投（纯数据小轮，立竿见影）

- 范围：`blueprints.json` + `Game.ts` 的 `_random_good_` case（911–932）。
- 内容：删除 `_random_good_` 及其 11 处 JSON 引用；受影响蓝图**先删室内
  奖励 feature**（CE 门厅/守卫机器本来就不放自产奖励——这不是功能缺失，
  是 CE 形态：守卫房的产出是"钥匙/大奖领养位"，在 V-1b 前先让它变成纯
  机关房）；area_shrine 掩码改 `(POTION|SCROLL|WEAPON|ARMOR|RING)`
  （T-1 的 chooseKind 加权路径零代码直接可用）。
- 效果：附魔卷轴/生命药水直投渠道消失（B-4a 超标主因斩断）；
  机器密度与发放结构不动（留给 V-1b）。
- RNG 位移：**有**（每机器少掷 `randRange(0,5)` 及后续类别骰；物品总数变）。
  独占一轮；重建 `generation_baseline`；交互期不受影响（全部在生成期）。
- 留痕授权预告（按常识第四段 grep 规矩，V-1a 任务书必须提前列入允许修改）：
  `b_4a_item_generation.test.ts`（144 行点名 `_random_good_`）、
  `t_1_tail.test.ts`（135 行同）、`p1_20_item_placement.test.ts`
  （8/12 行以 `_random_good_`/KEY feature 为载体）、
  `blueprint_center.test.ts`、`p1_33_machine_chokepoint.test.ts`、
  `p1_37_machine_flag_i18n.test.ts`（机器 i18n 载体可能借用蓝图数据）。
- 风险：低。不动 BlueprintEngine 语义。

### V-1b：引擎补机制（动最脆区域，单独一轮）

- 范围：`BlueprintEngine.ts` + `Game.ts` 消费端。
- 内容（按依赖序）：
  1. `MF_ALTERNATIVE`/`MF_ALTERNATIVE_2`（Architect.c:1291–1316 直译，
     特征循环前掷骰）；
  2. `selectBlueprint` 资格过滤（blueprintQualifies 等价：
     requiredMachineFlags + BP_VESTIBULE/BP_ADOPT_ITEM 禁顶层）；
  3. 顶层只抽 BP_REWARD + addMachines 配额（全局 `rewardRoomsGenerated`
     计数器需定载体——web 无现成跨层状态，建议挂 run 级单例）；
  4. `MF_BUILD_VESTIBULE` / `MF_OUTSOURCE_ITEM_TO_MACHINE` / `MF_ADOPT_ITEM`
     递归 + 子机器失败回滚（10 次 failsafe + spawnedItems/Monsters 缓冲区
     语义）；
  5. 锁⇔钥匙改造：铁钥匙从"随机地板"改为"守卫机器领养落位"
     （CE 钥匙 kind 维度 web 缺失，见 §7 缺口 1）。
- RNG 位移：**大**（抽签结构、递归顺序全变）。独占一轮，重捕获基线；
  P1-33/P1-19/P1-20 的全部对抗测试必须全程绿，另加
  "子机器失败不撕层"“领养物恰一件”的对抗用例。
- 风险：高——这就是任务书说的"本项目历史上最脆的区域"。
  建议 V-1b 只做 1–3，把递归(4–5)拆成 V-1c；两轮各自带基线。
  （是否再拆由验收方裁量：4–5 的回滚语义是 CE 忠实度的硬要求，
  但也是最容易把 P1-33 的割点成果撕掉的步骤。）

### V-2：数据全量还原（纯数据轮，前提=V-1b 机制齐）

- 范围：`blueprints.json` 按 CE 全表重写（71 蓝图的 Brogue 子集；
  flavor 机器按 autoGenerator 口径另立驱动或留形）。
- 内容：每蓝图掩码/数量/房径/频次/旗标逐字对照
  `GlobalsBrogue.c:183–620`；替代集合、解题工具（固定 kind +
  BUILD_ANYWHERE）、外包链全部照抄。
- 依赖：V-1b 全部机制；载体缺口（WOODEN_BARRICADE 等十余种地形/DF）
  按 D2 处理——**没有载体的蓝图不近似模拟**，从生成池移除并留形待激活
  （D2 是"保留代码但移出生成池"，本条同理适用于蓝图整条目）。
- RNG 位移：有（池大小/频次全变）。
- 风险：中（数据轮，但表驱动一切，验收面大）。

### 顺序理由

V-1a 先行的价值：**即使 V-1b/V-2 延期，游戏也立即停止发放 CE 不存在的
"每房保底附魔卷轴/生命药水"**——这是 B-4a 实测超标的主因，且改动面最小、
最容易验收。先 V-1b 后 V-1a 则在过渡期里 `_random_good_` 与新机制叠加，
归因会变难。

---

## 7. 不确定与缺口

1. **钥匙 kind 维度**：CE 钥匙按 kind（KEY_DOOR/KEY_CAGE/KEY_PORTAL，
   Rogue.h:779–781）区分开什么锁，web 只有单一 `iron_key` id +
   `keyLoc{loc,machine}` 二元组（Game.ts:195）。V-1b 第 5 步前需补一份
   web 锁具消费端（keyMatchesLocation 等价处）的勘察，本轮未展开。
2. **`rewardRoomsGenerated` 载体**：CE 是 rogue 全局结构体字段；
   web 引擎无跨层 run 状态挂点（`resetMachineCounter` 是每层调用的），
   V-1b 需先定载体再实现配额。
3. **`MF_BUILD_ANYWHERE_ON_LEVEL` 的落位判据**：CE 在 feature 候选集构建处
   （Architect.c ~1429–1445 一带）处理，本轮**未逐行核对**其排除集
   （哪些地形不可放、是否回避其他机器）。V-1b 实现该项前需补读。
4. **legacy trapVaults / cages**：Game.ts:1192–1241 仍有两套 web 自创的
   发钥匙+发宝藏循环（每保险库 40% 戒指/护符 else 生命药水；每笼一把铁钥匙）。
   它们与蓝图系统平行，属于另一个 D2 议题；本轮只登记，未计入 11 处。
   若 V-1a 只拆 `_random_good_`，这两个循环里的 `potion_of_life` 直投仍在
   ——**超标归因时注意分流**。
5. **HORDE_MACHINE_BOSS 的怪群内容**：CE boss 房的怪由 hordeCatalog 决定，
   与 web `_depth_boss_`（按 HP 排序取最强）的对应关系属于 horde 系统线，
   本轮未展开。
6. **CE blueprintQualifies 对 BP_REWARD 无对称守卫**：461/463 行只守卫
   BP_ADOPT_ITEM 与 BP_VESTIBULE 不得在未要求时出现；BP_REWARD 蓝图
   理论上可被其它 requiredMachineFlags 的抽签抽中（实际调用点只有
   requiredMachineFlags=BP_REWARD 与 0 两种，0 时 reward 蓝图也合格——
   但 requiredMachineFlags=0 的顶层调用只有 Bulletml 兵器房/D26 护符房
   这类指定 bp 的调用，不产生歧义）。V-1b 照抄该判定即可，不必自行"加固"。
7. **Brogue CE 变体差异**：本报告只对齐 `blueprintCatalog_Brogue`；
   `GlobalsBulletBrogue.c` / `GlobalsRapidBrogue.c` 有自己的目录
   （含 MT_REWARD_HEAVY_OR_RUNIC_WEAPON），web 不需要关心。

---

## 8. 自查

- 本轮零代码改动：未修改任何生产代码、测试、数据文件；
  `BrogueCE-master/` 只读未动。
- 勘察方法记录：CE 侧逐行读了 `blueprintCatalog_Brogue` 全表
  （GlobalsBrogue.c:173–621）、`machineTypes`/旗标/结构体
  （Rogue.h:2580–2752）、`buildAMachine` 的替代集/物品生成/外包/领养/
  失败回滚段（Architect.c:984–1660）、`addMachines`/`runAutogenerators`
  （Architect.c:1730–1860）、`blueprintQualifies`（Architect.c:455–467）；
  web 侧逐行读了 `BlueprintEngine.ts` 全文、`Game.ts` 840–970 与
  1170–1290、`blueprints.json` 全文。
- 引用行号复核方式：所有 CE 行号来自本次会话的 `sed -n` / Read 原文输出，
  非凭记忆转写；11 个 web 深度带与 JSON 逐项比对一致。
- 门禁：本任务书 §6 未要求 test/build 尾部（零代码轮，无可验证改动）；
  `git status` 证据见最终回复「自查」节。
