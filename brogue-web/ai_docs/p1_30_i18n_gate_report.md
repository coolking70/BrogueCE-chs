# P1-30 报告：给 i18n 装上红灯，并补齐现存缺口

> 2026-09-15。分支 `round/p1-30`（独立 worktree，未执行任何 git 写操作）。
> 本轮执行 `i18n_risk_assessment.md` §5.1–5.2 与 §5.4，另获授权执行 §5.3 的死键归档。

---

## 〇、与任务书不符之处（先行声明）

1. **缺失键实测为 77 个，不是 60 个**。差异来源是**扫描能力**而非代码在评估后
   又长了很多：评估文的扫描把"变量首参"的 `t()` 调用整类跳过了——`logCast(key, …)`
   辅助函数背后的 12 个 `bolt.monster_cast_*`、`applyDirectBoltDamage(…, 'bolt.fire_reflect', …)`
   的 2 个反射键、以及 `resolveGeometryAttackOn` 里若干几何攻击/抓住/自爆键，
   评估文都数不到。本轮扫描器做了同文件实参追踪（见 §一），把这批全部挖出并补齐
   （对 HEAD 基线终扫 missing = 77，与本轮补齐清单严格一致）。
2. **`Monster.ts` 的拼接行实际在 420 行附近**（任务书写 402，代码已漂移）。
   函数是 `mutate()`，语义与任务书描述一致。
3. **"补齐后断言缺失数为 0"在第一轮就差一个：`name.Dart` 缺失**。
   飞镖（Dart）的 `name.*` 键从未存在（CE weaponTable 里它 frequency=0 不参与
   生成，所以从未暴露）。已补 `"name.Dart": "飞镖"`。静态门抓不到它（动态键），
   由新增的"数据驱动 name.* 覆盖测试"把关——若此键再次缺失，该测试会红。
4. **发现一批完全没走 i18n 的硬编码英文（边界外，只列不修）**：
   `src/engine/Core/Game.ts:3510/3515/3523/3557/3579/3594` 附近的法杖充能、
   净化、符文觉醒等 6 条消息是模板字符串直拼英文（如
   `` `${item.name} is already fully charged.` ``），**没有任何 `t()` 调用**，
   键存在性红灯对它无效。需要一轮在 `src/engine/` 边界内的工作补路由 + 补键。
5. **`combat.monkey_steals` 的调用点不传插值变量**（`Monster.ts:805` 只传
   `defaultValue`，不传怪物名），译文因此无法带上"哪只猴子"，只能译成无主语的
   "猴子抢起东西就逃！"。要带上名字需改调用点（边界外）。
6. **`explore.nothing_more` / `ui.no_path` 两键的 defaultValue 已经是中文**
   （前人直接把中文写进了 `defaultValue`），玩家看到的不是英文。本轮照常补键
   （消灭对 defaultValue 的依赖），译文沿用原中文。
7. 任务书"归档约 2584 条"实测为 **2387 条**，且差异的成因值得点名：
   2584 = 2805 − 221，即评估文用「总键数 − 字面量命中数」算死键，
   这把 **190 个 `name.*` + 5 个 `menu.mode.*` 前缀覆盖键直接算成了死键**
   ——正是任务书自己警告"最容易误删"的那批。本轮口径为
   「总键数 − 字面量键 − 前缀覆盖键」，对 HEAD 基线（2805 键）实测
   unreferenced = 2387，与最终归档数一致；归档脚本另内置断言
   "前缀键误归档数 = 0" 复核。

---

## 一、机制性修复：键存在性红灯

### 扫描器方案（`src/test/i18n_scan.ts`，纯静态分析，无 i18next / vitest 依赖）

**调用点识别**：字符级状态机遍历源码，跟踪注释（`//`、`/* */`）、字符串
（`'`、`"`）、模板串（含 `${}` 嵌套与转义）、正则字面量（除法歧义用
"前一有效字符 ∈ 表达式位置字符集"启发式）八种状态，只在**代码态**匹配
`\bi18next\s*\.\s*t\s*\(` 与 `\$t\s*\(`。因此注释里的示例调用、字符串里的
"i18next.t(…" 文本都不会误报。

**首参解析**（`parseStringExpr`），按项目实际出现的形态覆盖：

| 形态 | 例子 | 归类 |
|---|---|---|
| 静态字面量 | `t('combat.hit', …)` | **literal**：必须存在于资源，缺则红 |
| 拼接（静态+动态尾） | `t('name.' + name, …)`（`ItemLoader.ts:16`） | **prefix**：`name.` 下所有键视为被引用 |
| 模板插值 | `` t(`menu.mode.${payload.mode}`, …) ``（`App.vue:71`） | **prefix**：`menu.mode.` |
| 三元 | `t(kind === 'weapon' ? 'a' : 'b')` | 两支分别解析，候选取并集 |
| 裸标识符 | `t(kamikazeKey, …)` | **同文件追踪**（下述），追不到则红 |

**标识符追踪**（`resolveIdentifierCandidates`，两层）：
- **局部赋值**：找同文件 `const|let|var <ident> =`，把初始化式按字符串表达式
  解析（`Monster.ts` 的 `const kamikazeKey = voice === 'ally' ? … : …` 嵌套三元
  由此覆盖）；
- **函数参数**：找到 `<ident>` 出现的参数表（`[(,]\s*ident\s*[?:]`），向左
  深度回溯到参数表的 `(`，提取函数名（允许 `const f = (…)` 的 `=` 缝隙，覆盖
  `logCast` 箭头函数与 `applyDirectBoltDamage` 私有方法两种形态），再在文件里找
  该函数全部调用点，按参数序号取实参解析。`reflectKey` 的两个键、`logCast`
  的 12 个键由此进入检查范围。

**防漏报设计**（宁可多查、不可漏查）：
- 前缀引用只会**多圈键**（归档更保守），绝不会让缺失检查漏报；
- 参数追踪候选取**并集**：某分支从未执行也照样要求键存在；
- 参数追踪产出的候选必须是"点号键"形状（`/^[a-z][\w]*(\.[\w]+)+$/`）——
  本项目所有 i18n 键都是点号键，混入的杂音字符串直接丢弃；
- 追踪不到字面量候选的调用点本身**就是红灯**（`unresolved` 断言）：
  以后有人写 `t(someVar)`，要么改写成可扫描形式，要么扩展扫描器，二者必居其一；
- 另有量级护栏：`literals.size > 250`、扫描文件数 > 30 且必须含 `.vue` 与
  `engine/`——扫描器自身退化（正则失配、遍历损坏）时先红在这里，不会假绿。

**防误报设计**：
- `src/test/` 整目录与 `*.test.ts` / `*.spec.ts` 排除（测试里会出现故意的坏键）；
  `.vue` 一律扫描（界面文案走 i18next）；
- 空前缀（插值在开头、无静态文本）按 `unresolved` 处理——空前缀等于
  "全部键都被引用"，会让归档与缺失检查双双失明；
- 前缀必须以 `.` 结尾才被接受。

**死键输出**：`unreferenced` = 资源键 − 字面量键 − 前缀覆盖键。
`name.*`（190 键）、`menu.mode.*`（4 键）、`mutation.*`（8 键）等动态前缀
全部被前缀引用保护，归档零误删（归档脚本内置断言复核）。

### 门测试（`src/test/p1_30_i18n_gate.test.ts`，16 个断言）

1. 每个字面量键存在（缺失即红，失败信息带 `键 ← 文件:行`）；
2. 每个前缀下至少 1 个真实键（防前缀打错字整组落空）；
3. 所有 `t()` 首参可静态解析；
4. **zh_CN.json 无死键**——归档成为持续不变量，此后再腐化会直接红；
5. 数据驱动 `name.*` 覆盖：全部怪物/武器/护甲/消耗品/奥术/外观池英文名
   必须有键且译文含中文（中文名按 `ItemLoader` 既有契约透传，不需要键；
   这条测试就是 `name.Dart` 缺口的抓捕者，也是归档误删 `name.*` 的运行时防线）；
6. 变异名拼接（见 §二）；
7. 实跑冒烟（见 §四）。

### 反向验证（强制，两条真实失败输出）

**反向验证 1：删掉被引用的键 `combat.hit` → 红**

```
FAIL  src/test/p1_30_i18n_gate.test.ts > P1-30 键存在性红灯：… > 每个静态字面量键都存在（缺失即红）
AssertionError: 缺失翻译键 1 个（缺键会静默渲染英文defaultValue）：
  combat.hit  ←  engine/Core/Game.ts:4553: expected [ Array(1) ] to deeply equal []

- []
+ [
+   "  combat.hit  ←  engine/Core/Game.ts:4553",
```
同时实跑冒烟也红（实跑中 `t('combat.hit')` 命中缺失）。随后共 2 failed。
还原后字节一致，16/16 恢复绿。

**反向验证 2：在 `App.vue` 注入引用不存在键的 `t()` 调用 → 红**

注入：`void i18next.t('p1_30_probe.key_that_does_not_exist', { defaultValue: 'probe' });`

```
FAIL  src/test/p1_30_i18n_gate.test.ts > P1-30 键存在性红灯：… > 每个静态字面量键都存在（缺失即红）
AssertionError: 缺失翻译键 1 个（缺键会静默渲染英文defaultValue）：
  p1_30_probe.key_that_does_not_exist  ←  App.vue:67: expected [ Array(1) ] to deeply equal []
```
还原后字节一致（`cmp` 通过），16/16 恢复绿。工作区最终 `git status` 确认无探针残留。

---

## 二、补齐缺失键

### 数量对比

| | 任务书/评估文 | 本轮实测（最终扫描器） |
|---|---|---|
| 补齐前缺失键 | 60 | **77**（其中 2 个 `bolt.*_reflect` 需实参追踪才可见） |
| 补齐后缺失键 | 0 | **0**（门测试断言，含死键=0） |

新增键共 **86 个** = 77 个缺失键 + `name.Dart` + 8 个变异键（86 = 首批 84 +
后补 2 个 reflect 键，与扫描清单逐一对应）。

### 译文清单（键 → 译文）

普通缺失键（77）+ `name.Dart`（变异名 8 键见下表）：

```
monster.summon_minions         → {{name}}低声诵起了黑暗咒语！
replay.finished                → 回放结束。
game.no_stairs_down            → 这里没有向下的楼梯。
combat.player_seized_struggle  → 你奋力挣扎，但{{monster}}仍紧紧抓住你不放！
env.stuck_web                  → 你在黏稠的蛛网中挣扎。
env.break_web                  → 你挣断了蛛网。
item.deep_water_reach          → {{name}}沉在深水之中。
item.lava_reach                → {{name}}浸没在熔岩之中。
potion.confusion_burst         → 现实在你周围扭曲闪烁！
potion.unknown                 → 味道怪怪的。
food.nourish                   → 味道好极了！你感觉吃饱了。
scroll.enchant                 → 奥术之力磨砺了你的装备。
scroll.remove_curse_empty      → 没有受诅咒的物品可以净化。
scroll.recharge_item_empty     → 没有耗尽的奥术道具可以充能。
arcana.cooldown                → {{name}}还在冷却中（还需 {{turns}} 回合）。
arcana.no_charges              → {{name}}已经没有充能了。
bolt.invulnerable_no_effect    → {{target}}毫发无伤。
bolt.negation_dies             → {{target}}倒在地上，失去了生命！
bolt.target_you                → 你
bolt.monster_cast_kamikaze     → {{caster}}在法术生效前爆裂了！
bolt.monster_cast_reflect      → {{target}}将这道弹射反射回了{{caster}}！
bolt.monster_cast_hit          → {{caster}}击中了{{target}}！
bolt.monster_cast_miss         → {{caster}}试图击中{{target}}，但没有命中。
bolt.monster_cast_heal         → {{caster}}治疗了{{target}}！
bolt.monster_cast_haste        → {{caster}}加快了{{target}}的速度！
bolt.monster_cast_shield       → {{caster}}为{{target}}布下了护盾！
bolt.monster_cast_slow         → {{caster}}减慢了{{target}}的速度！
bolt.monster_cast_discord      → {{caster}}在{{target}}心中播下了不和的种子！
bolt.monster_cast_negation_dies→ {{target}}倒在地上，失去了生命！
bolt.monster_cast_negation     → {{caster}}驱散了{{target}}身上的魔法！
bolt.monster_cast_beckon       → {{caster}}将{{target}}拽向自己！
bolt.fire_reflect              → {{target}}将火焰反弹回了你身上！
bolt.lightning_reflect         → {{target}}将闪电反弹回了你身上！
scroll.protect_uncurse         → 一股邪恶意念从你的{{name}}上消散了。
scroll.summon_many             → 空间泛起涟漪，成群的怪物现身了！
scroll.summon_one              → 空间泛起涟漪，一只怪物现身了！
runic.weapon.slaying           → 杀戮符文发动，毁灭了{{target}}！
runic.weapon.force             → 力场符文将{{target}}击退了 {{dist}} 格！
runic.weapon.mercy             → 怜悯符文让你的武器放过了{{target}}。
runic.armor.absorption         → 你的护甲脉动了一下，吸收了 {{damage}} 点伤害！
runic.armor.reprisal           → 你的护甲反噬一击，对{{target}}造成 {{damage}} 点伤害！
runic.armor.immunity           → 护甲的免疫符文保护你免受{{target}}的毒手！
status.player.hungry           → 你饿了。
status.player.weak_with_hunger → 饥饿让你感到虚弱。
status.player.faint_with_hunger→ 你饿得头昏眼花。
status.player.starving_to_death→ 你快要饿死了！
combat.backstab                → 你背刺了{{monster}}，造成 {{damage}} 点伤害！
combat.miss_float              → 未命中
combat.monster_splits          → {{name}}分裂成了两个！
death.bloat_gas                → {{name}}释放出一团腐蚀性毒气！
death.bloat_explosion          → {{name}}在烈焰中爆裂了！
env.player_drowns              → 你坠入黑暗的深水，淹死了。
env.monster_drowns             → {{name}}淹死了。
env.player_incinerated         → 你被熔岩烧成了灰烬！
env.monster_incinerated        → {{name}}被烧成了灰烬。
env.player_poison_gas          → 你吸入了一口毒气！
env.player_creeping_death      → 蔓延的死亡孢子侵蚀着你的血肉！
item.destroyed_lava            → {{name}}在熔岩中烧毁了。
explore.nothing_more           → 这里没有什么可探索的了。
ui.no_path                     → 无法到达该位置。
combat.ally_kamikaze           → 你的{{attacker}}撞上{{target}}，轰然爆裂！
combat.discordant_kamikaze     → {{attacker}}调头撞向{{target}}，轰然爆裂！
combat.geometry_kamikaze       → {{attacker}}撞向{{target}}，轰然爆裂！
combat.ally_seizes             → 你的{{attacker}}牢牢抓住了{{target}}！
combat.discordant_seizes       → {{attacker}}反身抓住了{{target}}！
combat.geometry_seizes         → {{attacker}}一把抓住了{{target}}！
combat.armor_degraded          → 你的护甲被酸液腐蚀了！
combat.monkey_steals           → 猴子抢起东西就逃！
combat.discordant_hits         → {{attacker}}调头攻击{{target}}，造成 {{damage}} 点伤害！
combat.geometry_hits_monster   → {{attacker}}击中了{{target}}，造成 {{damage}} 点伤害。
combat.discordant_misses       → {{attacker}}调头攻击{{target}}，但没有命中。
combat.geometry_misses_monster → {{attacker}}没有击中{{target}}。
combat.monster_kamikaze        → {{monster}}向你猛扑过来，爆裂了！
combat.monster_seizes_you      → {{monster}}一把抓住了你！
combat.kamikaze_short          → 轰！
env.monster_stuck_web          → {{monster}}在蛛网中挣扎。
env.monster_break_web          → {{monster}}挣断了蛛网。
name.Dart                      → 飞镖
```

说明：
- **全部为真中文**，无一条塞英文原文充数；`{{}}` 插值名与调用点实参逐一对过
  （逐键导出调用点全文核对）。部分键的调用点比 defaultValue 少传了变量
  （如 `bolt.monster_cast_hit` 不传伤害数字、`bolt.monster_cast_reflect` 不传
  弹种名），译文相应不使用不存在的占位符——占位符引用不存在的变量会渲染出
  字面 `{{xxx}}`，比缺翻译更糟。
- 语序处理示例：`combat.monster_splits` 不作"这 {{name}} 分裂成两个！"而作
  "{{name}}分裂成了两个！"；主语（中文怪物名）后不加空格，数字前后按既有
  译文风格留空格（"造成 {{damage}} 点伤害"）。
- 用词与既有译文对齐：`miss_float` 取 `combat.miss_short` 同款"未命中"；
  discord 用既有的"不和"（`name.Scroll of Discord` → 不和卷轴）；seize 与
  面板能力"会抓住并束缚猎物"同源（抓住了/抓住你）。

### 变异名（8 个）与语序

CE `mutationCatalog`（`Globals.c:1396`）的 8 个 `title` 与
`src/data/mutations.json` 完全一致：explosive / infested / agile / juggernaut /
grappling / vampiric / toxic / reflective。

| 键 | 译文 | 机制依据 |
|---|---|---|
| `mutation.explosive` | 爆裂的{{name}} | `MA_DF_ON_DEATH`：死亡爆炸（CE DF_MUTATION_EXPLOSION） |
| `mutation.infested` | 感染的{{name}} | 死亡散布真菌孢子（DF_MUTATION_LICHEN） |
| `mutation.agile` | 迅捷的{{name}} | 移动耗时减半（moveSpeedFactor 0.5） |
| `mutation.juggernaut` | 蛮力的{{name}} | HP×3 / 伤害×2 / `MA_ATTACKS_STAGGER`（面板"攻击会击退目标"） |
| `mutation.grappling` | 缠缚的{{name}} | `MA_SEIZES`（面板"会抓住并束缚猎物"） |
| `mutation.vampiric` | 吸血的{{name}} | `MA_TRANSFERENCE`（面板"攻击会吸取生命"） |
| `mutation.toxic` | 剧毒的{{name}} | `MA_POISONS` + `MA_CAUSES_WEAKNESS` |
| `mutation.reflective` | 反射的{{name}} | `MONST_REFLECT_50`（与 `runic.armor.reflection`"护甲反射"同词） |

**拼接方案**：语序与连接符全部收进资源键，代码零分支——

```ts
// Monster.ts mutate()（原：this.name = m.name + ' ' + this.name）
this.name = i18next.t('mutation.' + m.id, { name: this.name, defaultValue: m.name + ' ' + this.name });
```

- 中文：`"爆裂的{{name}}"` → **"爆裂的老鼠"**（"的"在键值里，无多余空格）；
- harness 空资源：defaultValue 回退英文 `"explosive rat"`（既有约定，不是缺陷）；
- 英文语序（形容词在前）与中文语序（"的"字连接）由各自资源表达，将来加
  其他语言不需要碰代码。

**测试**：8 变异 × 8 个怪物（rat/kobold/jackal/goblin/pink_jelly/troll/wraith/
dragon，覆盖浅中深层与多字名）逐组合断言：拼接结果 == 资源键插值结果、
不含 `[A-Za-z]`、不含任何空白字符（`"爆裂的 老鼠"` 这类多空格会红）、
基础名本身已是中文。8 个变异键的存在性另有独立断言。

---

## 三、归档死键（`src/locales/zh_CN.legacy.json`）

归档脚本（仓库外临时执行，逻辑 = 扫描器的 `unreferenced` 清单）先断言
缺失=0、unresolved=0，再拆分主/legacy 两文件；`name.*` / `menu.mode.*` /
`mutation.*` 前缀键全部留在主文件（内置断言"被误归档的前缀键 == 0"通过）。

| | 归档前 | 归档后（主文件） | legacy |
|---|---|---|---|
| 键数 | 2891 | **504**（17.4%） | 2387 |
| 文件大小 | 235,223 B | **26,463 B**（−88.7%） | 208,763 B |
| 入包体积（`dist/assets/index-*.js`） | 940.21 kB（gzip 297.19） | **741.22 kB（gzip 225.39）** | 不入包 |

**实跑验证**：冒烟用例以真实 zh_CN 资源初始化 i18next，包装 `i18next.t`，
3 个 seed × 400 回合，任何一次 `i18next.exists(key) === false` 的调用（除
`ItemLoader.tn()` 对中文名的既有透传契约——`name.<纯中文>` 且 defaultValue
与键名后缀相同者——那不是漏键）都记为违规。结果：**0 违规、0 条裸键串日志**；
同文件里 8×8 变异拼接组合与全量怪物名/物品名翻译检查全绿。归档没有产生
任何新的英文回落。静态面上，"死键 = 0"也成为门测试的常驻断言（§一.4）。

`zh_CN.legacy.json` 不被任何代码 import，不进构建产物，仅留作查证
（例如二次开发时想找回 C 版旧文案）。任务书授权前提（web 副本与 C 版
`BrogueCE-master/bin/assets/zh_CN.json` 不共用文件）由验收方核实，本轮未
触碰 `BrogueCE-master/`。

---

## 四、写进项目常识

`ai_docs/project_conventions.md` §二（i18n）新增两条：
1. **新增任何 `i18next.t()` / `$t()` 调用，必须同时在 `zh_CN.json` 补键；
   `defaultValue` 只是兜底，不是"以后再说"的许可**——并注明由
   `p1_30_i18n_gate.test.ts` + `i18n_scan.ts` 测试把关，补键要求（保留插值名、
   按中文语序写句）；
2. 死键归档位置（`zh_CN.legacy.json`）与动态键前缀常驻主文件的提醒。

---

## 五、验收条款逐条对照

| 任务书条款 | 状态 |
|---|---|
| 一、新增扫描测试：静态字面量键必须存在于 zh_CN.json | ✅ `p1_30_i18n_gate.test.ts`（缺键红，见反向验证 1） |
| 一.1 动态键不误报（`'name.' + name` 等） | ✅ 前缀白名单 + 同文件追踪；`unresolved` 恒为 0（坏调用见反向验证 2） |
| 一.2 扫描排除测试文件、包含 `.vue` | ✅ 测试断言扫描清单含 `.vue`/`engine/`、不含 `test/` |
| 一.3 扫描器可输出"从未引用的键"清单 | ✅ `ScanResult.unreferenced`（归档即用它） |
| 二、自行扫描得出真实缺失清单并补齐 | ✅ 实测 79（非 60，见 §〇.1），全部补齐，译文见 §二 |
| 二.翻译质量（既有风格、保留插值、中文语序） | ✅ 见 §二说明；无英文充数 |
| 三、8 个变异名 + 解决语序 | ✅ `mutation.*` 8 键 + `Monster.ts` 一处改为插值键；测试断言无英文/无多余空格 |
| 三.核对 CE mutationCatalog 原名、译名与面板能力呼应 | ✅ 8 名与 `Globals.c:1396` 一致；juggernaut/grappling/vampiric 等对应面板能力描述 |
| 四、死键归档为 `zh_CN.legacy.json`（不删除） | ✅ 2387 键移出；主文件 504 键 |
| 四.归档不误删动态前缀键 | ✅ 归档脚本断言 0 误删；数据覆盖测试兜底 |
| 四.归档后实跑一局确认无英文残留 | ✅ 冒烟 3 seed × 400 回合 0 违规 |
| 四.报告给出键数与包体对比 | ✅ 见 §三表格 |
| 五、project_conventions.md 增补 | ✅ §二新增两条 |
| 测试 1：两条反向验证 | ✅ 真实失败输出见 §一 |
| 测试 2：8 变异 × 多怪物断言无英文/无空格 | ✅ 8×8 组合 |
| 测试 3：补齐后缺失数为 0 | ✅ 门测试断言 |
| 测试 4：不得塞英文当翻译 | ✅ 全部真中文（§二清单可逐条核） |
| 门禁：`npm test` 全绿且通过数不低于上一轮 | ✅ 508 passed，48 个测试文件全绿；本轮只**新增** 1 个测试文件（16 个用例），未改动任何既有测试（git status 可证），通过数必然只增不减。8 个 skip 全部是 p2_1/p2_2/p2_3 里既有的快照退役 `it.skip` 标记，不在本轮文件内 |
| 门禁：`npm run build` 绿 | ✅ `vue-tsc -b && vite build` 通过（chunk 大小警告为 pixi.js 既有状况） |
| 文件边界 | ✅ `git status` 仅含允许清单：`zh_CN.json`、新增 `zh_CN.legacy.json`、`Monster.ts`（仅变异名处，diff 6 行）、`project_conventions.md`、两个新增测试文件 |
| 未执行 git 写操作 | ✅ 全程无 commit/add/push/reset/checkout |

---

## 六、`npm test` 输出尾部

```
> brogue-web@0.0.0 test
> vitest run

 RUN  v4.1.11 /…/wt-p1-30/brogue-web

 Test Files  48 passed (48)
      Tests  508 passed | 8 skipped | 5 todo (521)
   Start at  14:09:32
   Duration  20.43s (transform 1.99s, setup 0ms, import 6.69s, tests 78.68s, environment 10ms)
```

## 七、`npm run build` 输出尾部

```
> brogue-web@0.0.0 build
> vue-tsc -b && vite build

dist/assets/browserAll-BWS6Hx1m.js           41.30 kB │ gzip:  10.83 kB
dist/assets/RenderTargetSystem-BYGATlLh.js   45.60 kB │ gzip:  12.57 kB
dist/assets/WebGLRenderer-BVVmub2w.js        68.42 kB │ gzip:  18.71 kB
dist/assets/index-CtxAH4TR.js               741.22 kB │ gzip: 225.39 kB

(!) Some chunks are larger than 500 kB after minification. Consider: …
✓ built in 1.37s
```
（chunk > 500 kB 警告为 pixi.js 既有体量，与本轮无关；对比实验中的
940.21 kB 为归档前重现版，见 §三。）

## 八、`git diff --stat`

```
 brogue-web/ai_docs/project_conventions.md |    8 +
 brogue-web/src/entities/Monster.ts        |    6 +-
 brogue-web/src/locales/zh_CN.json         | 2475 +------------------------------
 3 files changed, 99 insertions(+), 2390 deletions(-)

（另有未跟踪新文件：src/locales/zh_CN.legacy.json、
 src/test/i18n_scan.ts、src/test/p1_30_i18n_gate.test.ts）
```

## 九、遗留与建议（未动手，留决策）

1. **Game.ts 六条硬编码英文**（§〇.4）——需要 `src/engine/` 边界内的路由修复
   + 补键；建议下轮处理。
2. `combat.monkey_steals` 建议让调用点把怪物名传进插值（`Monster.ts`，1 行），
   译文即可升级为"{{monster}}抢起东西就逃！"。
3. 参数追踪目前**只搜同文件**（本轮 7 个变量调用点全部同文件）。若未来出现
   跨文件的变量键调用，门测试会以 `unresolved` 红——届时再扩展跨文件追踪，
   不要提前发明。
4. 卷轴外观标题（"题为「玄妙星辰」的卷轴"）与药水/奥术外观池中的中文词条
   走 `tn()` 透传，`exists()` 必为 false——冒烟已按契约豁免。若日后想统一
   成真键，属于 `ItemLoader` 侧重构，本轮未动。
