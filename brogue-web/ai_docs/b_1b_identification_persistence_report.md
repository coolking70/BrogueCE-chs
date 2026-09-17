# B-1b 报告：鉴定态持久化 + call 绰号 + identify 目标指定 + 戒指双槽 + 移除免费按钮

> 2026-09-17。执行：ZCode/GLM（round/b-1b 分支，与 C-6 并行）。
> CE 源码以 `BrogueCE-master/src/` 为准（只读）。本轮范围 = B-1a §8「给 B-1b」五条。
> **执行方按任务书 §五§三完成了全部五条；三条门禁异常按下述规矩申报（§0），其中两条经实证与本轮改动无关。**

---

## 0. 申报（置顶）：门禁的三处红与处置

### 0.1 p1_37_machine_flag_i18n.test.ts 与"移除两个免费方法"硬冲突 —— **需要验收方补刀**

**这是项目常识所载"留痕/测试与文件边界冲突"的第 7 起，前 6 起的流程是：执行方停下来申报，验收方补一刀。本轮照此办理。**

- **冲突本体**：任务书 §二.4 与 §六 明令"移除两个免费方法"（`Game.rechargeArcanaItem` / `Game.uncurseItem`，web 自创作弊入口，D2 退出实际游戏）。两段 grep 生成的既有测试允许清单**漏了 `p1_37_machine_flag_i18n.test.ts`**——它的 **AD5a** 用例以这两个方法为**载体**测 i18n 渲染（"充能已经满了"/"充能完全恢复了"/"没有被诅咒"三段）。方法删除后该用例前提失效。
- **冲突是穷尽的**：b_1a_identification.test.ts（在允许清单内）的留痕反转要求 `(game as any).uncurseItem === undefined`；p1_37 要求 `game.rechargeArcanaItem` 是可调用的函数且产出既定文案。**不存在同时让两者为绿的树状态**——保留方法则授权内的留痕反转翻红，删除方法则 p1_37 翻红。
- **为什么不是编译期静默**：`tsconfig.app.json` 含 `src/**/*.ts`，`npm run build`（vue-tsc -b）对 p1_37 报 3 条 TS2339。vitest 本身不查类型，照常跑并在运行时红。
- **本轮动作**：按任务书删除方法（§六 明文授权）；**p1_37 一字未动**；门禁如实呈现红（§7）。

**给验收方的补丁**（应用后 `npm test` / `npm run build` 预期全绿；删的是 AD5a 中以被移除方法为载体的三段，保留仍在线的卷轴解咒/慢充两段——i18n 守卫性质零放宽）：

```diff
--- a/src/test/p1_37_machine_flag_i18n.test.ts
+++ b/src/test/p1_37_machine_flag_i18n.test.ts
@@ -306,34 +306,6 @@
     it('AD5a: 充能/诅咒/解咒文案无英文字母（六条登记项 + 两条漏网项的渲染面）', () => {
         const game = createHeadlessGame(20260916);
 
-        // 满充魔杖再充 → "已经满了"
-        const full = makeWand();
-        let restore = captureLog();
-        game.rechargeArcanaItem(full);
-        restore();
-        const fullMsg = messages.find(m => m.includes('充能已经满了'));
-        expect(fullMsg, `应渲染中文"充能已经满了"，实际日志：${messages.join(' | ')}`).toBeDefined();
-        expect(fullMsg, '硬编码英文仍以英文渲染').not.toMatch(/[A-Za-z]/);
-
-        // 半充魔杖充能 → "完全恢复了"
-        const wand = makeWand();
-        wand.charges = 0;
-        restore = captureLog();
-        game.rechargeArcanaItem(wand);
-        restore();
-        const rechargedMsg = messages.find(m => m.includes('充能完全恢复了'));
-        expect(rechargedMsg, `应渲染中文"充能完全恢复了"，实际日志：${messages.join(' | ')}`).toBeDefined();
-        expect(rechargedMsg).not.toMatch(/[A-Za-z]/);
-
-        // 未诅咒物品解咒 → "没有被诅咒"
-        const clean = ItemLoader.spawnWeapon('dagger', 0, 0)!;
-        restore = captureLog();
-        game.uncurseItem(clean);
-        restore();
-        const notCursedMsg = messages.find(m => m.includes('没有被诅咒'));
-        expect(notCursedMsg, `应渲染中文"没有被诅咒"，实际日志：${messages.join(' | ')}`).toBeDefined();
-        expect(notCursedMsg).not.toMatch(/[A-Za-z]/);
+        // B-1b：免费充能/解咒按钮（rechargeArcanaItem / uncurseItem）已按 D2 移除，
+        // 其三条文案（already_charged / fully_recharged / not_cursed）随之退场——
+        // 这三段的 i18n 渲染断言失去载体，随之删除（原断言见 git 历史）。
+        let restore: () => void;
 
         // 背包解咒 → "不再受诅咒"
```

（补丁仅示意删除三段与 `let restore` 声明位置；"慢充自然回复"与"背包解咒"两段原样保留。同文件顶部的 `makeWand` 仍被慢充段使用，无需动。）

**教训入规矩**（对应常识"写允许修改清单前先 grep 真实路径"）：两段 grep 的关键词除了"本轮要接的东西"（identify/ItemLoader/equippedRing…），**必须再对"本轮要删除的每个公开名字"grep 一遍**（本轮即 `rechargeArcanaItem|uncurseItem`）——删除类改动的受害者是"引用者"，不是"被引用者"。

### 0.2 b_1a_identification A1「诅咒绝不进名字」—— **预存的时间种子脆弱（~10% 假红率），与本轮无关，附一行补丁**

- **实锤**：该用例与 HEAD 逐字节一致（`git show HEAD` 比对）；本用例直接调 `ItemLoader.spawnArmor` 而**不先建局重播种**，spawn 走模块级 `rng` 单例——其构造种子是 `Date.now()`（Random.ts:72）。spawnArmor 的 10% 符文骰因此每轮独立掷：本轮全量恰好掷中，护甲带符文 → displayName 多出 " (unknown runic)" → `expected 'Leather Armor -1 (unknown runic)' to be 'Leather Armor -1'`。
- **主动复现**：单跑该用例 4 次内即翻红（`RUN 4: RED`）；同文件其余用例都显式 `runicType = undefined`，唯独这条漏了——纯测试卫生问题，非行为回归。B-1a 晨间全量绿、本轮 09:01 双文件跑绿、09:01:50 全量红，与此机制完全自洽。
- **给验收方的补丁**（一行，属测试卫生，不触守卫性质；该文件虽在本轮允许清单，但此改动不属于"因本轮行为变化而到期"，故仍申报而非动手）：

```diff
         const armor = ItemLoader.spawnArmor('leather_armor', -1, -1)!;
+        armor.runicType = undefined; // 测试卫生：spawn 的 10% 符文骰走时间种子流（与用例主题无关）
         armor.enchantment = -1;
```

### 0.3 armor_model_effect「聚合对比」超时 —— **并行负载假红，单跑实证绿，无需改代码**

- 全量套件本轮实跑 2381s（B-1a 同机器晨间 1119s，2.1×）——与 C-6 并行执行、两套件同机争用 CPU。armor_model_effect（5 档 × 20 seed × 2 模式 × 400 回合，全库最重的单测）被饿到 302s，撞上其 180s 超时：`Error: Test timed out in 180000ms`。**不是断言失败**。
- **单跑复测（09:45，空载）**：`Test Files 1 passed (1) / Tests 2 passed (2) / Duration 103.16s` ——绿。
- 本轮 diff 在该测试路径上惰性（模拟不戴戒指、不存读档、不读卷轴；唯一相关代码 processIncrementalAutoID 的循环对"无戒指"输入行为不变）。**处置建议**：并行轮的门禁错峰跑；或该用例超时提高（180s → 400s），由验收方裁量，本轮不动（文件不在允许清单）。

---

## 1. 结果速览

- **持久化（P1-48）落地**：快照根级新增 `identifiedItems: string[]`、`callTitles: Record<string,string>`；物品条目新增 `identified / canBeIdentified / maxChargesKnown / timesUsed`。旧存档（无字段）回退 B-1b 前行为（鉴定丢失、实例按 spawn 语义重建），不崩溃。`deserializeItem` 的无条件重建分支已删（仅存于旧档兼容路径）。
- **call 绰号落地**：`ItemLoader.callTitles: Map` + `callKind()`（空文本=清除，CE Items.c:1429-1432）；displayName 五类（药水/卷轴/法杖/魔杖/戒指）三态 **真名 > called > 风味**（CE itemName 分支序）；新局清零（resetItemTableEntry，Items.c:8778-8779）；UI 入口在 InventoryOverlay（仅对五类风味种类且种类未识别开放）。
- **identify 卷轴改玩家指定**：`identifyRandomItem`（随机）删除，换 `beginIdentifySelection()` + `chooseIdentifyTarget()`（CE promptForItemOfType，Items.c:7783-7802）；无可鉴物品时 "already identified" 短路、卷轴照常消耗。
- **免费按钮移除（D2）**：`rechargeArcanaItem` / `uncurseItem` 两方法删除；InventoryOverlay 两按钮及其载体（`isRechargeable/performRecharge/performUncurse`）删除；卷轴等价物（`removeCurseFromInventory` / `rechargeRandomArcana`）原样保留。i18n 三键 +1 键随方法退场（见 §6 偏差申报）。
- **戒指双槽落地**：`Player.equippedRing` → `ringLeft/ringRight`（CE Items.c:8560-8566 左槽优先、双占拒绝）；快照 `ringLeftId/ringRightId`，旧档 `equippedRingId` 迁入左槽；熟悉度倒计时、awareness 抗性、装备状态同步全部遍历双槽。
- **RNG 流零移动**：`generation_baseline` 绿（§7 实跑输出）；另立**构造地图哨兵**（S1，`rng.randomNumbersGenerated` 增量口径，对生成器改动免疫——任务书 §三 的要求）。
- 新增测试 14 条（b_1b 文件）+ b_1a 留痕反转 6 条改写；反向验证 **7 组**（要求 ≥4）真实改坏并还原。
- **三条门禁异常全部归因落定**（§0）：①p1_37 边界冲突（申报+补丁）；②b_1a A1 预存时间种子脆弱（与 HEAD 逐字节一致，单跑 4 次内主动复现，附一行补丁）；③armor_model_effect 并行负载超时假红（单跑 103s 绿）。
- **识别后戒指的 "+N" 显示缺口登记**（§9，非本轮范围，未动手）。

---

## 2. 快照 schema 的新增字段与向后兼容

### 2.1 新增字段（GameSnapshot / GameSnapshotItem）

| 层级 | 字段 | 载体 | CE 对应物 |
|---|---|---|---|
| 根 | `identifiedItems?: string[]` | `ItemLoader.identifiedItems` 的落盘形态 | `itemTable.identified`（Rogue.h:1433） |
| 根 | `callTitles?: Record<string,string>` | `ItemLoader.callTitles`（Map → 普通对象） | `itemTable.callTitle/called`（Rogue.h:1426-1427） |
| 物品 | `identified?: boolean` | `Item.identified` | `ITEM_IDENTIFIED` Fl(0) |
| 物品 | `canBeIdentified?: boolean` | `Item.canBeIdentified` | `ITEM_CAN_BE_IDENTIFIED` Fl(8) |
| 物品 | `maxChargesKnown?: boolean` | `Item.maxChargesKnown` | `ITEM_MAX_CHARGES_KNOWN` Fl(12) |
| 物品 | `timesUsed?: number` | `Item.timesUsed` | `enchant2`（魔杖放电计数） |
| player | `ringLeftId?/ringRightId?: number \| null` | `Player.ringLeft/ringRight` | `rogue.ringLeft/ringRight` |

序列化语义与内存三态一致：`identified: undefined` 的物品（金币/食物/钥匙/护符等无未知态类别）JSON 落盘自然丢键，读档回落"视为已鉴定"。`charges`（武器/护甲/戒指熟悉度计数）**本来就在档内**，B-1a §8 的预测属实，未新增字段。

### 2.2 向后兼容（旧存档怎么办）

`loadSnapshot` 在 `initConsumables()`（清到开局态）之后：

- 根级 `identifiedItems`/`callTitles` **存在** → 清空后逐条回放；
- **不存在**（B-1b 前的存档）→ 停留在开局态 = 护符/护符石预亮、其余全丢——与 B-1b 前"读档鉴定全丢"的实测行为（B-0 §4.5 [ID-SAVE]）**逐位一致**；
- 物品条目 `identified === undefined`（旧档）→ 走原"按 spawn 语义重建"分支（可未知类别置未识别）。该分支从无条件执行收缩为**旧档专用回退**，新档一律走显式字段；
- player `ringLeftId` 不存在而 `equippedRingId` 存在 → **单槽迁入左槽**（`ringLeftId ?? equippedRingId ?? null`）；新档不写 `equippedRingId`（接口上保留该可选字段并注明 deprecated，仅为旧档数据可描述）。

兼容路径由 P3 用例钉死：手工剥离全部新字段 + 改造戒指槽字段后读档，断言不崩溃且回退旧行为。

### 2.3 App.vue 的 localStorage 存档

`App.vue` 走 `JSON.stringify(activeGame.toSnapshot())` / `loadSnapshot`，无 schema 假设，自动获得新字段与兼容路径；B-1b 前保存的旧档读入即回退旧行为（不崩溃、鉴定丢失），符合"旧档不迁移、只不崩"的既有口径（isProtected/layers 同款）。

---

## 3. CE `callTitle` 语义的出处与复核

复核自 `BrogueCE-master/src/brogue/`：

| 语义点 | CE 出处 | web 实现 |
|---|---|---|
| 字段载体：`char callTitle[30]` + `boolean called`，per-**kind**（不是 per-item） | Rogue.h:1426-1427 | `ItemLoader.callTitles: Map<kindId, string>`——**键的有无 ≙ called 布尔**，两者恒等价（CE 置 called=false 时必同时清空 callTitle，见下行） |
| call 只对"种类表存在且种类未识别"开放 | Items.c:1423-1425（`tableForItemCategory(...) && !...identified`） | `Game.callItem` 校验五类风味类别 + 种类未识别；已识别 → `item.already_known`（"you already know what that is."，Items.c:1384/1440 同文） |
| 写入：`strcpy(callTitle, itemText); called = true` | Items.c:1427-1428 | `callKind(kindId, title)` → `Map.set` |
| **空文本 = 清除**：`callTitle[0]='\0'; called = false` | Items.c:1429-1432 | `callKind(kindId, '')` → `Map.delete` |
| 长度 ≤29 | Items.c:1421（`getInputTextString(..., 29, ...)`） | UI `maxlength="29"`（引擎层不设限，CE 的截断在输入层） |
| 显示三态：identified 短路 > called > flavor | Items.c:1558-1584（scroll/potion）、1601-1603（wand）、1641-1643（staff）、1667-1669（ring） | `Item.displayName` 五类各插入 called 分支于 identified 与 flavor 之间；药水/卷轴/法杖/魔杖/戒指格式 `potion called X` 等（zh：称为「X」的药水） |
| 魔杖/法杖的充能/次数详情拼在名根之后（与 called 正交） | Items.c:1632-1653（名根选定后 includeDetails 追加） | WAND/STAFF 分支先定 `root`（called 替换风味），充能标注照旧拼在 root 后 |
| 新局清零 | resetItemTableEntry，Items.c:8778-8779 | `initConsumables()` 内 `callTitles.clear()`（loadSnapshot 先清后回放，两全） |
| **call 对武器/护甲/护符/食物等转题字（inscribeItem）** | Items.c:1373-1381、1387-1397 | **web 无题字功能**：`callItem` 对这些类别返回 false，UI 不出 Call 按钮。**登记**：题字（per-item inscription）整套未实现，见 §10 |

### 3.1 三态顺序的对抗锁定

C1 用例：起绰号 → 断言显示绰号盖过风味 → 种类识别 → 断言**真名短路、绰号必须消失**。反向验证 RV3（called 分支提前）精确翻红：`expected 'potion called red bull' to be 'Potion of Life'`——任务书要求的"called 绰号覆盖了真名"对抗条目由此承担。

---

## 4. identify 卷轴目标指定（CE promptForItemOfType）

CE 流程（Items.c:7774-7802，逐行复核）：

1. `identify(theItem)` 自亮 + 宣告 "this is a scroll of identify."（B-1a 已实装，A10 锁定）；
2. `updateIdentifiableItems()` 整包刷新 `ITEM_CAN_BE_IDENTIFIED`；
3. `numberOfMatchingPackItems(...)==0` → "everything in your pack is already identified."，**卷轴照常消耗**；
4. `do { promptForItemOfType(ALL_ITEMS, ITEM_CAN_BE_IDENTIFIED, ...) } while (未选中合法目标)`——**不可取消**（ESC 返回 NULL 会重新进入提示）；
5. `identify(target)` 实例全亮 + 宣告 "this is a <name>."

web 对应（readItem 'identify_item' case）：

- 步骤 1-3 原样：`beginIdentifySelection()` 先整包 `updateIdentifiableItem`，无候选返回 false → `scroll.identify_fail`（文案本轮回退为 CE 原文语义"你背包里的物品都已经鉴定过了。"），卷轴已消耗；
- 步骤 4-5：`pendingIdentify = true` + 复用背包弹层（InventoryOverlay 显示 "Identify what?" 横幅，只有 `canBeIdentified` 的行可点选）；`chooseIdentifyTarget(item)` 校验（在待选态 / 物品在包内 / 仍可鉴）后 `identifyInstance` 落账；
- **不可取消**对齐：待选期间 `escape`/`toggle_inventory` 被吞（handlePlayerAction 两处门控），其余动作被 `isInventoryOpen || pendingIdentify` 拦截。

**申报一处结构性偏差（异步 UI 的代价）**：CE 的目标选择在读卷轴的**同一回合内同步完成**；web 的弹层是异步的——读卷轴的回合先正常推进（怪物先动），玩家点选后立即落账、**零额外回合成本**（与 CE 的选择成本一致）。风险窗口是"读卷轴到点选之间世界状态可能变化"（如目标被怪捡走——当前无此机制，纯理论）。CE 无对应问题（同步），web 架构（引擎不阻塞 UI）下这是最小偏差，登记备查。

**随机抽取随之消失**：旧 `identifyRandomItem` 的 `rng.randRange` 是背包鉴定路径上唯一的掷骰；改玩家指定后该路径**零掷骰**（S1 哨兵锁定，RV6 反证）。

---

## 5. ★ B-1a「戒指三槽语义已就绪、循环展开即可」预测的验证结论

**结论：预测成立，但有两处它没说的坑，均已绕开。**

- **成立的部分**：`ItemLoader.decrementWornFamiliarity` 确实是**单件纯函数**——无静态状态、无跨调用耦合，armor/ring 两种路径由 `item.category` 自选；CE 侧 `processIncrementalAutoID` 本就是 `autoIdentifyItems[3] = {armor, ringLeft, ringRight}` 的朴素循环（Time.c:1988-1991）。调用方展开成 `[equippedArmor, ...player.rings()]` 一行循环即正确，无需改 ItemLoader。
- **坑一（预测没说的）**：`processIncrementalAutoID` 不是戒指双槽语义的唯一单槽残留——`getPlayerStatusResistance`（awareness 抗性）与 `syncEquipmentStatuses`（awareness/regeneration 光环）也锚在单 `equippedRing` 上。双槽落地后**两枚戒指的效果都必须生效**（CE `updateRingBonuses` 遍历两槽），两处已改为遍历 `player.rings()`。若只按预测展开熟悉度循环、漏掉这两处，戴第二枚 awareness 会静默失效（R1 类错误实现在这两处不会被熟悉度测试抓到——本 round 未为 awareness 双槽单独立对抗用例，登记为测试覆盖缺口，见 §10）。
- **坑二（预测没说的）**：`Player.equip` 的单槽赋值 `this.equippedRing = item` 是"顶掉"语义的源头——CE 语义是**双占拒绝**（Items.c:8560-8566 `return false`），不是循环展开能带出来的。已改为左槽优先/双占拒绝，反转留痕（原断言"第二枚顶掉第一枚"）直接锁定。

---

## 6. i18n

**新增键**（`i18next.t()` 调用点全部语句层、字面量键，扫描器可见；中文按中文语序）：

```
item.already_known        你已经知道那是什么了。          （CE "you already know what that is."）
item.called_as            现在它们是「{{name}}」。        （call 成功后回显新名，CE Items.c:1436-1438）
item.called_potion        称为「{{title}}」的药水
item.called_scroll        称为「{{title}}」的卷轴
item.called_wand          称为「{{title}}」的魔杖
item.called_staff         称为「{{title}}」的法杖
item.called_ring          称为「{{title}}」的戒指
```

**修改键**：`scroll.identify_fail` 文案改为 CE 原文语义（"你背包里的物品都已经鉴定过了。"，原"没有新的物品可以鉴定。"）。

**删除键（⚠️ 与"zh_CN.json 仅增键"的边界冲突，申报）**：`item.already_charged` / `item.fully_recharged` / `item.not_cursed` / `scroll.dark_aura`。这四键的唯一引用点就是本轮明令删除的两个方法（全库 grep 核实）；保留它们 p1_30 门禁的死键检查必红。"仅增键"显然未预见"删方法"的连带后果——**删除是授权内方法移除的最小必然伴随**，且已全库 grep 证实零残留引用。如实申报，请求追认。

UI 层新文案（"Identify what? (choose a highlighted item)" 横幅、Call 按钮、call 输入行）走 InventoryOverlay 既有裸 `t()` 模式——该形态不被 i18n 扫描器覆盖（与 Equip/Quaff 等既有按钮一致，英文回退）。未为新 UI 文案加资源键：加了就是死键（扫描器看不见引用）。

---

## 7. 门禁输出

### 7.1 generation_baseline（硬门禁：RNG 流零移动）——**绿**

```
>npx vitest run src/test/generation_baseline.test.ts（2026-09-17，B-1b 改动落地后实跑）
 Test Files  1 passed (1)
      Tests  1 passed (1)
   Start at  09:01:53
   Duration  26.78s (transform 487ms, setup 0ms, import 958ms, tests 25.58s, environment 0ms)
```

本轮对生成期零触碰（`src/engine/Generator/`、`src/engine/Map/` 未动；fixture 未动）。消费侧唯一掷骰变化是**移除**了 identify 卷轴的随机抽取（消费期，不在生成链上），哨兵 S1 锁定。

### 7.2 p1_30 i18n 门禁——**绿**（增删键后无缺失/死键）

在 7.4 的批量运行中：`p1_30_i18n_gate.test.ts` 通过（8 文件 65 测试批次的组成部分）。

### 7.3 npm run build——**红，唯一原因是 §0 申报项**

```
> brogue-web@0.0.0 build
> vue-tsc -b && vite build

src/test/p1_37_machine_flag_i18n.test.ts(312,14): error TS2339: Property 'rechargeArcanaItem' does not exist on type 'Game'.
src/test/p1_37_machine_flag_i18n.test.ts(322,14): error TS2339: Property 'rechargeArcanaItem' does not exist on type 'Game'.
src/test/p1_37_machine_flag_i18n.test.ts(331,14): error TS2339: Property 'uncurseItem' does not exist on type 'Game'.
BUILD_EXIT=2
```

生产代码、允许清单内文件 TS 零错误（vite build 未执行到）。**§0 补丁应用后此门禁预期全绿**（vite 打包不经过测试文件，补丁只删测试段）。

### 7.4 全量套件（`npx vitest run --fileParallelism=false` 串行，2026-09-17 09:01–09:41，完整日志 /tmp/b1b_full_gate.log）

```
（尾部，实测）
 Test Files  3 failed | 74 passed (77)
      Tests  3 failed | 904 passed | 8 skipped | 5 todo (920)
   Start at  09:01:50
   Duration  2381.16s (transform 1.31s, setup 0ms, import 12.21s, tests 2361.58s, environment 14ms)

EXIT=1
```

三个失败逐一归因（§0 已详述）：

| 失败 | 性质 | 空载复测 |
|---|---|---|
| `p1_37 > AD5a`：`TypeError: game.rechargeArcanaItem is not a function` | §0.1 申报的边界冲突 | 预期红（等验收方补丁） |
| `b_1a A1 诅咒绝不进名字`：`expected 'Leather Armor -1 (unknown runic)' to be 'Leather Armor -1'` | §0.2 预存时间种子脆弱（与 HEAD 逐字节一致；单跑 4 次内复现） | 掷骰通过即绿（本轮 09:01 双文件跑即绿） |
| `armor_model_effect 聚合对比`：`Test timed out in 180000ms` | §0.3 并行负载假红（全量 2381s vs 晨间 1119s） | **单跑 2/2 绿，103s** |

其余 904 条全绿，含 b_1b（新增 14 条）、b_1a（留痕反转后 32 条，除 §0.2 那条掷骰外全绿）、scroll_effects、p2_0、p1_28、p1_31_35、generation_baseline、i18n 门禁。

---

## 8. 测试

### 8.1 新增 `src/test/b_1b_identification_persistence.test.ts`（14 条）

| # | 断言 | 能抓住的错误实现 |
|---|---|---|
| P1 | 存读档往返：种类集 + 实例附魔/充能上限/使用计数/可鉴态全部还原 | serialize/deserialize 只落一侧（任务书要求①"只存种类集丢实例旗标或反之"） |
| P2 | 已鉴定剑读档后仍 `Sword +2`；未鉴定剑仍未鉴定 | deserialize 的 spawn 语义重建分支残留并无条件执行（任务书要求②） |
| P3 | 剥离新字段的旧档读档不崩溃；回退旧行为；单槽 equippedRingId 迁入左槽 | 兼容回退缺失 / 迁移分支缺失 |
| C1 | 绰号盖风味；识别后真名短路绰号消失（药水+魔杖） | displayName 分支序写反（任务书要求③"called 覆盖真名"） |
| C1b | call 拒绝已识别种类 | 校验缺失 |
| C2 | 空白文本清除绰号；新局清零 | callKind 未实现清除；initConsumables 漏清 |
| I1 | 读卷轴只进待选不落账、点选谁谁亮；无可鉴时短路且卷轴消耗 | readItem 内直接落账（任务书要求④"仍随机挑"） |
| I2 | 非候选/未待选时 choose 被拒且留在待选态 | chooseIdentifyTarget 校验缺失 |
| R1 | 同一客观块两枚戒指各自扣减；只有右槽归零只揭示右槽；双归零双双揭示 | processIncrementalAutoID 只处理一只手（任务书要求⑥） |
| R2 | 两枚戒指读档各归各槽、计数不串 | 快照/恢复单槽残留 |
| X1 | 读档与新局复位 pendingIdentify | 场景重建未清挂起态 |
| S1 | **RNG 哨兵**：call/待选/点选/揭示/写档全链 `randomNumbersGenerated` 增量为 0；loadSnapshot 重播种后自身消耗为 0 | 任何交互/持久化路径新增掷骰（任务书要求⑦） |

**S1 哨兵口径（任务书 §三）**：以 `rng.randomNumbersGenerated`（只计 SUBSTANTIVE 流）的**增量**为信号，计数起点在手工构造物品之后——生成期消耗被排除在增量外，**对 C-5/C-6 类地图/生成器改动天然免疫**；它只对"本轮代码有没有多消耗掷骰"敏感。权威判据仍是 generation_baseline（生成期），哨兵补的是交互期。RV6 反证其有效性。

### 8.2 既有测试的断言修改（逐条说明到期原因）

全部集中在 `b_1a_identification.test.ts`（任务书授权"留痕反转"），共 5 处：

| 原断言 | 到期原因 | 反转后 |
|---|---|---|
| 留痕"鉴定态不进存档"：快照无 identif* 字段、读档全丢 | P1-48 本轮修复（任务书 §二.1 明令反转） | 断言新事实：快照携带三类鉴定字段、读档全还原；对抗细节由 b_1b P1/P2 承担 |
| 留痕"call/inscribe 无 API"：ItemLoader 无 callItem/callTitle、displayName 无 called | 本轮实装 call | 断言 callKind 存在、绰号进显示名；**越界守卫**：武器（无风味表）callItem 必须拒绝——CE 转题字而 web 无题字，题字轮到来前不得给武器起绰号 |
| 留痕"戒指单槽"：无 ringLeft/ringRight、第二枚顶掉第一枚 | 本轮双槽 | 断言双槽各就各位、双占拒绝（CE Items.c:8560-8566） |
| 留痕"免费作弊面在线"：两方法存在 | 本轮移除 | 断言两方法 undefined + **越界守卫**（removeCurseFromInventory/rechargeRandomArcana 仍在位）+ **静态守卫**（InventoryOverlay.vue 源码零引用两方法及旧按钮载体，防按钮复活） |
| A12 第一用例：readItem 后直接断言目标已亮 | identify 卷轴改玩家指定（任务书 §二.3），readItem 只进待选 | 补 `expect(game.pendingIdentify).toBe(true)` + `chooseIdentifyTarget(wpn)` 后再断言原揭示结果（揭示语义断言原样保留） |

**守卫性质零放宽**：五处全是"断言新事实/加越界守卫"，无一条断言被删除或弱化（唯一删注意的是原留痕的"反现状"断言，其精神由越界守卫继承）。A10（identify 卷轴自亮）不需改动：读 identify 卷轴时若无可鉴目标，自亮照旧发生、待选态不进入——实测通过。scroll_effects / p2_0 / p1_28 / p1_31_35 逐一核查**零改动**（前两者不读 identify 卷轴、snapshot 均走 toSnapshot/loadSnapshot 不构造字面量）。

### 8.3 反向验证（7 组，均真实改坏 → 真实失败输出 → 还原；要求 ≥4）

**RV1 — serializeItem 丢实例旗标（模拟"只存种类集"）**：注释掉四个新字段的写出。

```
× 存读档往返：种类识别、实例附魔态、充能上限知识、使用计数全部还原
× 已鉴定剑读档后仍已鉴定；未鉴定剑仍未鉴定；两者互不污染
AssertionError: expected false to be true // Object.is equality
      Tests  2 failed | 12 passed (14)      （还原后 14/14 绿）
```

**RV2 — deserializeItem 无条件按 spawn 语义重建（B-1a 旧行为残留）**：

```
× 存读档往返…  × 已鉴定剑读档后仍已鉴定…
AssertionError: expected false to be true // Object.is equality
      Tests  2 failed | 12 passed (14)      （还原后绿）
```

**RV3 — displayName 的 called 分支提到 identified 之前（三态序写反）**：

```
× 绰号盖过风味；种类识别后真名短路、绰号必须消失
AssertionError: expected 'potion called red bull' to be 'Potion of Life' // Object.is equality
      Tests  1 failed | 13 passed (14)      （还原后绿）
```

**RV4 — readItem 的 identify case 读时自动点选第一个候选（还原"随机挑"形态）**：

```
× 读卷轴只进待选、不落账；点选谁谁亮（"随机挑"的实现此处必红）
× 非候选目标被拒绝且留在待选态；未进待选态时 choose 无效
× 读档与新局都复位 pendingIdentify
AssertionError: expected false to be true // Object.is equality
      Tests  3 failed | 11 passed (14)      （还原后绿）
```

**RV5 — processIncrementalAutoID 只展开护甲+左槽（"只处理一只手"）**：

```
× 同一客观块两枚戒指各自扣减；只有右槽归零时只揭示右槽
× 两枚同时归零：同块双双揭示（"只亮一只手"的实现必红）
AssertionError: expected false to be true // Object.is equality
      Tests  2 failed | 12 passed (14)      （还原后绿）
```

**RV6 — chooseIdentifyTarget 注入 `rng.randPercent(100)`（交互路径多消耗一次掷骰）**：

```
× 持久化 / call / 选择 / 揭示全链零掷骰消耗
AssertionError: expected 45 to be 44 // Object.is equality
      Tests  1 failed | 13 passed (14)      （还原后绿）
```

**RV7 — 静态守卫反向验证（按"留痕加固后必须反证"规矩）**：往 InventoryOverlay.vue 注入违规读者 `const zzRv7Probe = (item) => { void activeGame.uncurseItem; }`：

```
× InventoryOverlay 不再引用两个免费方法（静态守卫，防按钮复活）
AssertionError: expected '<script setup lang="ts">\nimport { re…' not to match /rechargeArcanaItem|uncurseItem/
      Tests  1 failed | 31 skipped (32)     （还原后 b_1a + b_1b 合跑 46/46 绿）
```

---

## 9. 与预设不符之处（只列不修；含对任务书/前置文档的修正）

1. **p1_37 边界冲突**（§0.1）：两段 grep 漏了被删除方法的引用者。附验收方补丁。
2. **b_1a A1 用例预存脆弱**（§0.2）：不是本轮引入，但本轮全量撞上（10%）。附一行补丁。教训：**直调 spawn* 而不先建局的测试，全部暴露在 `rng` 单例的 `Date.now()` 构造种子下**（Random.ts:72）——这类用例要么先 `createHeadlessGame` 重播种，要么显式清随机字段。
3. **并行轮同机跑门禁会互饿**（§0.3）：armor_model_effect 被 CPU 争用饿到超时。流程建议：并行轮的门禁错峰，或重负载用例提高超时。
4. **zh_CN.json "仅增键"无法满足**（§6）：删除两个方法必然产生 4 个死键，保留即 i18n 门禁红。已删并全库 grep 证实零残留引用，请求追认。
5. **identify 异步偏差**（§4 末）：CE 同回合同步选择；web 读档回合先推进、点选零回合成本落账。架构性最小偏差，登记。
6. **B-1a 预测之外的两处单槽残留**（§5）：awareness 抗性与装备光环同步不在"循环展开"的预测范围内；已改。其中 awareness 双槽效果暂无专门对抗用例（测试覆盖缺口，§10 登记）。
7. **识别后戒指不显示 "+N"**：CE 对已鉴定戒指在名字前拼附魔（`+%i`，Items.c:1671-1674），web 的 RING displayName 分支从未实现该正向显示（B-1a 也未做）。这是"鉴定后信息缺失"而非泄露，不属本轮五条，**只登记**（Item.ts 在允许清单内但范围外，未动手）。
8. **UI 新文案无中文**（§6 末）：InventoryOverlay 的裸 `t()` 不进扫描器，加键即死键——沿用既有按钮的英文回退模式。要给库存按钮补中文得先给扫描器加 vue 裸 t 的解析（扫描器不在本轮清单），登记给后续轮。
9. **`loadSnapshot` 尾部的 `this.update()`** 会重算可见性——哨兵 S1 实测其不消耗 SUBSTANTIVE 掷骰（断言 0 通过），非偏差，记录以免后人怀疑。
10. **任务书 §六 说 `identifyRandomItem` 在 Game.ts**——属实；但它同时是背包鉴定路径上唯一的 rng 消费点这一点任务书未提，删除后该路径零掷骰（S1 锁定）。

---

## 10. 登记清单（给后续轮）

**给 B-1c（detect magic 极性）**：
1. `isPolarityRevealed()` 仍恒 false 留形（本轮零触碰）；`MAGIC_POLARITY` 表原样可用。
2. 本轮新增的 call/鉴定持久化字段与 detect magic 状态字段无耦合；B-1c 的 `magicPolarityRevealed` 若进快照，参照 §2.1 的"根级可选字段 + 旧档缺省"模式。
3. 恶意品使用确认、地面 sigil 渲染、极性揭示三件套仍整条缺（B-0 §1.6）。

**给 B-2（投掷）**：
1. 投掷命中接 `decrementWeaponAutoIDTimer` 的登记不变（B-1a §8）；本轮双槽改造与此无冲突。
2. 投掷留痕（"传送+落地"）仍在位（b_1a 文件尾部，未触碰）。
3. 若 B-2 引入"可落空的施放"，回头处理 B-1a §6.4-3 的登记。
4. **InventoryOverlay 本轮新增了 identify 选择模式（行点击拦截）与 call 输入行**——B-2 改背包 UI 时注意保留这两段的门控条件（`pendingIdentify` 分支）。

**给 B-4（生成规则对齐）**：
1. potion_of_speed 目录缺口、poison/creeping_death 回池、极性表重核等登记全部维持 B-1a §8 原样。
2. B-4 移动 RNG 流后：generation_baseline 重采**之外**，b_1b 的 S1 哨兵**不受影响**（增量口径，对地图/生成免疫）——这是本轮把它建在构造地图上的直接收益；反观 b_1a 的 A13（地图锚定签名）届时仍需重锚（其文件头注释已写明）。

**给题字（inscribe）轮（新登记，暂无编号）**：
1. CE call 对武器/护甲/护符/食物等转 `inscribeItem`（per-item `inscription`，Items.c:1373-1397、1429-1432 的显示分支）；web 的 callItem 对这些类别返回 false、UI 不出按钮——题字实装时：① Item 加 inscription 字段并随快照持久化；② displayName 追加题字段（CE `{...}` 样式）；③ callItem 的类别门控放开到"无风味表类别 + 已识别的风味种类"；④ b_1a 反转组里的越界守卫（"武器不得被 call"）届时按留痕规矩反转。

**测试覆盖缺口（供验收方裁量）**：
1. awareness 双槽效果（两枚同戴是否叠加 nullify）无专门用例——§5 坑一的修复目前只被"既有单戒指用例仍绿"间接保护。
2. GameCanvas 侧对 `pendingIdentify` 的输入路由（点击画布移动）未在 headless 覆盖（Vue 组件不进 vitest）；引擎侧已有 `isInventoryOpen || pendingIdentify` 双保险拦截，风险限于 UI 层。
3. **回放系统盲区（既有，非本轮引入）**：InventoryOverlay 的 performRead/performQuaff 等直接调 Game 方法、不经 handlePlayerAction，本就不进录制；identify 的目标点选同理。回放一场"读过 identify 卷轴"的对局时，`pendingIdentify` 会挂起（回放侧无点选输入）。归属回放工具轮处理：要么把物品使用动作接入录制，要么在回放开始时清 `pendingIdentify`。

---

## 11. 工作区终态

```
git status --porcelain：
 M brogue-web/src/components/InventoryOverlay.vue
 M brogue-web/src/engine/Core/Game.ts
 M brogue-web/src/engine/Items/Item.ts
 M brogue-web/src/engine/Items/ItemLoader.ts
 M brogue-web/src/entities/Player.ts
 M brogue-web/src/locales/zh_CN.json
 M brogue-web/src/test/b_1a_identification.test.ts
?? brogue-web/src/test/b_1b_identification_persistence.test.ts
?? brogue-web/ai_docs/b_1b_identification_persistence_report.md

git diff --stat：
 brogue-web/src/components/InventoryOverlay.vue  | 132 ++++++++++--
 brogue-web/src/engine/Core/Game.ts              | 273 ++++++++++++++++--------
 brogue-web/src/engine/Items/Item.ts             |  35 ++-
 brogue-web/src/engine/Items/ItemLoader.ts       |  27 +++
 brogue-web/src/entities/Player.ts               |  27 ++-
 brogue-web/src/locales/zh_CN.json               |  13 +-
 brogue-web/src/test/b_1a_identification.test.ts | 120 ++++++++---
 7 files changed, 490 insertions(+), 137 deletions(-)
新增测试：src/test/b_1b_identification_persistence.test.ts（14 条）
临时文件：无（本轮未创建调试文件；全部反向验证以 Edit 注入/还原完成，无残留）
```

边界自查：`src/engine/Generator/`、`src/engine/Map/`、`src/engine/Environment/`、`src/entities/` 下除 Player.ts 外、`BrogueCE-master/`、`src/data/*.json`、`src/engine/Random.ts`、`src/test/fixtures/*`、`src/test/harness.ts`、清单外既有测试（含 p1_37）——**零触碰**。未执行任何 git 写操作。
