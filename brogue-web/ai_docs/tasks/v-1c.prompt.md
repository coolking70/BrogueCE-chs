# V-1c：机器系统的结构还原（**独占轮，移动 RNG 流，全项目风险最高**）

## 0. 角色与授权反驳条款

你是**开发方**。本任务书由**验收方**撰写，验收方**会写错事实**。
凡引用的 CE 行号/公式/语义都**必须打开 `BrogueCE-master/` 逐字核对**，
冲突时**以 CE 源码为准**，并在 `## 对任务书的反驳` 一节写明。

本项目近十轮里执行方的反驳**多次纠正了验收方的方向性错误**。
本轮验收方**已逐字读过**下列 CE 段落，但**仍可能理解错**——照样核对。

## 1. 本轮性质：最高风险

`BlueprintEngine` 是本项目历史上最脆的区域：
P1-33 曾把关卡**切断**、P1-19/20 曾把物品放进**墙里**、
C-8 刚修完一个会让玩家**困死**的连通性漏洞。

**本轮要在这个区域做结构手术。** 请把"宁可停下申报，也不要猜着改"
作为默认姿态。任何一处你不确定的，**登记，不要硬做**。

## 2. 为什么这四件必须一起做

V-0 勘察 + 验收方补勘察的结论：**它们相互耦合，拆开落地会造出比现状更糟的中间态**。

- **抽签资格过滤**没有**递归**，vestibule / key_guard 类蓝图会**一个都建不起来**
  （现在它们靠顶层抽签建立），关卡直接少掉一整类内容；
- **配额**在 CE 里只管 `BP_REWARD` 抽签，而 web 是**所有类别同池抽**；
  不先做资格过滤就套配额，会把**所有**机器一起砍掉。

## 3. 四件事的 CE 依据（验收方已逐字核对，仍请自验）

### 3.1 抽签资格过滤 —— `blueprintQualifies`（`Architect.c:455-468`）

```c
static boolean blueprintQualifies(short i, unsigned long requiredMachineFlags) {
    if (blueprintCatalog[i].depthRange[0] > rogue.depthLevel
        || blueprintCatalog[i].depthRange[1] < rogue.depthLevel
        || (~(blueprintCatalog[i].flags) & requiredMachineFlags)
        // May NOT have BP_ADOPT_ITEM unless that flag is required:
        || (blueprintCatalog[i].flags & BP_ADOPT_ITEM & ~requiredMachineFlags)
        // May NOT have BP_VESTIBULE unless that flag is required:
        || (blueprintCatalog[i].flags & BP_VESTIBULE & ~requiredMachineFlags)) {
        return false;
    }
    return true;
}
```

要点：`BP_ADOPT_ITEM` / `BP_VESTIBULE` **只有在被显式要求时才可被选中** ——
顶层抽签传 `BP_REWARD`，所以这两类**永远不会被顶层抽中**，只能由递归调用建立。

**web 侧**：`blueprints.json` 已有 `category` 字段
（`vestibule` / `reward` / `key_guard` / `thematic`），但 **V-0 查明它无任何生产消费者**。
本轮开始消费它。**映射关系请自己核对 CE 的 `BP_*` 旗标与 web `category` 的对应**，
对不上的在反驳节说明。

### 3.2 奖励房配额（`Architect.c:1757-1775`）

```c
machineCount = 0;
while (rogue.depthLevel <= gameConst->deepestLevelForMachines
    && (rogue.rewardRoomsGenerated + machineCount) * gameConst->machinesPerLevelSuppressionMultiplier
       + gameConst->machinesPerLevelSuppressionOffset
       < rogue.depthLevel * gameConst->machinesPerLevelIncreaseFactor) {
    machineCount++;                       // "try to build at least one every four levels on average"
}
randomMachineFactor = (rogue.depthLevel <= gameConst->maxLevelForBonusMachines
                       && (rogue.rewardRoomsGenerated + machineCount) == 0 ? 40 : 15);
while (rand_percent(max(randomMachineFactor, 15 * gameConst->machinesPerLevelIncreaseFactor))
       && machineCount < 100) {
    randomMachineFactor = 15;             // 第二次起固定 15
    machineCount++;
}
for (failsafe = 50; machineCount && failsafe; failsafe--) {
    if (buildAMachine(-1, -1, -1, BP_REWARD, NULL, NULL, NULL)) {
        machineCount--;
        rogue.rewardRoomsGenerated++;
    }
}
```

Brogue 变体常量（`GlobalsBrogue.c:1026-1029`，**自验**）：
`machinesPerLevelSuppressionMultiplier = 4`、`machinesPerLevelSuppressionOffset = 2`、
`machinesPerLevelIncreaseFactor = 1`、`maxLevelForBonusMachines = 2`。

⚠️ **`rewardRoomsGenerated` 是跨层全局计数器**（`Rogue.h:2504`
`// to meter the number of reward machines`），开局在 `RogueMain.c:292` 清零。
它在 `rogue` 结构体里 —— 意味着 **web 侧必须进存档快照**，
否则读档后配额会重新开始、机器再次泛滥。**这一条容易漏，请务必落地并写测试。**

**对比 web 现状**：每层 `min(2 + ⌊depth/3⌋, 6)` 台（V-0 实测），
与 CE 的"约每 4 层 1 间"**差一个数量级**。

### 3.3 递归外包 / 领养（`Architect.c:1543-1575`）

父机器的 feature 带 `MF_OUTSOURCE_ITEM_TO_MACHINE` 或 `MF_BUILD_VESTIBULE` 时：

```c
for (i = 10; i > 0; i--) {
    if ((feature->flags & MF_OUTSOURCE_ITEM_TO_MACHINE) && theItem) {
        // 先把待领养物品从地面与背包链上摘下来，避免上一次失败的机器把它留在地上
        removeItemFromChain(theItem, floorItems);
        removeItemFromChain(theItem, packItems);
        theItem->nextItem = NULL;
        success = buildAMachine(-1, -1, -1, BP_ADOPT_ITEM, theItem, p->spawnedItemsSub, p->spawnedMonstersSub);
    } else if (feature->flags & MF_BUILD_VESTIBULE) {
        success = buildAMachine(-1, featX, featY, BP_VESTIBULE, NULL, p->spawnedItemsSub, p->spawnedMonstersSub);
    }
    if (success) {
        // 子机器的产物**上交父机器**，以便父机器失败时一并释放
        …把 spawnedItemsSub / spawnedMonstersSub 并入 spawnedItems / spawnedMonsters…
        break;
    }
}
```

**10 次重试**；全败则走 §3.4 的回滚。
注意那段 CE 注释解释了为什么每次重试都要先摘链：
上一次失败的机器可能已经把该物品留在了地上。

### 3.4 失败回滚（两处：`:1576-1583` 与 `:1676-1687`）

```c
copyMap(p->levelBackup, pmap);                       // 把地图恢复成动手之前
abortItemsAndMonsters(p->spawnedItems, p->spawnedMonsters);   // 释放本机器（含子机器）生成的一切
freeGrid(distanceMap); free(p);
return false;
```

备份在 `:1222` 建立（`copyMap(pmap, p->levelBackup)`），**在动任何东西之前**。

两个触发点：① 递归子机器 10 次全败（`:1578`）；
② 某个 feature 的实例数达不到 `minimumInstanceCount`（`:1682`）。

## 4. 绝对禁止

- **不得修改 `BrogueCE-master/`**（只读参考，D6）。
- **不得实现 `MF_KEY_DISPOSABLE`**（归其后的钥匙轮；它依赖本轮的外包/领养先落地）。
- **不得重写 `blueprints.json` 的内容**（归 V-2）。
  ⚠️ 例外：本轮若必须给蓝图补 `BP_*` 语义的标记字段才能实现资格过滤，
  **只加字段、不改既有内容**，并在报告里逐条列出加了什么。
- 不得为了让测试变绿而放宽断言。
- **不得把坏层塞进任何白名单**（C-8 的教训）。

## 5. RNG 与基线

本轮**必然移动生成期 RNG 流**（机器数量与建造顺序都变）。
`generation_baseline` ✅ **授权重新捕获**（保留并追加 `note` / `capturedAt` / `d`）。

⚠️ **C-8 刚修好的连通性否决必须继续有效**：机器建造会改地形，
本轮改动后**必须复跑 C-8 的广度断言**，确认坏层仍为 0。
若出现坏层，**那是真回归，停下来申报**，不要调整闸门。

## 6. 允许修改的文件

**先按四段 grep 自查**（`project_conventions.md`）。
⚠️ 写清单前**先读 `ai_docs/v_0_survey.md` 的「不确定与缺口」节**与
`ai_docs/v_1b_report.md` 的「遗留与登记」节 ——
验收方已两次因为没读上一轮预告而漏收撞红文件。

**生产代码：**
- `src/engine/Generator/BlueprintEngine.ts`
- `src/engine/Generator/Architect.ts`
- `src/engine/Core/Game.ts`（**仅** `populateLevel` 一带的机器调用与存档快照字段）
- `src/data/blueprints.json`（**仅**补 `BP_*` 语义字段，见 §4）

**测试：**
- `src/test/fixtures/generation_baseline.json` ✅ 授权重捕获
- `src/test/blueprint_center.test.ts`、`src/test/p1_33_machine_chokepoint.test.ts`
- `src/test/p1_37_machine_flag_i18n.test.ts`、`src/test/p1_31_35_placement_snapshot.test.ts`
- `src/test/c_8_connectivity.test.ts`（**仅**在广度断言需要扩样本时；**不得放宽**）
- `src/test/v_1b_alternative.test.ts`（其 P1 前提可能被触动）
- 新建 `src/test/v_1c_machine_structure.test.ts`

**清单外撞红：停下，不要改**，写进 `## 需要追加授权的测试`。

## 7. 测试要求

1. **资格过滤**：`vestibule` / `key_guard` 类蓝图**不会被顶层抽中**，
   只能由递归建立；`reward` 类可以。
2. **配额**：整局（D1-D26）奖励房总数贴合 CE 公式
   （约每 4 层 1 间 + 15% 加成）；给出**改造前/后对比实测**。
3. **跨层计数器进存档**：存档往返后配额**不重置**
   （造一个"读档后继续下楼"的场景钉死它）。
4. **递归与回滚**：构造一个必然失败的子机器场景，断言
   ① 父机器整体回滚、② 地图恢复原状、③ 子机器已生成的物品/怪物被一并清除
   （**不留孤儿**）。
5. **连通性不回归**：复跑 C-8 的广度断言，坏层 = 0。
6. **对抗性测试 ≥ 3 条 + 强制反向验证**：真改坏 → 跑 → **贴真实失败输出**
   → 还原 → `grep -rn "REVERT-ME" src/` = 0。
   建议其一：把回滚里的 `abortItemsAndMonsters` 去掉 → 测试 4③ 必须红（孤儿物品）。

### 7.1 哨兵纪律

新哨兵只许三种形态：① `rng.randomNumbersGenerated` 增量；
② `createHeadlessGame(seed,'test')` 完全隔离合成层（清怪清物后 reseed）；
③ 性质断言。**不许锚定 RNG 流绝对位置。**

## 8. 门禁

`npx vitest run --fileParallelism=false`（**不带文件参数** ——
单 worker 下模块级单例会跨文件泄漏，自定义组合的结果不作数）
**外加 `npm run build`**（不要用 `tsc --noEmit`）。

## 9. 最终回复必须包含

1. `## 对任务书的反驳`
2. `## 四件事逐条落地情况`（含任何 deferral 及理由）
3. `## 纯测量数据`（机器数量/奖励房数量 改造前后对比）
4. `## 改动清单`
5. `## 对抗性测试与反向验证`（含**真实失败输出**）
6. `## 哨兵处置`
7. `## 需要追加授权的测试`
8. `## 门禁结果`（含 C-8 广度断言坏层 = 0 的证据）
9. `## 遗留与登记`（给 V-2 / 钥匙轮的交接）
