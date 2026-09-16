# 会话交接（滚动更新，读这一份即可接手）

> **本文取代 `night_plan_2026-09-15.md`**（那份已定格为历史记录，勿参照）。
> 最后更新：2026-09-16 夜。C-4 链完成；F 链火侧走完；**G-1 已提交，G-2 跑中**。
> **每次验收通过并提交后，必须回来更新「当前状态」与「队列」两节。**

---

## 角色与工具

- **执行方**：本机 zcode 调用 GLM-5.3-Flash。**23:00–09:00 免费不限量**。
- **验收方**：Claude。写任务书、独立探针验收、裁决、提交、合并。
- 调用：`bash ai_docs/tasks/zrun.sh <任务书> <cwd> yolo`
  （自动前置注入 `ai_docs/project_conventions.md`；内核版本锚定 `0.16.5`）。
- **必须用 Bash 工具的 `run_in_background` 启动**，才有完成通知。
- **配额**：耗尽表现为 HTTP 429 → `zrun.sh` 报 `PARSE_FAIL`、退出码 1。
  诊断方法：绕过 `zrun.sh` 的 stderr 过滤直连内核跑一句 `--prompt "回复：OK"`。
  工作日 14:00–18:00 是高峰时段，积分全额扣。

---

## 当前状态（2026-09-17 凌晨）

- 测试：**71 文件 / 789 passed 零红**，build 绿。
  （G-1 后由验收方跑过二级串行全量，与执行方读数一致——两级门禁体系首次完整验证。）
  （串行读数 `npx vitest run --fileParallelism=false`——并行跑重型测试会集体假红。）
- **Phase D 全部完成**（P4-1 ~ P4-10）。
- **Phase C**：C-0 环路、C-1 房间剖面、C-2 湖泊、C-3 墙面与门、
  **C-4 链全部完成**（4a-0 四层模型 / 4a 属性表 / 4b DF 目录 / 4c promoteTile 与两趟驱动）。
  P1-42（密门发现）、P1-46（键位回到纯 vi）、F-0（测绘）、F-1（火焰迁层）已完成。
  **F 链火侧已走完**：F-0 测绘 ✅ → F-1 迁层 ✅ → F-2a 蔓延/寿命/产物 ✅
  → F-2b 生物燃烧状态机 + P1-44 ✅。
  **气体侧**：G-1 迁层 + volume 量纲 + updateVolumetricMedia ✅
  → **G-2（DF 接线 + 蒸汽源）跑中** → G-3（效果阈值与比例伤害，生物侧）
  → **F-2c（爆炸 GAS_EXPLOSION）**。
  **`GAS` 层从 C-4a-0 搬进来后空了四轮，G-1 把它填上了；
  `POISON ≡ CONFUSION` 恒等式当了四轮哨兵，G-1 按 CE 让它正确破缺。**
- **`main` 已推送到 `origin/main`**（`coolking70/BrogueCE-chs`，用户 2026-09-17 授权；
  整体开发完成后再考虑新建仓库）。每轮提交后顺手 `git push -q origin main`。
- **Phase B**：B-1 已完成；鉴定系统、投掷武器、占位物品仍欠。
- P1-37（机器旗标 + i18n 硬编码）已完成。

### 必须记住的四条（按被坑次数排序）

1. **`WATER_DEEP` 不是 `DEEP_WATER`。** 写错不报错——vitest 走 esbuild
   只剥类型不检查，运行时得 `undefined`；只有 `npm run build` 的 vue-tsc 报 TS2339。
   **任何让人困惑的测试失败，先跑 build。**
2. **连通性判据有三口径且互相矛盾**（P1-38）：`Grid.setTerrain` 的
   `isPassable`、`Game.canMoveTo`、`Pathfinding` 成本图，对 LOCKED_DOOR /
   WATER_DEEP / CHASM 的裁决各不相同。我已因此三次量错。C-4a 统一。
3. **连通性**分析**口径要放行密门**——用 `harness.analysisAllowsMove`，
   别再各写一份。依据 `Architect.c:202-203`（CE 自己就把密门当通路）。
   ⚠️ 它的前提是玩家找得到密门，而 web 的发现机制远弱于 CE（P1-42）——
   **不要用"连通性闸门全绿"论证"关卡可玩"。**
4. **桥只架深渊**（`T_CAN_BE_BRIDGED = T_AUTO_DESCENT`）。CHASM 暂不生成
   （等 C-5），所以真实关卡里桥恒 0，`buildABridge` 已忠实实现并被 6 个
   构造场景钉死。别去改它。


### ★ 一个已被验证两次的出题模式：结构先行 + 完美门禁

C-4a-0 与 C-4a 都用了同一个套路，它奏效：

1. 先只搬**结构**，刻意让**行为逐位不变**；
2. 于是可以拿 **`generation_baseline` 不重采而绿** 当门禁——
   这是个极强的自动判据，不需要人去逐条判断"这处变化是对是错"；
3. 把"行为该怎么改"的证据**作为干跑测量交付出来**（C-4a-0 交了 74 行
   跨层清除表，112,033 次事件），下一轮拿着数据逐条裁决。

**反例**：C-4 原本想一轮做完"promoteTile + DF 目录"，投不出去——
它预设了两个 web 没有的底座，执行方只能自己现造（无法验收）或硬接（更难拆）。





### ★ 留痕授权：我已连续漏了 3 次，F-2a 起改用清单法

同类冲突累计 **8 起**，其中 **3 起是验收方写任务书时漏了提前授权**
（C-4b 的 mechFlags、P1-42 的三份 C-4 留痕、F-1 的 `c_4a_0` 两张 `toEqual` 全量表）。

**写任务书前过一遍这张清单**，凡本轮会碰的一律提前列入允许范围：

| 留痕所在 | 什么时候会到期 |
|---|---|
| `c_4a_0_layer_model.test.ts` | **新增任何地形**——两张 `toEqual` 是穷尽式全量表 |
| `c_4a_terrain_catalog.test.ts` | 改任何 TerrainCatalog 取值；promote/fire 字段新增读者 |
| `c_4b_dungeon_feature.test.ts` | DF 目录改 tile；DF 子系统符号新增生产引用 |
| `c_4c_promotion.test.ts` | 晋升驱动新增消费者；状态指纹口径变化 |
| `f_1_fire_as_terrain.test.ts` | 火的红线项（EMBERS、固定 2 伤害、promoteChance 0） |
| `p1_24` / `p1_28` | 直接写 `cell.isBurning` 的地方 |

**★ 清单要 grep 出来，不要凭记忆 ★**（2026-09-16 第 4 次漏授权后补）：
```bash
# 例：G-1 要改气体，先找出所有断言气体的既有测试
grep -rln "GasType\|gasGrid\|addGas\|density\|DungeonLayer.GAS" src/test/*.ts
```
**再加一步：读上一轮报告的"给下一轮的登记清单"。**
F-2b 明写了"气体曲线哨兵有两份等价实现（f_2a 对抗⑪ / f_2b 对抗⑦），
G-1 改气体时两处一起翻"；F-2a 明写了"届时 p4_4 进允许清单"——
**后者我没照做，于是 F-2b 又撞了一次（第 9 起冲突、我第 4 次漏授权）。**

**授权时必须加限定**："只改因本轮行为变化而到期的断言，不许放宽守卫性质
（穷尽式 `toEqual` 仍要穷尽、阈值不许松）"，并要求逐条在报告里说明。



### ★ 验收成本：两级门禁（2026-09-16 实测立规）

**实测**：基线 + 三个坏层闸门 = **78 秒**；`--fileParallelism=false` 全量 = **1108 秒**。
差 14 倍。而单轮约 100 分钟里，串行全量一项就占我验收时间的 62%。

**一级（每轮必跑，2–3 分钟）**：
```bash
npx vitest run <本轮新增的测试> <本轮改过的既有测试> \
  src/test/generation_baseline.test.ts \
  src/test/p1_26_invariants.test.ts \
  src/test/p1_29_lake_connectivity.test.ts \
  src/test/p1_33_machine_chokepoint.test.ts
npm run build
```
⚠️ **必须包含本轮改过的既有测试**，以及执行方报告里预告会受影响的那些，
否则回归会从缝里漏过去。

**二级（每 3 轮一次 / 扫荡型轮次之后 / 阶段收口前，18–19 分钟）**：
```bash
npx vitest run --fileParallelism=false
```

**风险与兜底**：一级漏掉的回归最多潜伏 3 轮。因为每轮都有独立的 `round/*` 分支
与单独提交，二级翻红时定位是 O(3) 的翻查，不是大海捞针。
**每轮仍然照常 push**（耐久性优先），二级不通过就立刻回头修。

### ★ 合并方式：`git merge --squash`，不要拷文件（2026-09-16 立）

以前我是从工作树 `cp` 文件到 main，两个毛病：
- 无法处理两轮改同一文件的不同区段；
- **`git checkout <branch> -- <path>` 会把该路径下所有文件都拉过来**，
  包括轮次没碰的——我因此误回退过一次 `SESSION_HANDOFF.md`。

**新流程**：
```bash
# 1. 执行方禁止 git 写操作，所以由验收方先快照到 round 分支
cd <worktree> && git add -A brogue-web && git commit -m "wip(<轮次>): 执行期快照（未验收）"

# 2. 回 main 做真正的三方合并（squash：一轮一个干净提交，但合并语义完整）
cd <main> && git merge --squash round/<轮次>

# 3. 验收方的修正直接改在工作区，然后一次提交（写完整验收信息）
git commit -F -   # 病灶 / CE 行号 / 探针证据 / 执行方纠正了我哪些错
git push -q origin main
```

**好处**：两轮改同一文件的不同区段时 git 自动三方合并；冲突会显式报出来而不是
被拷贝静默覆盖；`wip` 快照本身也是防 `/private/tmp` 丢失的保险（见下一节）。

### ★ 并行规则修订：看 hunk 分布，不看文件清单（2026-09-16 实测）

旧规则"只并行允许清单真正不相交的轮次"太保守。实测 `Game.ts` 的改动分布：

| 轮次 | hunk 数 | 位置 |
|---|---|---|
| P1-42 | 7 | 455 / 2497 / 4074 / 5291 / 5529 / 6388 / 6415 |
| C-4c | 6 | 29 / 335 / 2742 / 2782 / 5427 / 6351 |
| **F-1** | **32** | 横跨 2 → 6822 |

P1-42 与 C-4c **零重叠**，配 `git merge` 可以干净并行；F-1 那种**扫荡型**和谁都冲突。

**新规则**：
- **扫荡型轮次（广泛触及一个子系统）独占**，不与任何轮次并行；
- **手术型轮次（约 10 个 hunk 以内）可以同文件并行**，靠 `git merge` 收口；
- **依赖链内一律串行**（F-2b → F-2c → G-1 → G-2：下一轮要等上一轮合并）；
- **并行度上限仍是 2**——验收是串行的，我是瓶颈，N>2 零收益；
- **绝不并行两个都移动 RNG 流的轮次**（这条不变）。

**跨链并行的时机**：F/G 链走完、进入 C 链（C-5/C-6/C-7）与 Phase B 那批
天然独立的工作时再开。用户 2026-09-16 明确表态：宁可一次一件事妥善做完，
也不要为提速制造半成品。

### ★ 配额耗尽的确切诊断法（2026-09-16 实测）

`zrun.sh` 报 `PARSE_FAIL` 时**不要猜**，直连内核探一句：

```bash
node /Applications/ZCode.app/Contents/Resources/glm/zcode.cjs \
  --prompt "回复：OK" --mode yolo --json 2>&1 | head -c 400
```

实测返回：`ProviderBusinessError: [1308][已达到 5 小时的使用上限。
您的限额将在 <时间> 重置。]`——**除了 23:00–09:00 的免费窗口，还有一条
5 小时滚动上限**，交接文档此前只记了前者。

`PARSE_FAIL` 的机理：内核只吐错误、不吐 JSON，`/tmp/zrun-last.json` 为空，
zrun.sh 的 python 解析段抛异常（`zrun.sh:38`）。所以 `PARSE_FAIL` = 内核没出 JSON，
配额只是其中一种原因，别直接等同。

**撞限额时活可能已经干完了**：F-2a 就是在吐最终回复那一步挂的，
报告无占位符、门禁章节已填。**先读报告判断完整度，再决定重跑**。

### ★ 执行方进程被杀时，产物不会丢——但要主动快照

2026-09-17 会话结束时 P1-42 的 zcode 进程被杀，停在"回填全量测试输出"那一步。
**文件都还在**（进程死不删工作树），且验收方在会话结束前把工作树快照成了
`wip(P1-42)` 提交，所以零丢失。

**规矩**：
1. 工作树在 `/private/tmp/...`，那是临时目录（**重启会清**）。
   网络切换不影响它，重启会。
2. 长轮次跑到一半时，若预见会话可能中断，**先 `git add -A && git commit` 一次
   wip 快照到 round 分支**——工作树共享主仓 `.git`，快照后内容进对象库，
   不再依赖 `/tmp` 存活。提交信息里写明"未验收、不得合并"。
3. 被杀的轮次先**读它的报告判断完整度**，别急着重跑：
   P1-42 那次八节全写完、验收对照表逐条填好，只差最终门禁——
   而最终门禁本来就是验收方自己跑的。

### ★ 全量门禁改用串行

`npx vitest run --fileParallelism=false`。并行时重型测试会集体假红
（全是 `Test timed out`、零断言失败），F-0 那轮误判成"714 零红不可复现"，
实际是另一轮在并行占 CPU。串行慢但读数干净。

### ★ 一个反复出现的判断：这一轮做了会不会是空壳？

C-4c 之后我差点直接投 C-4d（接线机器），查了才发现 **web 只有 `PRESSURE_PLATE`
一个带 `TM_IS_WIRED` 的地形**——CE 那套要靠闸门/笼子/拉杆/炮塔，web 全没有。
做了就是又一个空壳，和硫矿点不着一个毛病。

**出题前先查"这一轮的机制在 web 今天有没有载体"。**
C-4c 的实测已经给了现成的盘点法：`promoteChance` 活的只有 3 条、
负值（扩散型）载体 0 条、`fireType` 轴整体休眠。
同样的盘点应该在投任何"移植某机制"的轮次之前做一遍。

### ★ C-4c 起，「逐位不变」那个门禁失效了

C-4a-0 / C-4a / C-4b 能拿"`generation_baseline` 不重采而绿"当门禁，是因为
它们只搬结构。**promote 是回合期的事，而 baseline 只测量生成期**——
所以 C-4c 之后 baseline 大概率仍绿，**但那不再是"没改坏"的证据**。
从 C-4c 起，判据换成"实测影响报告 + 既有玩法测试"，
且**既有玩法测试翻红时不许调断言改绿**，必须逐条判"回归"还是"CE 行为首次生效"。

### ★ C-4b 查明的两条硬前提（C-4c 及之后必须守）

1. CE `promoteTile` **先清层再 spawn，且 `abortIfBlocking = false`**——
   这是 DOOR（drawPriority 8）能晋升 OPEN_DOOR（25）而不被 `fillSpawnMap`
   优先级判据挡住的唯一原因。
2. CE `spawnMapDF` **不检查"已标记"**，`probDec = 0` 的非 GAS 输入会**无限震荡**。
   CE 目录里所有走扩散的条目都满足 `probDec > 0`——**隐含输入约定**。
   手搓合成 DF 条目踩到 `dec = 0` 就是死循环，不是断言失败。

### ★ 「能不能走」全库有五套答案（C-4a 实测，我原先写错了机制）

`Grid.setTerrain` 的 `isPassable` 是本体，然后四个消费方**各打各的补丁**：
`Scent.ts:37/48` 加 CHASM/LAVA/WATER_DEEP；`SafetyMap.ts:118/347` 减
SECRET_DOOR 与 CHASM；`WaypointMap.ts:235/352` 只减 SECRET_DOOR。
`Pathfinding.calculateMap` **生产零调用点**（P4-9 后各消费方自算 cost 走 `batchScan`），
所以我原先"Pathfinding 继承了错口径"的说法是错的。
C-4a 已把 `canMoveTo` / `terrainAllowsMove` 迁为查 `TerrainCatalog`；
**真正的翻转点是 `setTerrain` 的启发式**，归 C-4a-1。

### ★ 出题时的自知之明：不要手抄 CE 数据表

C-4a-0 那轮我手抠归属层表，把 CHASM_EDGE 与 OBSIDIAN 按 drawPriority
同档猜成 SURFACE，实际是 LIQUID（`Globals.c:627` 的 DF 条目白纸黑字）。
**我在"照抄 CE 表格"上的错误率高于执行方。**
C-4a 的任务书因此刻意**不给任何 CE 数据表**，只定结构与门禁，表由执行方抽取。

### ★ 写探针前先读这一段（我已栽四次）

**优先跑既有闸门，而不是手搓探针。** p1_26 / p1_29 / p1_33 是前几轮写的，
新一轮一律禁改它们——跑它们本身就是独立验证，且它们的判据已经调对了。

手搓时的四个坑，我全踩过：
- `createHeadlessGame` + `generateDepth` 走**测试模式**的 `generateTestDepth`
  早返回路径，生成不出机器。真实生成要
  `rng.seedRandomGenerator(seed)` + `new Architect()` + `arch.generateLevel(d)`。
- 洪泛起点别取"扫描序第一个可走格"，那格可能是孤立口袋。
- 洪泛**不要在遍历时挡住机器格**——路径可以合法地穿过前厅一类机器内部；
  p1_33 用例 f 的做法是穿过去、只要求非机器可走格可达。
- 用 `cell.isPassable` 或漏掉 `LOCKED_DOOR` 都会让 bug 隐形。

### ★ 并行执行期间，全量测试结果不可信

实测教训：`invented_content_pool` 单独跑 6/6 绿、耗时 **53 秒**，而当时全局超时 120 秒；
C-2 的 zcode 在另一 worktree 里也反复跑 vitest，两边抢 CPU，于是
`armor_model_effect` / `horde_terrain_spawn` / `invented_content_pool` /
`monster_stats_effect` / `p1_29` 这些**重型长跑测试集体超时翻红**。发生过两次。

**C-2 后已治本**：`vite.config.ts` 的 `testTimeout` 上调至 **300s**、`hookTimeout` 120s。
理由与代价写在该文件注释里——**假红比慢更有害，它训练所有人把红灯当背景音**；
代价是真正挂死的用例要 300s 才浮出水面。

**规矩仍然有效**：
1. 执行方在跑时，全量读数只作参考；
2. 看到重型测试翻红，**先单独重跑该文件**再下结论；
3. **提交前的最终门禁必须在没有执行方占用 CPU 时跑一遍**。

已知重型测试（单跑耗时实测）：`c_0_add_loops` **148s**、`p1_29_lake_connectivity` 71s、
`invented_content_pool` 52s，另有 `armor_model_effect`、`monster_stats_effect`、
`horde_terrain_spawn`、`p1_33_machine_chokepoint`。**没有一个声明显式超时**，全靠全局值。

## 队列

| # | 轮次 | 状态 | 任务书 |
|---|---|---|---|
| 1 | **G-2** GAS 层 DF 接线 + 蒸汽源 + 燃气烧完留火 | 🟡 跑中 `wt-g-2` | `tasks/g-2.prompt.md` |
| 3 | **G-3** 气体效果阈值 + 比例伤害（生物侧，形状同 F-2b） | ⬜ 待写 | |
| 4 | **F-2c** 爆炸 GAS_EXPLOSION（**p4_4 届时进允许清单**，F-2b §十.1 已预告） | ⬜ 待写 | 须在 G-2 之后 |
| 3 | **F-2c** 爆炸 GAS_EXPLOSION（§5.3-12，P4-4 登记的缺口） | ⬜ 待写 | 需气体侧，宜在 G-1 之后 |
| 4 | **G-1** 气体迁层 + volume 量纲 + updateVolumetricMedia（含 P1-45 幽灵气） | ⬜ 待写 | G-0 已由 F-0 代替 |
| 5 | **G-2** 24 条 GAS 层 DF 接线 | ⬜ 待写 | |
| 5 | **C-4d** 接线机器 | ⬜ **降级** | web 只有 PRESSURE_PLATE 一个 TM_IS_WIRED 地形，现在做是空壳 |
| 3 | **C-4a-1** 收敛"能不能走"的五套答案 + 放开单层不变式 | ⬜ 待写 | 输入=C-4a-0 的 74 行表 + C-4a 的 10657 格分歧表 |
| 5 | **P1-42** 密门发现机制对齐 CE（**优先级高**） | ⬜ 待写 | 挡着"可玩性"结论 |
| 6 | **C-5** 坠落子系统（吸收 P1-22）—— 解禁 CHASM 与桥梁 | ⬜ 待写 | 大工程 |
| 7 | **C-6** runAutogenerators ｜ **C-7** 光照目录 | ⬜ 待写 | |
| — | Phase B 余项：鉴定系统 / 投掷武器 / 占位物品 | ⬜ | 大工程 |
| — | P1-39 深水可游 ｜ P1-41 成员铺开改路径距离 ｜ P1-43 蓝图选址避有害地形 | ⬜ | 中小 |

**并行配对规则**：只并行"允许修改"清单真正不相交的轮次；
**绝不并行两个都移动 RNG 流的轮次**；最多 2 个并发；**验收一律串行**。

---

## 未决条目（路线图有详条）

| 条目 | 一句话 | 轻重 |
|---|---|---|
| P1-37 | 宝库地板用 `CHARRED_FLOOR` 冒充 `IS_IN_MACHINE`，玩家会看到"烧焦的地面" | 中 |
| P1-25 | 击退落点判据用 `canMoveTo`，深水/熔岩口径不一致 | 中 |
| P1-14/15/16 | 饥饿行为 / `isProtected` 消费点 / 3 个占位卷轴 | 低 |
| — | `Game.ts:3510-3594` 有六条**完全没走 i18n** 的硬编码英文 | 中 |
| — | 突进的"猛烈突刺"专用措辞需加 i18n 键（B-1 登记） | 低 |

---

## 验收流程（每轮照做）

1. `git status --porcelain` + `git diff --stat` 查越界。
2. 全量测试 + build。**注意上面那条"并行期间读数不可信"。**
   执行方可能用"N passed"掩盖红项——自己看完整输出确认 `failed` 为 0。
3. **写独立探针**放 `src/test/zz_probe_<轮次>.test.ts`，**跑完务必删掉**。
4. 通过则提交（写清病灶、CE 行号、探针证据、未实现项、执行方纠正了我哪些错）；
   不通过则打回，说清"哪条断言、期望什么、实测什么、死路在哪"。
5. 探针撞见的**本轮范围外**的 bug，记进路线图并单独提交，不要顺手改。
6. **回来更新本文件的「当前状态」与「队列」。**

### ★ 探针的铁律

**打在真实生成的关卡/真实数据上，不能只复核执行方的人造场景。**
P4-9 有 7 条对抗性测试全绿，而真实关卡上 safety map 是整张平图、
`safetyNextStep` 在 60 个抽查格上给出方向 0 个。只复核它的场景就会放过去。

### ★ 阈值与基线的区别

- **基线重捕获**（记录当前状态）——有意变更后由验收方授权，正常。
- **放宽阈值**（削弱判据本身）——**必须论证新阈值仍有牙**：依据是什么、
  什么样的错误实现仍会被抓住，并写对抗性测试实证。
  C-1 那轮正是因为坚持这条，才查出"9.7% 阈值被击穿"其实是断言自身的**累计测量 bug**。

---

## 验收方自己反复踩的坑

1. **怪物之间默认非敌对**（`monstersAreEnemies`）——探针验怪打怪，攻击者要 `isAlly = true`。
2. **单次攻击会因命中掷骰 miss**——按单次断言即统计脆弱，改累计 N 次。
3. **叫错函数层**——几何攻击分"构建命中表 / 单目标结算"两层，要走真实入口。
4. **量错判据**——`canMoveTo` 排除的是 GRANITE/WALL/SECRET_DOOR/**LOCKED_DOOR**/**WATER_DEEP**
   （熔岩不排除）。用 `cell.isPassable` 或漏掉 `LOCKED_DOOR` 都会让 bug 隐形，两次都栽过。
5. **凭函数名和一处调用点下结论**。已因此写错：PDS 常量（CE 是 −1/−2 不是 30000/29999）、
   湖泊重试次数（20 不是 9）、`setUpWaypoints` 的种子隔离（CE 整段生成隔离、对主流零扰动，
   我错了三个版本）、"复用 P4-6 函数"却把那些函数所在文件列为禁改。
   **动手前把调用点上下文打开读完。**
6. **留痕测试与文件边界的系统性冲突**——已四次。见 `project_conventions.md` 新增的那一节。

---

## 已知代码坑

- `Pathfinding.ts` 的 `PDS_OBSTRUCTION=30000`/`PDS_FORBIDDEN=29999` 与 CE 的 −2/−1 不符，
  但文件内部自洽且有别的调用方——**不要纠正**，新代码用 `CE_PDS_*` / `WP_PDS_*`。
- `behaviorFlags` 与 `abilities` 是两个 Set；**`abilities` 全库无运行期写入者**，是死通道。
  旗标经 `syncFlagDerivedStatuses`（CE `initializeStatus`）翻译成状态生效。
- **`loopMap` 必须始终等于当前网格的 `analyzeLoopMap` 结果**——这个不变式已在四处漏过：
  `generateTestDepth`(P1-34)、`loadSnapshot`(P1-35)、waypoint 距离图、气味图。
  **新增任何"生成期派生态"时，检查所有重建网格的路径。**
- `environment.ignite()` 只点燃草/植被/沼泽/门；无视地形点火用 `igniteForced()`。
- `GasType.FIRE` **零读者但有一个写者**（F-0 修正）：`Game.ts:2872` 的
  `creeping_death` 药水 `addGas(x, y, 1, 100)` 喷的是"幽灵气"——不渲染、
  无效果、却占格扩散并挡住真气体（P1-45）。火焰伤害的真实来源仍是 `cell.isBurning`。
- 伤害记法 `"XdY"` → `{min:X, max:X*Y, clumping:X}`，**不是 min-max**。
- i18n：`defaultValue` 是无声降级通道。P1-30 已装红灯（扫描所有 `t()` 键），
  但**对硬编码英文字符串无效**。

---

## 项目决策速查

D1 行为一律照 CE，不调参凑手感 ｜ D2 自创内容保留代码但退出实际游戏 ｜
D3 大改先出方案文档再动手 ｜ D4 brogue-web 独立、不与其他项目共用文件 ｜
D5 `brogueweb/` 已封存 ｜ D6 `BrogueCE-master/` 只读参考

**执行方的 git 权限**：只读查询（`status`/`diff`/`log`）允许；
写操作（`commit`/`branch`/`merge`/`checkout`）禁止，由验收方负责。

详见 `ai_docs/dev_roadmap_2026Q3.md` 开头与 `ai_docs/phase_c_generator_proposal.md` §九。
