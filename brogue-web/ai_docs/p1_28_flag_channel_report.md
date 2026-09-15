# P1-28 报告：`behaviorFlags` 与 `abilities` 两套数据通道打通

日期：2026-09-15
改动文件：`src/entities/Creature.ts`（+18）、`src/entities/Monster.ts`（+43）、`src/engine/Core/Game.ts`（+16/−1，含注释）
新增测试：`src/test/p1_28_flag_channel.test.ts`（14 条，全绿）
未触碰：全部 `src/data/*.json`、全部 `src/test/fixtures/*`、`DetailGenerator.ts`、`Random.ts`、全部既有测试文件

---

## 〇、与任务书预设不符之处（开头单列，按授权反驳条款）

### 1. ★ 门禁"npm test 全绿"与既有测试 p1_24_death_sink 一条正面互斥——修复的 CE 必然后果，未修、申报

`src/test/p1_24_death_sink.test.ts` **对抗性④（续）** 把 `explosive_bloat` 放在熔岩格上，
断言它被烧死（`expected 10 to be +0`，:268）。而 explosive_bloat 在 monsters.json 与
CE（Globals.c:1085）都带 **MONST_FLIES**——CE 里 MONST_FLIES 在 initializeStatus
派生**永久 STATUS_LEVITATING**（Monsters.c:3915-3916），熔岩条款的第一豁免就是悬浮
（Time.c:183），CE 的寻路层也把 T_LAVA_INSTA_DEATH 从飞行怪的禁区里去掉
（Monsters.c:657-659 forbiddenFlagsForMonster）。**CE 的 bloat 永远不可能死于岩浆**：
本轮任何让"飞行的怪在熔岩里存活"（任务书对抗性测试第 2 条）成立的实现，
都必然使该测试红。这不是回归，是该测试的前提（"bloat 站岩浆被烧死"）在 CE 不可达。

处置：按边界规则**未动该测试文件**（P1-27 同款处理）。除它以外全量 472 绿（§七）。
需要验收方裁决改挂载体——现成方案：**CE 唯一不飞的 MA_DF_ON_DEATH 怪是 vampire**
（Globals.c:1132，web json 同样无 MONST_FLIES），把"环境致死→DF 照常触发"的载体从
explosive bloat 换成 vampire 即可在 CE 语义内成立；web 的突变系统（explosive 突变
给任意怪 graft MA_DF_ON_DEATH）也是可行载体。

### 2. 病灶确认无误，且比任务书说的更深一层：abilities 通道对真实怪物恒为空

任务书的事实全部属实（两处判定、无映射、Wisp 实测）。补充两个加重情节：

- **`abilities` 全库没有任何运行期写入者**（`abilities.add` 在 src/ 零匹配，测试除外）；
  monsters.json 里 abilities 非空的只有 troll/vampire（`['regenerating']`）与
  centaur（`['ranged']`）——**没有任何怪物带 `'flying'` 或 `'immune_fire'`**。
  即 Game.ts 三处 `abilities.has(...)` 对数据驱动的怪物**恒为 false**，不是"少映射"
  而是"通道本身死路"。
- **同一病灶还有第三处消费点**：`Monster.specificallyValidBoltTarget`（Monster.ts:119）
  的 fiery 分支读 `target.hasStatus('immune_fire')`——CE 对应处读
  `target->status[STATUS_IMMUNE_TO_FIRE]`（Monsters.c:2624），旗标怪在 CE 恒有该状态。
  web 修复前 FIRE/DRAGONFIRE bolt 把 wisp/dragon 当合法目标。本轮随方案自动修复
  （对抗性⑦）。

### 3. 任务书"明确不做"之外，本轮顺带修正了火焰分支的两处 CE 偏差（都在授权文件内，逐条给出处）

修正 `Game.ts` 火焰地形分支（:5591）时发现它相对 CE `exposeCreatureToFire`
（Time.c:28-35）有两处偏差，均已对齐并配测试：

- **多了 CE 不存在的 `!hasStatus('levitating')` 豁免**。CE 火焰地形照烧悬浮生物
  （Time.c:527 的 T_IS_FIRE 分支无任何悬浮条款；悬浮豁免只存在于熔岩/坠落/压力板/
  毒地衣四处）。保留它还会与本轮翻译层复合出**新**偏差：13 种旗标飞行怪将经派生
  悬浮获得 CE 没有的火免。已移除（对抗性⑥+玩家侧锁定）。
- **缺 MONST_INVULNERABLE 豁免**。CE exposeCreatureToFire 第三行
  `monst->info.flags & MONST_INVULNERABLE` 直接 return——Warden of Yendor 站火里
  在原 web 会被平扣血。已补齐（对抗性⑤锁定，RV4 证明牙齿）。

CE exposeCreatureToFire 的另两条豁免（MB_SUBMERGED、"非悬浮+TM_EXTINGUISHES_FIRE"）
web 无对应物（无潜水机制、无灭火地形机制），无从对齐，列为既有缺口（§五）。

---

## 一、全仓 `abilities` 排查清单（任务书必做第 1 项）

`grep -rn "abilities" src/`（.ts，含 .vue，排除注释后逐条人工判断）——引用共 3 个文件：

| 位置 | 内容 | 判定 | 处置 |
|---|---|---|---|
| Game.ts:5548（原 5541） | `isFlying = … \|\| abilities.has('flying')`（深水分支+熔岩分支共用） | **本应读 behaviorFlags（MONST_FLIES）** | 经翻译层修复（行为上）；代码原样保留（见 §二"为何不动它"） |
| Game.ts:5564（原 5557） | 熔岩分支 `!abilities.has('immune_fire')` | **本应读 behaviorFlags（MONST_IMMUNE_TO_FIRE）** | 同上 |
| Game.ts:5591（原 5577） | 火焰分支 `!abilities.has('immune_fire')` | **本应读 behaviorFlags**，且分支豁免集相对 CE 一多一少 | 同上 + 分支形状修正（§〇.3） |
| Monster.ts:948/965/1034 | `abilities.has('flying') \|\| hasBehavior('MONST_FLIES')` | 已经是双通道，**本来就正确** | 不动 |
| Monster.ts:119 | `meta.fiery && target.hasStatus('immune_fire')`（fiery bolt 目标筛选） | 通道缺口变体（status vs 旗标，非 abilities） | 经翻译层自动修复（CE 此处就读 status），对抗性⑦锁定 |
| Game.ts:179 | GameSnapshot 怪物条目 `abilities?: string[]` 字段声明 | 序列化 schema，非判定 | 不动 |
| Game.ts:5395 | `abilities: Array.from(m.abilities)`（快照序列化） | 写方向 | 不动 |
| Game.ts:5479 | `abilities: (m.abilities ?? [])`（读档回填） | 写方向 | 不动 |
| Monster.ts:196-197/229-231/306-314 | MonsterData 字段声明与数据装载 | 装载，非判定 | 不动（构造时装载后即接翻译层） |
| Combat.ts:3 | 头注释文字（"hit probabilities…"） | 非引用 | — |
| Game.ts:4700 | 注释引用 CE 原文 | 非引用 | — |

数据侧佐证：monsters.json 67 只怪中 abilities 非空者仅 troll/vampire/centaur（值
`regenerating`/`ranged`），**二者在 web 无任何读取者**（'ranged' 桩已被 P4-1b 移除，
Monster.ts:888/1132 注释在案）——是死数据，但 json 本轮禁改，只列不修。
mutations.json 无 abilities 字段（MutationData 接口亦无），且现表不含
MONST_FLIES/MONST_IMMUNE_TO_FIRE。

## 二、方案与理由（任务书必做第 2 项）

**所选方案：构造期旗标→状态归一化——任务书三个候选方向中"在构造时把 MONST_*
归一化"的变体，归一化的目标不是 abilities 通道而是 status 通道**，因为 CE 本尊
就是这么做翻层的：

- **CE 依据**：`initializeStatus`（Monsters.c:3904-3928）给旗标怪设
  `status[STATUS_LEVITATING] = maxStatus[...] = 1000`（MONST_FLIES）、
  `status[STATUS_IMMUNE_TO_FIRE] = 1000`（MONST_IMMUNE_TO_FIRE）、
  STATUS_BURNING（MONST_FIERY）、STATUS_INVISIBLE（MONST_INVISIBLE），注释
  "won't decrease"；`updateMonsterStatus`（Monsters.c:1852-1856、1963-1967）对
  **带旗标者跳过** LEVITATING/IMMUNE_TO_FIRE 的回合递减。CE 的全部下游消费点
  （熔岩、exposeCreatureToFire、深水、压力板、坠落、fiery bolt 筛选……）只读
  status 通道。
- **web 实现**：
  - `Monster.syncFlagDerivedStatuses()`（Monster.ts:354-361）：公有，构造器
    （:319）与 `mutate()`（:429）尾部调用；MONST_FLIES → `levitating`=1000、
    MONST_IMMUNE_TO_FIRE → `immune_fire`=1000。**MONST_FLITS 不翻译**（飘忽移动
    非飞行，CE 无任何状态派生）。
  - `Creature.isStatusPermanent(id)` 钩子（Creature.ts:157，默认 false）+
    `tickStatuses` 守卫（:165）；Monster 覆写（Monster.ts:364-368）复刻 CE 的
    "带旗标者不递减"。临时状态衰减路径原样（对照组测试锁定药水悬浮 3 回合照常过期）。
  - negate 后重推导（Game.ts:3237、3450）：web 的 negate 只清 statusDurations、
    不实现 CE NEGATABLE_TRAITS 的旗标临时剥离（Items.c:4483-4520），旗标恒在，
    故清空后立即回填派生状态——否则被 negate 一次的飞行/火免怪**永久**失去特性
    （CE 是临时的；web 取"旗标恒在"口径，与 negate 前行为一致，不引入新回归）。

**为什么选 status 通道而不是另外两个候选**：

1. **"读取处同时查两个 Set"** 被否：这正是病灶的成因——CE 把旗标知识集中在一处
   翻译层，下游只认 status；逐读取点双查要求每个未来判定点都记得带全两通道，
   P1-27 的验收方探针就是这么被漏掉的。且它修不了 Monster.ts:119（读 status 的
   第三处消费点）。
2. **"归一化进 abilities"** 被否：CE 没有 abilities 通道，它修不了读 status 的
   Monster.ts:119；且 abilities 的三个既有读取点里 Game.ts:5548 的 `isFlying`
   还会继续被火焰分支的错误豁免复合（见 3）。
3. **status 通道的额外红利**：a) `Game.ts` 三处读取点**代码零改动**即生效——与 CE
   "Time.c 只读 status"的形态严格同构；b) **快照往返存活**：serializeMonster 不持久化
   behaviorFlags（读档怪没有旗标，见 §六），但 statusDurations 持久化——派生免疫
   穿过存档/读档（对抗性⑨锁定；若选"读取处查 flags"方案，读档后 wisp 照样烧死）。
4. **对 abilities 既有调用方的影响面**：零破坏——abilities 的写入/读取/序列化全部
   原样；唯一语义变化是"真实怪物的 abilities 从此依旧为空"，与现状一致。
   对其它 status 读取点的影响面：全仓 `hasStatus('levitating'/'immune_fire')` 的
   读取点只有 Game.ts:2431（玩家专属，玩家无旗标，不受影响）、5548、5591 与
   Monster.ts:119——影响面即本轮修复面，无意外第三方。

**RNG 流**：翻译层不消耗任何随机数（setStatusDuration 纯写），构造器内掷骰顺序
不变——generation_baseline 全量未变红佐证（§七）。

## 三、CE 语义核对结论（任务书必做第 3 项：飞行 vs 悬浮，别混为一谈）

核对结论：**CE 里"飞行"与"悬浮"在机制层是同一个东西**——MONST_FLIES 的注释即
"permanent levitation"（Rogue.h:2069），它在 initializeStatus 落成永久
STATUS_LEVITATING，此后引擎只认 status。区别只在于：STATUS_LEVITATING 还可由
药水等临时来源赋予玩家/怪物。具体各处作用（均有行号）：

| 场景 | CE 判定 | 悬浮/飞行 | 火免 | 出处 |
|---|---|---|---|---|
| 熔岩（T_LAVA_INSTA_DEATH） | 三豁免：悬浮/火免/无敌 | 免死 | 免死 | Time.c:183-190 |
| 深水（T_IS_DEEP_WATER，渐进结算） | 偷物品+随机移位，豁免：悬浮/MONST_IMMUNE_TO_WATER | 免 | 不免（此项看 WATER 专旗） | Time.c:556-590、Monsters.c:663 |
| 压力板/DF 陷阱（T_IS_DF_TRAP） | 非悬浮才触发 | 免触发 | 无关 | Time.c:234-237 |
| 坠落（T_AUTO_DESCENT） | monsterShouldFall 看悬浮 | 免 | 无关 | Time.c:115-121 |
| **火焰地形（T_IS_FIRE）** | **exposeCreatureToFire：火免/无敌/潜水/(非悬浮且灭火地形) 豁免——无悬浮豁免** | **不免** | 免 | Time.c:28-35、527-530 |
| 毒地衣（T_CAUSES_POISON） | 非悬浮才中毒 | 免 | 无关 | Time.c:495-497 |
| MONST_FLITS | 飘忽移动：**不是飞行**，无任何状态派生，不免熔岩/陷阱 | — | — | Rogue.h:2070；web 无对应机制 |

**MONST_IMMUNE_TO_FIRE 的消费点全查**（不止熔岩）：熔岩即死（Time.c:184）、
exposeCreatureToFire 直接 return（Time.c:30，覆盖 T_IS_FIRE 地形与一切点火路径——
Combat.c:453 攻击附带点燃、Items.c:5208/7052/8085 火球等）、水面灭火不适用
（Time.c:228 是对 FIERY 的灭火豁免旁路，火免怪本就不燃烧）、updateMonsterStatus
不递减（Monsters.c:1963-1967）、fiery bolt 目标筛选（Monsters.c:2624）、
寻路禁区放宽（Monsters.c:658-661）。web 本轮接通其中三个消费点（熔岩、火焰地形、
bolt 筛选）；其余（寻路禁区等）web 无对应机制，不涉及。
**MONST_IMMUNE_TO_WATER**（eel/naga/kraken）：只作用于深水，web 深水分支已按 D2
退出生效路径且 canMoveTo 排除深水（P1-25 待裁决）——无消费点，不翻译，只列不修。
**MONST_FIERY**（wisp/salamander/flamedancer）：CE 派生永久 STATUS_BURNING；web
没有 creature 级燃烧模型（StatusId 无 'burning'，火在 web 是格子属性）——不翻译，
列入 §五缺口。**MONST_INVISIBLE**：CE 也派生永久状态，但 web 已有
`isTrulyInvisible()` 直读旗标（P4-3），翻译无增益，不翻译。
**negate 交互**：CE 的 NEGATABLE_TRAITS 含 MONST_FLIES 与 MONST_IMMUNE_TO_FIRE
（Rogue.h:2091-2092），negate 时临时剥旗、到期恢复（Items.c:4483-4520）——web 未实现
旗标剥离（既有缺口，§五），本轮保证 negate 不把临时问题变成永久问题（对抗性⑧）。

## 四、对抗性测试 → 各自捕获的错误实现（14 条全绿）

文件 `src/test/p1_28_flag_channel.test.ts`（种子 20260916，即任务书探针种子）：

| # | 测试 | 捕获的错误实现 | RV 实测失败方式 |
|---|---|---|---|
| ① | 验收核心：Wisp 站熔岩 5 回合满血存活、无 incinerated 消息（含数据双旗标与派生状态前置断言） | 改动前的 web（旗标通道死） | RV1：`expected +0 to be 18` |
| ② | 仅 MONST_FLIES 的 vampire_bat 站熔岩存活（前置断言无火免） | 只接火免、漏飞行豁免（或反向） | RV1：`expected +0 to be 18` |
| ③ | 对照组：rat 站熔岩照样烧死 + incinerated 恰 1 次 | "翻译层把所有怪都派生豁免"/熔岩分支被顺手关掉 | （RV1 下平凡通过，由方向对照保证） |
| ④ | 对照组（P1-27 回归守卫）：Warden 站熔岩继续存活 | 重构时丢 isInvulnerable 条款 | （本轮四组 RV 均未触碰该条款） |
| ⑤ | 派生状态 tick 50 次不衰减（恒 1000） | 翻译了但漏不递减守卫 | RV3：`expected 950 to be 1000` |
| ⑥ | 对照组：rat 临时 levitating(3) 三回合照常过期 | 守卫误写成"所有 levitating 永久" | （四组 RV 均未误伤临时路径） |
| ⑦ | Wisp 站燃烧格不受伤 | 火焰分支火免通道死（改动前 web） | RV1：`expected 2 to be 10` |
| ⑧ | 对照组：rat 站燃烧格每轮恰好 −2（10→6） | 火焰分支被顺手关掉/伤害额变动 | （RV1 下平凡通过） |
| ⑨ | Warden 站燃烧格不受伤 | 火焰分支缺 MONST_INVULNERABLE 豁免（改动前 web） | RV4：`expected 992 to be 1000` |
| ⑩ | vampire_bat 站燃烧格照样 −2（前置断言派生悬浮在位） | 保留 CE 不存在的悬浮豁免（与翻译层复合出新偏差） | RV2：`expected 10 to be 8` |
| ⑪ | 悬浮药水玩家站燃烧格照样 −2 且不 game over | 怪物侧删了悬浮豁免、玩家侧残留 | RV2：`expected 30 to be 28` |
| ⑫ | fiery bolt 目标筛选：Wisp 非法、rat 合法 | Monster.ts:119 通道缺口（改动前 web） | RV1：`expected true to be false` |
| ⑬ | negate 命中飞行怪：hasted 清零但 levitating 重推导回 1000，随后站熔岩存活 | negate 清状态后漏调重推导（Game.ts 两处接线） | RV1：`expected +0 to be 1000` |
| ⑭ | 快照往返后 Wisp 派生免疫存活且继续免熔岩死 | "读取处查 behaviorFlags"方案（读档怪无旗标） | RV1：`expected +0 to be 1000` |

任务书要求的四条全部覆盖：①（火免 Wisp 熔岩存活——验收核心）、②（飞行怪熔岩存活）、
③（rat 熔岩对照）、④（Warden 回归守卫）；另加排查发现的每处修复点各一条
（⑦⑨⑩⑪⑫⑬⑭）。

## 五、反向验证（真实改坏 → 真实失败输出 → 还原；每组跑完立即还原）

### RV1：翻译层空操作（`syncFlagDerivedStatuses` 首行加 `return;`）→ 恰好 8 条红

```
 × 对抗性①（验收核心）：火焰免疫的 Wisp 站在熔岩里连续多回合必须存活。…
 × 对抗性②：只有 MONST_FLIES（无火免）的 vampire_bat 站熔岩也必须存活。…
 × 对抗性③：wisp 的 levitating/immune_fire 连续 tick 50 次后必须原封不动。…
 × 对抗性④：Wisp 站在燃烧格上不受伤。…
 × 对抗性⑥：旗标飞行的 vampire_bat 站燃烧格照样受伤。…
 × 对抗性⑦：fiery bolt 的目标筛选必须把火免旗标怪排除在外。…
 × 对抗性⑧：negation 命中飞行怪后，临时状态被清、旗标派生状态必须重推导。…
 × 对抗性⑨：快照往返后 wisp 的派生免疫必须存活、且在熔岩里继续存活。…
AssertionError: expected false to be true      ← ①派生状态前置断言
AssertionError: expected +0 to be 18           ← ①②wisp/bat 被烧死
AssertionError: expected +0 to be 1000         ← ③⑤⑧⑨状态不在/未回填
AssertionError: expected 2 to be 10            ← ⑦wisp 被火焰平扣
AssertionError: expected true to be false      ← ⑫FIRE bolt 视 wisp 合法
      Tests  8 failed | 6 passed (14)
```

恰好且仅通道依赖的 8 条红；两条 rat 对照组、Warden 两条、临时衰减对照、玩家悬浮火
（不依赖翻译层）全绿——判别方向正确。

### RV2：火焰分支恢复 CE 不存在的悬浮豁免（塞回 `!entity.hasStatus('levitating')`）→ 恰好 2 条红

```
 × 对抗性⑥：旗标飞行的 vampire_bat 站燃烧格照样受伤。…
 × 对抗性⑥（玩家侧）：悬浮药水状态下的玩家站燃烧格照样受伤。…
AssertionError: expected 10 to be 8   ← bat 经派生悬浮获得 CE 没有的火免
AssertionError: expected 30 to be 28  ← 悬浮玩家免伤
      Tests  2 failed | 12 passed (14)
```

### RV3：不递减守卫失效（Monster.isStatusPermanent 恒 false）→ 恰好 1 条红

```
 × 对抗性③：wisp 的 levitating/immune_fire 连续 tick 50 次后必须原封不动。…
AssertionError: expected 950 to be 1000 // Object.is equality
      Tests  1 failed | 13 passed (14)
```

### RV4：火焰分支删掉无敌豁免 → 恰好 1 条红

```
 × 对抗性⑤：MONST_INVULNERABLE 的 Warden 站燃烧格不受伤。…
AssertionError: expected 992 to be 1000 // Object.is equality   ← Warden 被平扣 2×4
      Tests  1 failed | 13 passed (14)
```

### 还原确认

四组均以精确字符串替换还原，还原后本轮文件 14/14 绿：

```
 Test Files  1 passed (1)
      Tests  14 passed (14)
```

## 六、发现的其它问题（只列不修，均在本轮边界外或属"明确不做"）

1. **快照 schema 不持久化 behaviorFlags/abilityFlags**（Game.ts:179/5378-5395/
   5462-5481）：读档怪经合成数据重建，旗标、突变、typeId 精确性（按名字反推 id）
   全部丢失——P1-27 的 Warden 无敌豁免**读档后失效**是既有缺口。本轮派生状态经
   statusDurations 往返，熔岩/火免穿档存活（对抗性⑨）；旗标本体持久化需扩
   GameSnapshot schema（version 迁移），建议另开轮次。
2. **CE negate 的旗标临时剥离（NEGATABLE_TRAITS）未实现**：web negate 只清状态；
   本轮保证派生状态不被永久清掉，但"被消除魔法的龙暂时可被火烧"的 CE 语义仍缺。
3. **MONST_FIERY 无 creature 级燃烧模型**（CE 派生永久 STATUS_BURNING：自带火、
   点燃可燃物、水面灭火豁免等）；**MONST_IMMUNE_TO_WATER**（eel/naga/kraken）无
   消费点；**MONST_FLITS** 无对应机制。三者均不翻译，理由见 §三。
4. **abilities 死数据**：troll/vampire 的 `['regenerating']`、centaur 的 `['ranged']`
   无任何读取者（json 禁改，只列）。
5. **CE 熔岩致死的 DF_CREATURE_FIRE 火焰装饰**、深水偷物/移位、潜水——P1-24/27
   已申报，沿用。

## 七、门禁与基线变红情况（真实输出尾部）

### 7.1 全量 npm test——**472 绿 + 1 红（§〇.1 申报项）+ 7 skip + 5 todo**

```
 npx vitest run --no-file-parallelism   （npm test -- --no-file-parallelism）
 Test Files  1 failed | 43 passed (44)
      Tests  1 failed | 472 passed | 7 skipped | 5 todo (485)
   Start at  09:46:12
   Duration  34.07s
```

唯一红（真实输出）：

```
 FAIL  src/test/p1_24_death_sink.test.ts > P1-24 验收 2：水中/岩浆中死亡的死亡地形照常触发 >
       对抗性④（续）：岩浆里的 explosive bloat 烧死后照样爆燃——死亡格与四邻点燃。…
AssertionError: expected 10 to be +0 // Object.is equality
 ❯ src/test/p1_24_death_sink.test.ts:268:26
    268|         expect(bloat.hp).toBe(0);
```

数目对账：P1-27 结点 459 绿（471 总）+ 本轮新文件 14 条 = 485 总；459+14−1 红点 =
472 绿，吻合。**通过数 472 ≥ 门禁 459**；"全绿"缺的恰好且仅 §〇.1 申报的那一条，
无任何未解释红项。p1_27（10/10）、p4_3（含 wisp dies-if-negated）、p4_4（kamikaze）、
p2_3_baseline、generation_baseline、monster_damage_balance 等全部继续绿——
RNG 流未移动，基线零变红。

### 7.2 npm run build——绿

```
 > vue-tsc -b && vite build
 dist/assets/WebGLRenderer-DsIEXm-W.js        68.42 kB │ gzip:  18.72 kB
 dist/assets/index-PxqeKR4G.js               923.43 kB │ gzip: 291.35 kB
(!) Some chunks are larger than 500 kB after minification. …（既有体积提示，非错误）
✓ built in 1.44s
```

### 7.3 git diff --stat

```
 brogue-web/src/engine/Core/Game.ts  | 16 +++++++++++++-
 brogue-web/src/entities/Creature.ts | 18 ++++++++++++++++
 brogue-web/src/entities/Monster.ts  | 43 +++++++++++++++++++++++++++++++++++++
 3 files changed, 76 insertions(+), 1 deletion(-)
```

（另：新增 `src/test/p1_28_flag_channel.test.ts` 382 行，未跟踪文件。）
`git status` 复核：仅上述三个 M + 新测试文件 + 任务书 prompt（既有 untracked），
无调试残留；四组 RV 改坏全部精确还原。

## 八、验收条款逐条对照

| 任务书条款 | 状态 |
|---|---|
| 全仓排查 abilities.has(...)，清单逐条标注入报告 | ✅ §一（11 处引用逐条判定；数据侧佐证：abilities 对飞行/火免恒空、无运行期写入者） |
| 修正判定让 MONST_* 生效，方案自定、不破坏 abilities 调用方、说明理由与影响面 | ✅ §二（CE initializeStatus 翻译层复刻；abilities 全部调用方零破坏；影响面=熔岩/火焰/⑥/⑫/⑬/⑭ 六点，逐一给测试） |
| MONST_IMMUNE_TO_FIRE 消费点查全（不止熔岩） | ✅ §三（7 处消费点；web 接通 3 处，其余 web 无对应机制） |
| MONST_FLIES vs 悬浮读 CE 确认、别混为一谈 | ✅ §三（CE 中飞行=永久悬浮，机制同源；逐场景表格；FLITS 明确排除） |
| 深水 canMoveTo 不动 | ✅ 未动（P1-25 留验收方） |
| 对抗性 ≥4 条：Wisp 熔岩存活（核心）/飞行怪熔岩存活/rat 熔岩对照/Warden 回归 | ✅ ①②③④ + 额外 10 条（§四映射表） |
| 反向验证 ≥2 条真实改坏、贴输出、还原 | ✅ RV1-RV4 四组（§五），还原后 14/14 绿 |
| 每修一处配一条测试 | ✅ 翻译层①②、不衰减⑤⑥、火焰分支⑦⑧⑨⑩⑪、bolt 筛选⑫、negate 接线⑬、快照⑭ |
| 门禁 npm test 全绿 / ≥459 | ⚠️ **472 ≥ 459；非全绿——唯一红是 p1_24 对抗性④（续）岩浆 bloat，其前提（bloat 死于岩浆）在 CE 不可达，为本轮修复的必然后果，边界禁改既有测试，§〇.1 单列申报**，无未解释红项 |
| npm run build 绿、两条输出尾部贴报告 | ✅ §七 |
| 基线（fixtures）不刷新、既有测试不改 | ✅ 基线全绿未动；既有测试文件零改动（含 p1_24） |
| 与预设不符之处报告开头单列 | ✅ §〇（1 门禁互斥 + 2 通道死路加重情节 + 3 火焰分支两处 CE 偏差顺带对齐） |
