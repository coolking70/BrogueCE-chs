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

---

# 补做（2026-09-15，验收打回后）：p1_24 岩浆条换载体——判定不可达，改为留痕测试

> 本节是验收方对 §〇.1 申报的裁决落地："授权你改 `src/test/p1_24_death_sink.test.ts`"。
> 改动仅此一个测试文件（+95/−17），`src/engine/`、`src/entities/`、`src/data/*.json`、
> fixtures、其它测试文件零改动（反向验证的临时改坏已精确还原，见本节四）。

## 一、方案判定：方案甲不可行（遍历记录），走方案乙

任务书方案甲要求"CE 里不飞、且 deathDF 在 web 有实现"的怪。两条通道遍历：

**通道 A：monsterCatalog 固定旗标**（Globals.c，全表检索 `MA_DF_ON_DEATH`，恰 4 条）：

| 怪 | 位置 | 飞行旗标 | deathDF | web 内容实现 |
|---|---|---|---|---|
| bloat | Globals.c:1037-1038 | MONST_FLIES\|MONST_FLITS | DF_BLOAT_DEATH（毒气） | ✅ triggerDeathFeatures 毒气分支 |
| pit bloat | Globals.c:1039-1040 | MONST_FLIES\|MONST_FLITS | DF_HOLE_POTION | ❌（本轮不接） |
| explosive bloat | Globals.c:1084-1085 | MONST_FLIES\|MONST_FLITS | DF_BLOAT_EXPLOSION（爆燃） | ✅ igniteForced 分支 |
| vampire | Globals.c:1131-1132 | 无（MONST_FLEES_NEAR_DEATH\|MONST_MALE） | DF_BLOOD_EXPLOSION（血迹装饰） | ❌ web 无血迹层（P4-4 登记） |

三只有"已实现内容"的全飞 → 经 initializeStatus 派生永久悬浮 → 岩浆致死不可达；
唯一不飞的 vampire，其 DF 是纯装饰、web 无血迹层 → "照样爆燃"式内容断言无东西可断言。

**通道 B：mutationCatalog 变异授予**（Globals.c:1397-1400，`explosive`/`infested` 变异
给任意怪 graft MA_DF_ON_DEATH）：web 已实现变异系统（Game.applyRandomMutation，D11 起；
`Monster.mutate` 把 MA_DF_ON_DEATH 加入 abilityFlags）。不飞怪 + explosive 变异在 CE
完全可达（如 troll，深度 8-15 与变异深度重叠），**但它也不满足方案甲**——
`triggerDeathFeatures` 只按 typeId 认 bloat/explosive_bloat 两个内容分支，
DF_MUTATION_EXPLOSION 无实现分支，内容断言同样无东西可断言。

**结论：两通道合并后，"能死于岩浆 ∧ deathDF 内容已实现"的怪不存在，方案甲不可行，
按任务书预设走方案乙。**

## 二、原断言 → 新断言的机制映射（任务书硬要求）

原断言（对抗性④（续））考的机制：**岩浆致死走 `killCreature(monst, false)`
（Time.c:218 已复核），死亡地形不被抑制——"岩浆里就不用点火"的错误实现必须挂掉**。

该机制拆成两个半边，处置各不同：

- **闸门半边**（MA_DF_ON_DEATH 分支不被岩浆否决，Combat.c:1963-1965 已复核：
  只看 `administrativeDeath` 与 `MB_IS_FALLING`）——**由新留痕测试继续锁**：
  载体换成两个 CE 真可达的"带 MA_DF_ON_DEATH 且不飞"实例——
  ① explosive 变异 troll（D11-15 可自然出现、不飞、可走入岩浆，经真实 `mutate()` 构造）；
  ② vampire（catalog 唯一不飞的 MA_DF_ON_DEATH 怪）。二者被岩浆烧死后
  `deathEffectTriggered` 必须翻 true，"岩浆里就不用触发死亡 DF"的错误实现在此挂掉。
- **内容半边**（DF 在死亡格照常铺开）——岩浆角在 web 无载体（§一），
  **由既有深水爆燃条接管**："深水里被玩家砍死的 explosive bloat 照样爆燃"锁的是同一条
  代码路径（triggerDeathFeatures 不读地形），本轮复核该条仍然绿。
  这正是任务书方案乙指定的接管关系。

新测试共三段断言（描述文字已同步改写，与实际断言一致）：

1. **数据层锁死不可达前提**（任一变动翻红、提示恢复真实载体）：
   A1 bloat/explosive_bloat 带 MONST_FLIES 且构造即得永久悬浮（旗标来源与翻译层各锁一半）；
   A2 catalog "MA_DF_ON_DEATH 且不飞"集合恰为 `['vampire']`；
   A3 授予 MA_DF_ON_DEATH 的变异恰为 `['explosive','infested']` 且都不授予 MONST_FLIES。
2. **行为层可达半边**：变异 troll（seed 35）与 vampire（seed 36）熔岩烧死 +
   `deathEffectTriggered === true`。
3. **现状留痕**：二者死亡格与四邻不点燃、无毒气（DF 内容未实现的负向断言）——
   内容实现之日此断言翻红，届时改回真实内容断言。

非 `it.skip`、非删测试转绿：13 条 → 13 条，1:1 替换。

## 三、同文件其余测试的前提可达性核对（任务书要求）

逐条核对结论：**已核对无其它**。用 rat 的 7 条（对抗性①②③及续）——rat 无
MONST_FLIES/火免/无敌，熔岩/燃烧格/蒸汽前提全部保持可达；深水爆燃条与验收 3 两条
——死亡来自玩家近战（近战不读悬浮），且"飞行怪盘旋于水面"在 CE 可达；
验收 4 两条是玩家侧，与怪物旗标无关。本轮全文件 13/13 绿与之互证。

## 四、反向验证（真实改坏 → 真实失败输出 → 还原）

在 `Game.triggerDeathFeatures` 闸门前临时插入错误实现
`if (cell.terrain === LAVA) continue;`（"岩浆里就不用触发死亡 DF"），跑本文件：

```
 ❯ src/test/p1_24_death_sink.test.ts (13 tests | 1 failed) 149ms
     × 留痕（P1-28 验收打回后重写，原前提不可达）：岩浆致死的死亡 DF 闸门不被抑制，……
AssertionError: expected false to be true // Object.is equality
    330|         expect(carrier.deathEffectTriggered).toBe(true); // 岩浆致死不抑制死亡 DF 闸门
 Test Files  1 failed (1)
      Tests  1 failed | 12 passed (13)
```

唯一红即新留痕测试（变异载体在闸门断言上命中）；深水爆燃条保持绿（破坏只针对岩浆，
证明两半边各自独立锁着）。随后逐字还原，`git diff --stat` 复核 `src/engine/` 零残留：

```
 brogue-web/src/test/p1_24_death_sink.test.ts | 112 +++++++++++++++++++++++----
 1 file changed, 95 insertions(+), 17 deletions(-)
```

## 五、门禁（真实输出尾部）

### 5.1 npm test（--no-file-parallelism，按仓库记忆的验收口径）——绿

```
 Test Files  44 passed (44)
      Tests  473 passed | 7 skipped | 5 todo (485)
 Start at  10:12:36
 Duration  34.51s (transform 417ms, setup 0ms, import 1.71s, tests 29.42s, environment 7ms)
```

条目账：上轮 472 passed + 1 failed（即 §〇.1 那条）= 473 可跑；本轮 1:1 替换后
473 passed + 0 failed。473 ≥ 472 达标。

### 5.2 npm run build——绿

```
 dist/assets/index-PxqeKR4G.js               923.43 kB │ gzip: 291.35 kB
(!) Some chunks are larger than 500 kB after minification. …（既有体积提示，非错误）
✓ built in 1.41s
```

## 六、本轮验收条款逐条对照

| 任务书条款 | 状态 |
|---|---|
| 先判断再动手，二选一 | ✅ §一：两通道遍历后确认方案甲不可行，走方案乙 |
| 留痕测试必须真的断言点什么，不许 skip/删测试转绿 | ✅ 三段断言（数据锁 + 可达半边行为锁 + 未实现内容负向留痕），13→13 条 1:1 |
| 写明原断言考什么 → 新断言如何继续考（或由哪条接管） | ✅ §二：闸门半边由新测试锁，内容半边由深水爆燃条接管（复核仍绿） |
| 测试描述文字与实际断言一致 | ✅ 描述整段重写，逐句对应三段断言 |
| 顺带核对同文件其它测试前提 | ✅ §三：已核对无其它 |
| 文件边界（只动 p1_24_death_sink.test.ts / 新增测试文件） | ✅ diff 仅该文件；engine/entities/data/fixtures/其它测试零改动 |
| npm test 全绿 ≥472 + build 绿 + 真实输出尾部 | ✅ §五：473 passed / build ✓ |
| 报告追加到本文件、标明验收打回补做 | ✅ 即本节 |

## 七、与预设不符之处（本节任务书）

1. **任务书的遍历范围只覆盖 monsterCatalog，未提 mutationCatalog**——"CE 里唯一不飞
   的 MA_DF_ON_DEATH 怪是 vampire"在 catalog 范围内成立（已复核），但 mutationCatalog
   （Globals.c:1397-1400）的 explosive/infested 变异会给任意怪（含不飞怪）graft
   MA_DF_ON_DEATH，且 web 变异系统已实现。不改变方案判定（变异怪的 DF 内容同样无
   web 实现，方案甲仍不可行），但上一轮报告 §〇.1 里"web 突变系统也是可行载体"的
   说法仅在"闸门载体"意义上成立，在"内容断言载体"意义上不成立。
2. **"换成 vampire 后没有东西可断言"不完全成立**：DF 内容（血迹）确实无可断言，
   但 MA_DF_ON_DEATH **闸门**（deathEffectTriggered 翻 true）是 web 已实现的
   typeId 无关逻辑，对 vampire 可断言——新测试据此把闸门半边也锁上，而不只做
   数据层留痕。
3. 其余预设（行号锚点 Time.c:218 / Combat.c:1963-1965 / Globals.c 各条）全部复核
   无误。
