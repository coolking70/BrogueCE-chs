# Brogue CE ↔ brogue-web 还原度差距分析（2026-09-13）

> 目的：为"网页版忠实重构"制定基线。基于对 BrorogueCE-master（41,356 行 C）与 brogue-web/src（22,667 行 TS）的全量对照。
> 结论先行：**当前还原度约为 CE 内容量/行为的 15-20%**。核心数学公式（命中/伤害/附魔曲线）移植忠实，但被缺失的数据架空；地牢生成器与时间系统是最薄弱环节；大量物品/怪物是"数据占位、效果未实现"。

---

## 0. 最关键的一个发现：数据断层

`Game.ts:16` 引用的是 `data/monsters.json`（67 条），**该文件没有 `accuracy / defense / regen / moveSpeed / attackSpeed` 字段**，`Monster.ts:108-109` 全部落默认值 `accuracy=100, defense=0, regen=0`。

而包含全部 CE 真实数值的 `data/monsters_ce2.json`（67 条，含 accuracy/defense）和 `monsters_ce.json` 是**死文件，全仓库无引用**。

**后果**：`CombatFormulas.ts` 忠实移植的 `accuracy × 1.065^ench × 0.987^defense` 公式里，`0.987^defense` 永远不起作用（怪物防御恒 0）；troll 不回血、豺狼不加速。战斗公式是亮点但被数据架空。这是**单点修复收益最大**的一项。

---

## 1. 时间系统（根本性缺失）

| 维度 | CE | brogue-web |
|---|---|---|
| 调度 | tick 制：玩家基准 100 tick/回合，怪物各有 `movementSpeed/attackSpeed`（豺狼 50=双倍速，食人魔攻速 200，炮塔 250-400） | 所有怪物每玩家回合各行动一次 |
| haste/slow | 改变 tick 消耗（×0.5/×2），真实行动经济学 | 纯装饰状态，无任何行动影响 |
| `Time.ts` | — | 事件队列**完全未接线**，死代码 |
| 周期刷怪 | `monsterSpawnFuse` 125-175 回合到期刷 horde | 无 |
| 环境更新 | 每 100 tick 一次 `updateEnvironment` | 每回合一次 |

没有 tick 制时间系统，一切速度类机制（haste、slow、快速怪物、慢攻速重武器）都无法正确落地。**这是继数据断层之后的第二大结构性欠账。**

## 2. 怪物（67/68 种数据在，行为大面积缺失）

**能力旗标实现度**（CE 19 个 MA_ + 31 个 MONST_）：
- 已实现：MA_POISONS、MA_CAUSES_WEAKNESS、MA_HIT_HALLUCINATE、MA_HIT_DEGRADE_ARMOR、MA_HIT_STEAL_FLEE（半实现：只逃跑不偷）；MONST_ 落地 8 个（飞行、保持距离、濒死逃、水栖、不睡、火免等）
- **完全未实现**：MA_CAST_SUMMON（9 种召唤怪）、MA_CLONE_SELF_ON_DEFEND（3 种果冻）、MA_KAMIKAZE+DF_ON_DEATH（4 种膨胀怪自爆）、MA_SEIZES（沼泽怪/海妖抓取）、MA_TRANSFERENCE（吸血蝙蝠/吸血鬼）、MA_ATTACKS_PENETRATE/ALL_ADJACENT/EXTEND/STAGGER（矛/斧/鞭/锤）、MA_ENTER_SUMMONS、MA_REFLECT_100
- **没有任何怪物有远程攻击**：全部炮塔（arrow/spark/dart/flame）、哥布林召唤师/秘术师、dar 三族、食人魔萨满、巫妖、小妖精——CE 里全是远程施法者，网页版全是近战贴脸
- 特殊怪破坏性 bug：Warden of Yendor 可被普通杀死（CE INVULNERABLE）、亡魂可被武器杀死（CE IMMUNE_TO_WEAPONS）、幻影完全可见（CE INVISIBLE）、图腾会四处走动（CE IMMOBILE）

**群落数据**：`hordes.json` 132 条中 117 条被 `Game.ts:712-723` 的 flag 过滤排除，**实际可用仅 15 条**（深度 1 只有 4 条，D26 只有 2 条）；且抽取为均匀随机，**frequency 权重被忽略**（代码注释自认）。无 out-of-depth 刷怪（CE 10% 概率）。

**变异**：8 种 vs CE ~15 种（缺 juggernaut/grappling/toxic 等），且 `defenseFactor` 未应用。

**AI**：无气味图（scent map，CE 追踪核心）、无 waypoint 两级导航、无 safety map（逃跑路线）、无 per-monster 回血节奏（troll 应 1 回合回 1 HP，golem 不回血）。

**怪物光照**：CE 有 20+ 种怪物光源（鬼火、凤凰、巫妖、焰舞者……），网页版怪物不发光。

## 3. 物品装备

### 3.1 数量对齐表

| 类别 | CE | web | 缺口 |
|---|---|---|---|
| 武器 | 15（含 dart/incendiary dart/javelin 投掷系） | 12 | 投掷武器 3 种全缺 |
| 防具 | 6 | 6 | ✅ |
| 药水 | 16 | 16 | 名称齐全 |
| 卷轴 | 14 | 14 | 名称齐全 |
| 魔杖 | 9 | 7 | 缺 polymorphism、domination、plenty、negation |
| 法杖 | 12 | 7 | 缺 tunneling、blinking、entrancement、obstruction、discord、protection |
| 戒指 | 8 | 6 | 缺 light、reaping |
| 护符 | 12 | 6 | 缺 haste、fire immunity、levitation、shattering、guardian、teleportation、recharging、negation |
| 食物 | 2 | 2 | ✅（但 mango 微量治疗未实现） |

### 3.2 效果实现度

- **卷轴 5/14 有效果**，9 个纯打日志占位：teleportation、negation、sanctuary、shattering、discord、summon_monsters、protect_weapon、protect_armor、amnesia（amnesia 是网页版自创，CE 无）
- **药水 14/16 有效果**；descent 不下坠、detect magic 纯占位
- **戒指 2/6**：stealth/transference/wisdom/clairvoyance 无效果
- **护符 4/6**：且 **speed 护符有 bug——给的是漂浮（levitating）而非加速**（`Game.ts:2208`）
- **法杖伤害固定值**、无附魔成长曲线（CE：`staffDamage(e)=randClump((2+e)×3/4, 4+2.5e, 1+e/3)` 等）、无瞄准 UI（自动打最近怪）、conjuration 不召刀刃
- **附魔卷轴行为错误**：网页版自动强化已装备物品并 20% 概率赠送随机符文；CE 是玩家自选目标 +1（武器防具附带力量需求 -1）
- **投掷系统**：只有药水溅射 4 种；无投掷武器（dart/javelin 按武器命中公式结算）、无燃烧镖

### 3.3 符文（runic）

- 武器符文 9 种存在但触发率是**线性近似** `7+4×e`，CE 为 `(1-(1-p)^e)×修正`（p=0.16 speed/0.06 quietus/0.07 paralysis/0.15 multiplicity/0.14 slowing/0.11 confusion/0.15 force；高伤武器衰减、快速/迟滞武器二次变换、背刺加倍）。slaying 无类别判定无条件即死；multiplicity 未实现。存在新旧两套触发路径并存
- 护甲符文 8 种全是**固定概率**（reflection 22% 等），CE 中 multiplicity 33%/克隆数随附魔、absorption 减伤 `rand(1,e)`、reflection `1-0.85^e`、mutuality 均摊伤害等全部随附魔成长；缺 vulnerability(×2 伤害)、immolation(受击爆炸)、burden
- 有害符文（weapon plenty / armor vulnerability+immolation）未实现

### 3.4 鉴定系统

- **外观池数量错误**：8 种药水颜色配 16 种药水（一半永远"未知药水"）、8 个卷轴标题配 14 种卷轴。CE 每类一一对应并每局洗牌
- 无自动鉴定：CE 武器击杀 20 敌鉴定、防具穿 1000 回合、戒指戴 1500 回合、法杖效果可见即鉴定
- 无"最后一类推断"（tryIdentifyLastItemKinds）、无 Discoveries 发现表（显示极性与剩余频率）、无 call/命名
- 诅咒判定与深度无关这一点 CE 一致，但网页版无 protect armor/weapon、无 checkForDisenchantment（好符文 enchant≤0 消失 / 诅咒 enchant≥0 自动解除）

### 3.5 物品生成节奏

- 无 metered items 配额系统（生命药水/附魔卷轴/力量药水的出现节奏控制，CE 有 levelGuarantee 硬保证）
- 无物品放置热图（门后/密门后更富）
- 无食物保底曲线（CE `POW_FOOD[d]=d^1.35` 强制约 4 层 1 口粮）
- 金币掉落固定 +10，CE 为 `50+10d ~ 100+15d` 且按 d^3.05 产量曲线调节
- 无怪物携带物品系统（CARRY_ITEM_100/25）；网页版怪物掉落固定 4 选 1（匕首/剑/皮甲/锁甲）

## 4. 战斗系统

公式移植是全项目最忠实的部分（`CombatFormulas.ts` 明确注明移植自 CE）：

| 公式 | 状态 |
|---|---|
| 命中 `accuracy × 1.065^netEnch × 0.987^defense` | ✅ 精确（但怪物 acc/def 数据缺失架空） |
| 力量修正 ±0.25 / −2.5，netEnchant 钳制 [−20,50] | ✅ 精确 |
| clumpedRoll 钟形伤害分布 | ✅ CE 方式 |
| 伤害附魔 `×1.065^e` | ⚠ 近似：乘在骰后，CE 乘在骰范围上 |
| 背刺 ×3 + 必中 + 受害者失去回合 | ✅（匕首应为 ×5；隐形 +50% 命中是网页版自创） |
| 护甲 donning（穿戴期防御递增） | ❌ |
| weakness 修正（防 −25/w、命中/伤害 ×e^−1.5w） | ⚠ 仅作为状态，未接入公式 |
| 吸血 transference（`伤害×e/20`） | ❌（武器符文 vampirism 回 50% 是自创数值） |
| reaping 击杀充能 | ❌ |

**玩家初始状态不符**：CE 力量 12（恰好匹配匕首需求）、饥饿 2150（350/150/50 阈值）、满血回复 300 回合基准、初始装备 = 匕首+15 飞镖+皮甲+口粮。网页版饥饿 12000、饱腹 10 回合回 1HP（**比 CE 快 ~30 倍**，游戏节奏完全不同）、无初始飞镖。

## 5. 地牢生成（差距最大的模块）

CE `digDungeon` 管线（carveDungeon → 门位 → 湖泊 → 自动生成器 → 机器 → 桥 → 完成墙）vs 网页版：

| 维度 | CE | brogue-web |
|---|---|---|
| 房间数 | 35 次尝试 + 深度剖面调整（浅层多房间、深层多洞穴） | 上限 15 个 |
| 走廊 | 水平 5-15 / 垂直 2-9，15% 斜向出口 | **不生成走廊**（corridorChance 字段存在但从未使用） |
| 环路 | addLoops(20) | 无 |
| 湖泊 | 岩浆/深水+浅水环/深渊+边缘/硫矿+黑曜石 四类，flood-fill 验证不破坏连通 | 只有 blob 深浅水，**无岩浆湖、无深渊** |
| 桥 | buildABridge 按路径缩短率决定 | 无 |
| 门 | 60% 门率、按深度 0-67% 秘门率、孤儿门清理、门朝向判定 | 门 40%（一半敞开） |
| 自动生成器 | ~30 种按深度分布（火把墙 d6+、水晶墙 d14+、发光真菌 d7+、真菌森林 d13+、明/暗陷阱 15 种……） | 无对应系统（陷阱是独立 placeTraps） |
| 深层地貌 | brimstone 层 d17+、蠕虫隧道、obsidian | 无 |
| 楼梯 | 墙龛位置校验（3 墙 1 开口）、跨层对齐偏好、D40 传送门 | 随机地板格，无校验 |
| 机器 | ~50 蓝图 + 5 类 machineType + key/lock 联动 + TM_IS_WIRED 通电 + circuit breaker + 失败整图回滚 | 自研 BlueprintEngine：20 蓝图、无 wiring、commutation 祭坛不互换、锁门钥匙逻辑是最小版 |
| 连通性 | 湖/桥/DF 放置均 flood-fill/Dijkstra 验证 | 无验证 |

## 6. 环境动态

- **地形枚举 26 个 vs CE 4 层 ×~200 种**（含机器态、气体、火、覆盖物各层）。无 promoteTile 生命周期系统（草→火→烬→灰、踩踏→复原、地衣自蔓延、甲烷爆炸晋升）
- **气体 6 种 vs CE 8+ 种**：缺甲烷（可燃气，火邻爆炸——CE 标志性连锁）、麻痹气、腐烂气、黑暗云、治疗云。扩散算法是密度百分比模型，CE 是体积守恒（8 邻均值+随机舍入）+ 分类型消散率（毒 20%/tick、蒸汽等 50%/tick）
- **深水 = 即死**（CE 可游泳、50% 冲走物品、怪物可潜）；CHASM 枚举存在但**从不生成**、无坠落
- 火焰：蔓延 40% 固定 vs CE 按地形点燃率（草 15%、门 50%、网 100%）+ exposeTileToFire 算法 + 防爆炸循环护栏；无 brimstone 自燃
- 水淹机器、冰面、传送门光等地形全无

## 7. 光照与视野

- Shadowcasting FOV ✅ 移植正确，但视野半径**固定 10**；CE 视野由光照决定（`VISIBLE = IN_FOV ∧ 被照亮`），矿灯半径 `(DCOLS-1)×0.85^depth+2.25` 随深度收缩，黑暗状态立方衰减，水中减半
- **全图唯一光源是玩家火把**：无火把墙、岩浆光、怪物光（20+ 种）、真菌光、火光渐变；CE lightCatalog 有 40+ 条目（含 fade%、穿透生物标记）
- 无 clairvoyance 视野、telepathy 光；LIT/DARK 只影响潜行距离
- 记忆系统基本有（explored+memory），无 rememberedAppearance 细节

## 8. 寻路与探索

- 网页版 A* + BFS 自动探索（架构上能用）；CE 是 Dijkstra 距离图族：scent 气味图（怪物追踪核心）、waypoint（40 个锚点两级导航）、safetyMap/allySafetyMap（逃跑决策）、mapToShore（漂浮回岸）、mapToSafeTerrain。`Pathfinding.ts` 里有一个 160 行的 `DijkstraMap` 死代码
- 自动探索：CE 有探索目标场（偏向中央、物品 -10、楼梯 100）+ disturbed 中断；网页版近似可用
- 无 search 指令（CE 手动搜索 5 连发，秘门发现半径 60-160）

## 9. 盟友与周边系统

- 盟友系统最小版：钥匙开笼→盟友 + empowerment 强化。**缺**：domination 魔杖转化、俘虏营救、purgatory+复活祭坛、XPXP 心灵感应联结、盟友跨层跟随、allyFlees
- 得分公式自创（金+深度×50+击杀×10+物品+护符10000×2）vs CE（金+500×宝石，护符 35000，胜利 ×2 superVictory）
- easy 模式：45HP vs CE 受伤 ×0.2、得分 ÷10
- 无成就（feat）系统、无 high score
- 录制回放：有框架但已知行为异常待修；CE 格式 = 36 字节头 + 3/4 字节事件 + 每回合 1 字节 RNG 校验（RNG 消耗顺序是兼容命门）
- 存档不保存 levels 缓存（读档后其他层重新生成——与种子系统冲突，楼层内容会变）
- 怪物名称显示英文（zh_CN.json 是消息目录，无 name.* 键）

## 10. 网页版自创/偏离 CE 的内容（重构时需清除或重审）

1. 附魔卷轴"自动强化已装备+20% 送符文"
2. 武器符文 vampirism（CE 无此武器符文）、mercy 留 1HP（CE 是治疗 50% maxHP）
3. 护甲符文 vitality（CE 无）
4. 卷轴 amnesia（CE 无）
5. speed 护符给 levitating（bug）
6. 深水即死
7. 饥饿 12000 / 10 回合回血（节奏偏离 ~30 倍）
8. 隐形攻击 +50% 命中
9. 怪物掉落固定 4 选 1
10. 陷阱始终可见、压力板链式触发半径 3（CE 压力板喷 DF）
11. 测试模式（保留，是资产 QA 好工具，但需与 CE 行为隔离）
12. 传送/火焰陷阱的"焦地"残留

---

## 11. 重构路线建议（按"忠实还原"目标排序）

### Phase A：数据与时间地基（低成本/高回报，先行）
1. **怪物数据接线**：合并 `monsters_ce2.json` 的 accuracy/defense/regen/moveSpeed/attackSpeed 进活跃数据表，`Monster.ts` 读取真实数值
2. **tick 制时间系统**：玩家 100 tick 基准，怪物按 speed 消耗；haste/slow ×0.5/×2 接入；`Time.ts` 接线或重写
3. 玩家初始状态对齐：力量 12、饥饿 2150（阈值 350/150/50）、回血 300 回合基准（中毒禁回血）、初始装备（匕首+15 飞镖+皮甲+口粮）
4. horde 抽取接 frequency 权重，放宽 flag 过滤，补 periodic spawn fuse（125-175 回合）与 10% out-of-depth

### Phase B：战斗与物品行为真实化
5. 符文触发率换 PowerTables 公式（`(1-(1-p)^e)` 全家桶），清除旧触发路径；补 multiplicity/mutuality/vulnerability/immolation/burden
6. 武器特殊机制全套：匕首背刺 ×5、鞭射程 5、迅捷剑突刺+双速、矛/戟穿透、斧横扫、锤系击退、连枷移动攻击
7. 补齐占位物品：9 个卷轴 + 2 个药水 + 缺失的魔杖/法杖/护符/戒指（法杖伤害走成长曲线；法杖加瞄准 UI）
8. 投掷武器三类 + 燃烧镖 + 投掷命中公式
9. 鉴定系统补全：外观池一一对应洗牌、auto-ID（20 杀/1000 回合/1500 回合）、最后一类推断、Discoveries 表、call 命名
10. metered 配额 + 食物保底 + 放置热图 + 金币产量曲线

### Phase C：生成器与环境重写（最大工程，建议独立里程碑）
11. 走廊生成 + 环路 + 深度剖面（浅层房间/深层洞穴）+ 房间数提升
12. 四类湖泊（岩浆/深水/深渊/硫矿）+ 连通性 flood-fill 验证 + 建桥
13. promoteTile 生命周期 + 地形点燃率表 + exposeTileToFire
14. 气体引擎改体积守恒模型，补甲烷（爆炸晋升）/麻痹/腐烂气
15. 机器系统：TM_IS_WIRED 通电、key/lock 联动、失败回滚；至少移植奖励房 + 门卫 + AMULET_AREA 全行为
16. 光照目录 + 动态视野（光照决定可见）+ 矿灯深度衰减

### Phase D：怪物行为补全
17. bolt 系统接怪物（炮塔/施法者远程）——Bolt.ts 已有弹道动画，缺怪物侧调用
18. 召唤/分裂/自爆/偷窃/抓取/吸血/穿透/横扫/延伸/击退 全 MA_ 旗标
19. 特殊怪修正：INVULNERABLE、IMMUNE_TO_WEBS/WEAPONS、INVISIBLE、IMMOBILE、DIES_IF_NEGATED
20. AI：scent 图 + waypoint + safetyMap；变异补全 + defenseFactor
21. 怪物光源

### Phase E：盟友与收尾
22. 盟友全链路：domination、俘虏、purgatory/复活祭坛、XPXP、跨层跟随
23. 得分/easy 模式对齐 CE；成就列表
24. 存档保存 levels 缓存；回放修复（RNG 消耗顺序固定是前提）
25. 怪物/物品名称 i18n 化（zh_CN 补 name.* 键）

### 工程性清理（穿插进行）
- 删除死文件 `monsters_ce.json`（1 条损坏数据）、死代码 `DijkstraMap/EventBus/Random.rollD/weaponImageCount` 等
- `Game.ts` 4320 行需拆分（战斗结算/物品使用/生成协调/快照序列化各自成模块），否则后续移植无法维护
- 清除 §10 列出的自创行为

---

## 附：关键 CE 数值速查（重构时直接引用）

- 命中：`accuracy × 1.065^netEnch × 0.987^defense`；力量修正：富余 +0.25/点，欠缺 −2.5/点；netEnchant 钳 [−20,50]
- 满血回复 300 回合（regen 戒指 ×0.75^e）；饥饿 2150/350/150/50；食物 1800/1550
- 投距 `12+2×max(str−weak−12, 2)`；矿灯 `(DCOLS−1)×0.85^depth+2.25`
- 法杖伤害 `randClump((2+e)×3/4, 4+2.5e, 1+e/3)`；毒 `5×1.3^(e−2)`；护盾 `130×1.4^(e−2)`；haste `2+4e`；blink `2+2e`
- 反射 `1−0.85^e`；法杖回充 `(5000|10000)/e` 千分回合，wisdom ×1.3^e
- 每层物品 3+60%递增（d≤2 再+2、d≤4 再+1）；怪物 `min(20, 6+3×max(0,d−26))` + 60% 递增；spawn fuse 125-175
- 好符文触发 `1−(1−p)^(e×mod)`，mod = `1−min(0.99, 平均基础伤害/18)`；迟滞 `1−(1−c)²`；快速 `1−√(1−c)`；背刺 `min(2c,(c+100)/2)`
- metered：附魔卷轴 init60/inc30/dec50；生命药水 init0/inc34/dec150；力量药水 init40/inc17/dec50
