# V-1b 报告：MF_ALTERNATIVE / MF_ALTERNATIVE_2 落地

日期：2026-09-18。执行：开发方（ZCode/GLM）。分支：`round/v-1b`。

## 0. 结论摘要

`MF_ALTERNATIVE` / `MF_ALTERNATIVE_2` 已按 CE `Architect.c:1291-1318` 直译进
`BlueprintEngine.applyBlueprint`（feature 构建循环之前一次性决定 skip 集）。
当前 `blueprints.json` 零 feature 带这两旗标（本测试文件 P1 自检钉死），
因此 `totalFreq` 恒 0、**零掷骰**，生成流逐位不变；`generation_baseline`
全绿且 fixture 未动。全量套件与 `npm run build` 均绿。

## 1. 对任务书的反驳

本轮核对**未发现方向性错误**，CE 引用行号与语义全部成立。三处需修正/
精化的小项：

1. **「集合非空时恰消耗 1 次」不精确**（任务书 §6.4）。`rand_range(1, 1)`
   在 CE 里也早退、**不消耗**（`Math.c:144-146`：`upperBound <= lowerBound →
   return lowerBound`，在 `range()` 之前）；web `randRange` 同构
   （`Random.ts:97-100`）。所以正确表述是：**|集合| ≥ 2 时恰消耗 1 次；
   |集合| = 1 时消耗 0 次**（此时抽签退化为"必选唯一成员"，语义不受影响）。
   新测试 T4d 把这一边界按 CE 字面行为钉住。若 V-2 落地后有人发现
   单成员替代集合"没掷骰"，那是 CE 本来的样子，不是 bug。
2. **行号小偏差**：CE 的替代集逻辑块实际是 `Architect.c:1291-1318`
   （注释 1291-1292、初始化 1294-1296、`for (j=0; j<=1; j++)` 循环体
   1297-1318），任务书写 1291-1316 少了循环收尾两行。语义无出入。
3. **§2.3 的前提性偏差（审计核心发现）**：任务书让"逐个查清四个死旗标
   **在 CE 里的确切语义**"，但四个里只有 `MF_KEY_DISPOSABLE` 是真 CE 旗标；
   **`MF_FILL_DOORWAY` / `MF_RING` / `MF_SCATTER` 在全 CE 树零命中——
   它们是 web 自创词元，不存在"CE 语义"可查**。能查清的是 CE 用什么
   机制表达同一意图（详见 §3 审计表右列）。对 V-2 的含义：这三个旗标
   在数据重写时不是"补实现"的对象，而是**整体替换为 CE 机制**的对象。

另确认任务书其余事实：引擎活跃识别面恰 7 个旗标（全部在
`BlueprintEngine` 的 `fFlags.has(...)`；`Game.ts:2361/2366` 预览路径
重复检查的是其中两个；`Game.ts:1264-1286` 的 `MF_OUTSOURCE` 只存在于
注释）；`MF_ALTERNATIVE_2` 在 CE Brogue 目录零使用（仅
`Architect.c:997/1292` 两处引擎引用）✓；`blueprints.json` 现无替代
集合 feature ✓。

## 2. MF_ALTERNATIVE 实现与 CE 的逐条对照

| CE（Architect.c） | web（BlueprintEngine.ts applyBlueprint） | 一致性 |
|---|---|---|
| `skipFeature[20]` 定长数组，先全部置 false（1294-1296） | `const skipFeature = bp.features.map(() => false)`（动态长度；CE 定长 20 是 C 限制，web 蓝图 feature 数无此约束，语义等价） | ✓ |
| `for (j=0; j<=1; j++)`，`alternativeFlags[2] = {MF_ALTERNATIVE, MF_ALTERNATIVE_2}`（997、1297） | `for (let j = 0; j <= 1; j++)`，`j===0 ? 'MF_ALTERNATIVE' : 'MF_ALTERNATIVE_2'`（web 旗标是字符串数组，逐个 `includes`） | ✓ |
| 每轮把带旗标的 feature 全部 `skipFeature[i]=true` 并 `totalFreq++`（1299-1304） | 同构（478-483 行） | ✓ |
| `totalFreq > 0` 才掷 `rand_range(1, totalFreq)` **一次**（1305-1306） | 同构：`if (totalFreq > 0) { let randIndex = rng.randRange(1, totalFreq); ... }`（484-485 行）；集合为空零消耗（web `randRange` 上界≤下界早退，与 CE `rand_range` 同构） | ✓ |
| 按 feature 顺序数到第 `randIndex` 个带旗标者 `skipFeature[i]=false; break`（1307-1316） | 同构（486-494 行），顺序、减法、break 位置逐行对应 | ✓ |
| 两轮**串行覆盖**：第二轮的标记循环无条件重标所有带 `MF_ALTERNATIVE_2` 的 feature——包括第一轮胜出的双旗标 feature（1299-1304 的字面行为） | 同构（web 第二轮同样无条件重标）；测试 T6 钉死"单例结局真实存在"，防后人把两轮"优化"成互不覆盖 | ✓ |
| feature 循环开头 `if (skipFeature[feat]) continue;`（1327-1331） | feature 循环开头同构跳过（498-499 行） | ✓ |
| 被选中者按自身 `instanceCountRange` 全建 | 未选中者整条跳过后，选中者照常走原循环体（`count = randRange(instanceCount[0], [1])`） | ✓ |
| 决策时点：feature 构建循环之前、机器选址成功之后（1291 在 `buildAMachine` 内部） | `applyBlueprint` 内、feature 循环之前（选址已在 `findGateRoom` 完成） | ✓ |
| 决策掷骰先于一切 feature 的 instanceCount 掷骰 | 同（skip 块在循环外，count 骰在循环内） | ✓ |

逐字核对方式：所有 CE 行号来自本会话对
`BrogueCE-master/src/brogue/{Architect,Math}.c`、`Rogue.h`、
`src/variants/GlobalsBrogue.c` 的 `Read`/`sed -n` 原文输出。

## 3. 死旗标审计表（§2.3；只勘察，不实现）

| 旗标 | web 数据现状 | CE 语义 | web 现状 | 建议归属 |
|---|---|---|---|---|
| `MF_KEY_DISPOSABLE` | 1 处：`key_rat_trap` 的 KEY feature | **真 CE 旗标**。`Rogue.h:2615`（`Fl(30)`）："if a key is generated or adopted, it will self-destruct after being used at this current location"。写入：`Architect.c:1523/1526` 把 `(feature->flags & MF_KEY_DISPOSABLE)` 传给 `addLocationToKey`（591-597）/ `addMachineNumberToKey`（599-605），落到 `keyLoc[i].disposableHere`；运行时：`Movement.c:643-660`，钥匙在**对应位置/机器**被使用后 `deleteItem` 自毁。CE 载体：Kennel（GlobalsBrogue.c:250）、Vampire lair（:258）、Legendary ally（:262）、Plain locked door（:300）——全部挂在 `MF_GENERATE_ITEM` 的钥匙 feature 上，且多与 `MF_SKELETON_KEY` / `MF_OUTSOURCE_ITEM_TO_MACHINE` 连用 | 引擎完全忽略。web 钥匙模型只有 `keyLoc{loc,machine}` 二元组（V-0 §7.1 的"钥匙 kind 维度"缺口），无 `disposableHere` 维度 | **钥匙系统轮**（V-1c 锁⇔钥匙线，或其后独立小轮）。前置：`keyLoc` 补第三维 `disposableHere` + 使用端（Movement 等价处）消费；单靠 V-2 数据轮无法激活 |
| `MF_FILL_DOORWAY` | 1 处：`vestibule_flammable` 的 GRASS feature | **CE 无此旗标（全树零命中，web 自创）**。CE 表达同一意图的机制：可燃路障 = `WOODEN_BARRICADE` 载体 + `MF_PERMIT_BLOCKING \| MF_BUILD_AT_ORIGIN`（GlobalsBrogue.c:311，Flammable barricade）——"填在门洞"由 `MF_BUILD_AT_ORIGIN`（门位即 origin）+ 载体形态表达，不是独立旗标 | 引擎忽略；web 用 GRASS 模拟路障（无 WOODEN_BARRICADE 载体，D2 退池对象），旗标纯装饰 | **V-2 数据轮**：按 CE 旗标重写该蓝图；前提是 WOODEN_BARRICADE 载体落地（D2 处理链）。数据轮内先删除该死旗标即可，不产生行为缺口 |
| `MF_RING` | 1 处：`key_lava_moat` 的 LAVA feature（{8,20}） | **CE 无此旗标（全树零命中，web 自创）**。CE 的 Lava moat room（GlobalsBrogue.c:420-427）用 `LAVA {60,60}`（LIQUID 层）+ `MF_REPEAT_UNTIL_NO_PROGRESS` 重复填充，"护城河"形态来自 roomSize {75,120} + purge + 液体填满，再配 `LAVA_RETRACTABLE` DF 实现取钥匙后岩浆退去 | 引擎忽略；feature 实际按普通散布落位，"环形"意图未生效 | **V-2 数据轮**：CE 原型需要 `MF_REPEAT_UNTIL_NO_PROGRESS` + `DF_LAVA_RETRACTABLE`（后者属 DF 链载体）。数据重写时按 CE 删自创旗标；载体未落地前该蓝图按 D2 退池 |
| `MF_SCATTER` | 14 处：`vestibule_pit_traps`/`key_fire_trap`/`key_flood_trap`/`key_poison_gas`/`key_web_room`/`area_swamp`/`area_bloodflower` 的地形 feature | **CE 无此旗标（全树零命中，web 自创）**。CE 对"铺满/散布"的表达是分场景的：整屋铺 → `MF_EVERYWHERE`（如 CARPET）；液体反复填 → `MF_REPEAT_UNTIL_NO_PROGRESS`；多点散布 → 大 `instanceCount`（如 RAT_TRAP_WALL_DORMANT {10,20}）+ `personalSpace` | 引擎忽略；这些 feature 实际是逐实例顺序落位（shuffled cells 头部优先）——行为与"散布"接近但无 personalSpace 间距保证 | **V-2 数据轮**：逐蓝图按 CE 原型改旗标（EVERYWHERE / 大 instanceCount+personalSpace）。注意：删掉 `MF_SCATTER` 本身**不改变行为**（引擎本来就不认），所以这一步没有 RNG 风险；风险都在 instanceCount/terrain 的重写里 |

汇总：四个死旗标 = **1 个真 CE 旗标（需钥匙系统轮）+ 3 个 web 自创词元
（V-2 数据轮整体替换，无行为缺口）**。

## 4. 改动清单

```
git diff --stat:
 brogue-web/src/engine/Generator/BlueprintEngine.ts | 40 +++++++++++++++++++++-
 1 file changed, 39 insertions(+), 1 deletion(-)

git status --short:
 M src/engine/Generator/BlueprintEngine.ts
?? src/test/v_1b_alternative.test.ts   （新建，~300 行）
```

- `BlueprintEngine.ts`：`applyBlueprint` 内 feature 循环前插入 skip 决策块
  （含 CE 对照注释）；feature 循环改为 `entries()` 带 skip 检查。循环体内
  其余代码零改动。
- `blueprints.json`：**未动**（任务书 §3）；`generation_baseline.json`：
  **未动**（`git status` 空）；`BrogueCE-master/`：只读未动。
- 未执行任何 git commit/add。

## 5. 对抗性测试与反向验证

新文件 `src/test/v_1b_alternative.test.ts`，9 用例：
P1（生产数据零替代集合的前提自检，注明 V-2 会来反转它）、
T1（三选一 + 3000 次分布均匀）、T2（双集合独立 + 集合内均匀）、
T3（instanceCount 全建）、T4a-d（RNG 记账四连）、T6（双旗标串行覆盖，
注明 CE 目录零使用、防"顺手优化"）。

**反向验证一：把「选一条」改成「全建」**（`if (false && skipFeature[feat])`，
标 REVERT-ME）。真实输出：

```
 ❯ src/test/v_1b_alternative.test.ts (9 tests | 4 failed) 35ms
     × T1 三条替代 feature：每次恰建一条；3000 次分布均匀（各≈1/3） 9ms
     × T2 两个集合独立：ALT 与 ALT_2 各自恰建一条、互不侵染 4ms
     × T3 被选中者按 instanceCount 全建（不是只建 1 个实例） 12ms
     × T6 第二轮 skip 标记会覆盖第一轮的选中；单例结局真实存在 5ms
AssertionError: 每次恰建一条（全建→3、全跳→0 都在此翻红）: expected [ { category: 'SCROLL', …(3) }, …(2) ] to have a length of 1 but got 3
AssertionError: 两集合各恰建一条（共 2 件）: expected [ { category: 'SCROLL', …(3) }, …(3) ] to have a length of 2 but got 4
AssertionError: 被选中的替代 feature 是唯一产出者: expected [ 'v1b_cnt2', 'v1b_cnt3', 'v1b_cnt4' ] to have a length of 1 but got 3
AssertionError: 结局只可能是 1 件或 2 件: expected 4 to be less than or equal to 2
 Test Files  1 failed (1)
      Tests  4 failed | 5 passed (9)
```

（T4 系列不翻红是**正确的隔离**：该破坏不改变掷骰次数。）

**反向验证二：掷骰池错拿全 feature 表**（`rng.randRange(1, bp.features.length)`
替代 `randRange(1, totalFreq)`，标 REVERT-ME）。真实输出：

```
 ❯ src/test/v_1b_alternative.test.ts (9 tests | 2 failed) 107ms
     × T2 两个集合独立：ALT 与 ALT_2 各自恰建一条、互不侵染 7ms
     × T6 第二轮 skip 标记会覆盖第一轮的选中；单例结局真实存在 4ms
AssertionError: 两集合各恰建一条（共 2 件）: expected [ { category: 'SCROLL', …(3) } ] to have a length of 2 but got 1
AssertionError: 至少建成 1 件: expected 0 to be greater than or equal to 1
```

（池 4 > 集合 2 时 `randIndex` 可能数出界 → 该集合一个都不建。）

**反向验证三：集合为空也照掷骰**（掷骰移出 `if (totalFreq > 0)`、空集时
退化用全表长度做池，标 REVERT-ME）。真实输出：

```
 ❯ src/test/v_1b_alternative.test.ts (9 tests | 3 failed) 198ms
     × T4a 无旗标蓝图：引擎不因替代机制多掷任何一次骰（含零 feature 形态） 3ms
     × T4b 三条替代 feature：全流程恰多消耗 1 次（不是每 feature 一次） 0ms
     × T4c ALT_2 集合同样恰多消耗 1 次；两集合并存恰多消耗 2 次 0ms
AssertionError: 无旗标夹具与零 feature 夹具消耗相同（shuffle 底数）: expected 21 to be 19 // Object.is equality
AssertionError: 三条替代集合应恰多掷 1 次（每 feature 掷一次的错误实现会得 +3）: expected +0 to be 1 // Object.is equality
AssertionError: 两个非空集合各掷一次 → +2: expected +0 to be 2 // Object.is equality
```

（T4a 的 `21 vs 19` 正是任务书 §4 关心的机制保证：多掷的 2 次就是
"基线会被移动"的来源。）

三次破坏均已还原：`grep -rn "REVERT-ME" src/` = **0 处**；还原后单文件
重跑 9/9 全绿。

## 6. 需要追加授权的测试

**无**。四段 grep（主题 / 结构性穷举表 / 公共目录标识符 / 扫描器形态）
均未发现会因本轮改动翻红的既有测试：没有测试钉 `applyBlueprint` 内部
形态；`v_1a_blueprint_items` 钉的是数据文件与 Game.ts（本轮均未动）；
`generation_baseline` 属预期内必须保持绿的判据（见 §7）。清单外零撞红。

## 7. 门禁结果

1. **`npm run build`**：通过（exit 0，`✓ built in 1.53s`；chunk 体积警告
   为既有现象，与本轮无关）。输出尾部：

```
dist/assets/index-D_uf4Uzv.js               882.52 kB │ gzip: 266.39 kB

(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
✓ built in 1.53s
```

2. **`npx vitest run --fileParallelism=false`（不带文件参数，全量字母序）**：
   通过。输出尾部：

```
 RUN  v4.1.11 /private/tmp/.../wt-v-1b/brogue-web

 Test Files  90 passed (90)
      Tests  1161 passed | 8 skipped | 5 todo (1174)
   Start at  18:18:00
   Duration  1450.95s (transform 1.05s, setup 0ms, import 11.78s, tests 1431.98s, environment 14ms)
```

（含新文件 `v_1b_alternative.test.ts`；`generation_baseline` 在其中，
未翻红。）

3. **`generation_baseline`**：绿（见上），且
   `git status --short src/test/fixtures/generation_baseline.json` 为空
   ——**fixture 未被重新捕获**，与本轮"零 feature 带旗标 → 零掷骰 →
   生成流逐位不变"的判定一致。
4. `BrogueCE-master/`：`git status` 干净，只读未动。

## 8. 遗留与登记

**给 V-1c（结构大轮：资格过滤 + 配额 + 递归 + 回滚 + 锁钥）**：
- 钥匙轮需一并考虑 `MF_KEY_DISPOSABLE`：web `keyLoc` 需扩第三维
  `disposableHere`，消费端在锁具使用处（CE `Movement.c:643-660` 等价）；
  CE 载体清单见 §3 第一行（Kennel / Vampire lair / Legendary ally /
  Plain locked door，且与 `MF_SKELETON_KEY` / `MF_OUTSOURCE_ITEM_TO_MACHINE`
  连用——后两者也在 V-1c 范围内，实现顺序上先外包/领养、后 disposable）。
- V-0 §7 的缺口 1（钥匙 kind 维度）、2（`rewardRoomsGenerated` 载体）、
  6（`blueprintQualifies` 对 BP_REWARD 无对称守卫，照抄勿加固）继续有效。

**给 V-2（数据全量还原）**：
- 本轮机制就位后，CE 基座大奖（附魔卷轴 XOR 生命药水，
  GlobalsBrogue.c:218-219）可以直接落两条 `MF_ALTERNATIVE` feature——
  **落地的同一次提交会移动生成期 RNG 流**（每台带替代集合的机器每集合
  多掷一次），`generation_baseline` 必须随 V-2 重捕获（V-0 §5 第 6 条
  预告过）；本测试 P1 自检届时翻红属预期，按注释指引更新断言即可。
- 三个 web 自创旗标（`MF_FILL_DOORWAY`/`MF_RING`/`MF_SCATTER`）随数据
  重写整体消失，替换为 CE 机制；载体缺口（WOODEN_BARRICADE、
  `MF_REPEAT_UNTIL_NO_PROGRESS`、`DF_LAVA_RETRACTABLE`、`MF_EVERYWHERE`
  等）按 D2 处理——没有载体的蓝图退池留形，不近似模拟。

**本轮明确不做**（任务书 §3 全部遵守）：资格过滤、配额、递归、回滚、
四个死旗标的实现、`blueprints.json` 数据改动。
