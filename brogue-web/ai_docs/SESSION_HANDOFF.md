# 会话交接（滚动更新，读这一份即可接手）

> **本文取代 `night_plan_2026-09-15.md`**（那份已定格为历史记录，勿参照）。
> 最后更新：2026-09-17 下午。F/G 链完成；C 链只剩 C-7；B 链做到 B-1c。
> **第三对并行：B-2（投掷）+ C-7（光照，C 链收口）跑中。**
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

- 测试：**79 文件 / 949 passed 零红**，build 绿（S-1 + C-6 后串行读数）。
  （G-1 后由验收方跑过二级串行全量，与执行方读数一致——两级门禁体系首次完整验证。）
  （串行读数 `npx vitest run --fileParallelism=false`——并行跑重型测试会集体假红。）
- **Phase D 全部完成**（P4-1 ~ P4-10）。
- **Phase C**：C-0 环路、C-1 房间剖面、C-2 湖泊、C-3 墙面与门、
  **C-4 链全部完成**（4a-0 四层模型 / 4a 属性表 / 4b DF 目录 / 4c promoteTile 与两趟驱动）。
  P1-42（密门发现）、P1-46（键位回到纯 vi）、F-0（测绘）、F-1（火焰迁层）已完成。
  **F 链火侧已走完**：F-0 测绘 ✅ → F-1 迁层 ✅ → F-2a 蔓延/寿命/产物 ✅
  → F-2b 生物燃烧状态机 + P1-44 ✅。
  **F/G 链八轮全部完成**：F-0 测绘 → F-1 火焰迁层 → F-2a 蔓延/寿命/产物
  → F-2b 生物燃烧状态机 → G-1 气体迁层与体积模型 → G-2 DF 接线与蒸汽源
  → G-3 效果与比例伤害 → F-2c 爆炸。**用户裁决的路线 A（全量对齐 CE）达成。**
  `GAS` 层从 C-4a-0 搬进来后空了四轮，G-1 填上；
  `POISON ≡ CONFUSION` 当了四轮哨兵，G-1 按 CE 让它正确破缺。

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

**★ 清单要 grep 出来，而且必须搜两段 ★**（2026-09-17 第 5 次漏授权后修正）：

第一次立这条时我只搜了"本轮的**主题**"，G-3 于是又漏了一个——
`c_4a_terrain_catalog.test.ts` 钉的是 `TERRAIN_FLAGS` 全量表，
G-3 新增 `ROT_GAS` 等地形必然打红它，但那文件**一个气体关键词都没有**。

**正确的搜法是两段并集**：

```bash
# ① 结构性穷尽表——凡新增地形/DF/枚举成员的轮次都会打红它们，与主题无关
grep -rln "TERRAIN_FLAGS\|DRAW_PRIORITY\|TERRAIN_HOME_LAYER\|\
DUNGEON_FEATURE_CATALOG\|DF_MISSING_TILES\|toEqual({" src/test/*.ts

# ② 本轮主题关键词——例如气体轮
grep -rln "GasType\|gasGrid\|addGas\|volume\|DungeonLayer.GAS" src/test/*.ts
```

**①式的当前结果（2026-09-17）**：`c_4a_0_layer_model` / `c_4a_terrain_catalog` /
`c_4b_dungeon_feature` / `c_4c_promotion` / `f_1_fire_as_terrain` /
`f_2a_fire_mechanics` / `g_2_gas_df_wiring` / `p1_42_secret_door_search` /
`p2_6_display_settings`。
**凡本轮要新增任何地形、DF 或枚举成员，这九个默认全部进允许清单。**
**再加一步：读上一轮报告的"给下一轮的登记清单"。**
F-2b 明写了"气体曲线哨兵有两份等价实现（f_2a 对抗⑪ / f_2b 对抗⑦），
G-1 改气体时两处一起翻"；F-2a 明写了"届时 p4_4 进允许清单"——
**后者我没照做，于是 F-2b 又撞了一次（第 9 起冲突、我第 4 次漏授权）。**

**授权时必须加限定**："只改因本轮行为变化而到期的断言，不许放宽守卫性质
（穷尽式 `toEqual` 仍要穷尽、阈值不许松）"，并要求逐条在报告里说明。






### ★ 哨兵欠债与还债（S-1 的教训，2026-09-17）

C-5 打翻 2 个哨兵、**C-6 打翻 13 个**——因为它们**锚定的是 RNG 流位置**。
我没有手工改那 13 个数字，而是投 **S-1** 专门还债，**结果 C-6 零冲突落地**。

**S-1 找到的隔离通道**（后续立哨兵直接复用）：
`createHeadlessGame(seed, 'test')` 的层生成走 `generateTestDepth` **合成层，
结构性绕开真实生成器**；再加"全图覆写密封场景 + 清怪清物 + **搭好后重播种**"。
`c_5` 対抗⑧ 当年自称"场景自建、流复位"却失效，**缺的正是第一件**
（场上还有怪，怪物 AI 与火共享全局流）。

**三种可选形态**（按优先级）：
1. **消耗量口径**：断言 `rng.randomNumbersGenerated` **增量**，而非结果值——
   对流位移完全免疫（B-1b 首用，C-6 实测扛住）；
2. **完全隔离场景**：合成层 + 清场 + 重播种；
3. **性质断言**：断不变量而非逐位数值（最弱，前两种不适用时才用）。

**顺带揪出一条一直在掷硬币的哨兵**：`c_5` 対抗③ 的阈值 `<0.5`
**正好压在正确实现的真值上**——`randClumpedRange(8,10,2)` 方差恰为 0.5
（注释里写的 1/3 是错的）。**看着是门禁，其实是噪音源。**

**而且改造后的哨兵更敏感**：试金石里 `b_1a` L1 立刻抓到验收方 P1-43 的过窄判据
（硬编码 `terrain === LAVA`，漏了 `INERT_BRIMSTONE`；CE 的判据是
`T_OBSTRUCTS_ITEMS | T_PATHING_BLOCKER`，而 C-4a 早就做成了 `isPathingBlocker`）。

### ★ 并行的固有成本：地图锚定的哨兵在合并时要重锚（已两次）

第一对并行（C-5 + B-1a）暴露了这个：C-5 改了地图，于是
- 合并 C-5 时，**g_2/g_3 的 FIRE-NAT 哨兵**翻红（取景点移位）；
- 合并 B-1a 时，**它自己的 A13 物品签名哨兵**翻红（签名锚在改深渊之前的地图）。

**两次都不是回归**。判据分离得很干净：
**`generation_baseline` 才是"有没有移动 RNG 流"的权威判据**——
它绿而哨兵红，就说明哨兵是地图锚定的、被另一轮的地图改动带翻。

**规矩**：
1. 合并后哨兵翻红，**先看 `generation_baseline`**，再决定是回归还是重锚；
2. **新立 RNG 哨兵请建在构造地图/固定物品集上**，只对"本轮有没有多消耗掷骰"
   敏感，对地图变化免疫（B-1b 的任务书已按此要求）；
3. 重锚时在注释里写明它是地图锚定的、以及有几份等价实现。

### ★ 跨链并行已开（2026-09-17，F/G 链收口后）

第一对是 **C-5（坠落）+ B-0（Phase B 勘察）**，选它们是因为**零冲突是构造出来的**
——B-0 是纯勘察轮，除一份新文档外不许碰 `src/` 任何文件，
所以与任何代码轮次天然不相交。

**并行时的两条纪律**（`vite.config.ts` 注释与本文档多处已记）：
1. **全量读数不可信**：两边抢 CPU 时重型测试会集体假红（全是
   `Test timed out`、零断言失败）。看到重型测试翻红**先单跑复核**。
2. **提交前的最终门禁要在没有另一轮占 CPU 时跑**，或用
   `--fileParallelism=false` 串行。

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

**第三种原因：`--mode` 传了内核不认的值（2026-09-17 踩到）。**
`zrun.sh` 的第三个参数直传内核，而内核**只认 `build` / `edit` / `plan` / `yolo`**。
验收方投 B-3 时按 Claude Code 的习惯写了 `acceptEdits`，内核回
`Unsupported --mode value: acceptEdits.` 后直接退出、不吐 JSON，
于是 PARSE_FAIL 的报错字符串与配额耗尽**一模一样**（`Expecting value: line 1 column 1`）。

所以三种 `PARSE_FAIL` 要这样分：

| 报错 | 原因 | 分辨法 |
|---|---|---|
| `Expecting value: line 1 column 1 (char 0)` | 内核没吐 JSON：**配额耗尽 或 参数非法** | 直连内核探一句，看 stderr 到底说的是 `[1308] 已达到上限` 还是 `Unsupported --mode value` |
| `Extra data: line N column 1` | 两轮并行写同一个输出文件 | 给每轮指定独立 `ZRUN_OUT` |

**教训**：`PARSE_FAIL` 之后**第一件事永远是直连内核看 stderr**，
不要凭报错字符串直接认定是配额——它至少有两种成因共用同一个字符串。
探针要用**内核认的 mode**，否则探针自己也会撞同一个坑。

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
| 1 | ~~**B-2** 投掷~~ | ✅ 已合 `829c726` | `tasks/b-2.prompt.md` |
| 2 | ~~**C-7** 光照目录 + 矿灯衰减~~ | ✅ 已合 `6c3a34a` | `tasks/c-7.prompt.md` |
| 3 | ~~**B-3** 三占位卷轴~~ | ✅ 已合 `526b9db`（全量 81 文件 1007 绿） | `tasks/b-3.prompt.md` |
| 4 | **B-4a** 生成规则——「生成什么」（**独占**，移动 RNG 流） | 🟡 跑中 `wt-b-4a` | `tasks/b-4a.prompt.md` |
| 5 | **B-4b** 生成规则——「落在哪/多少」（**独占**，移动 RNG 流） | ⬜ 待写 | 热力图落位 / 金币 / 钥匙 140-166 / 每层数量 |
| 6 | **UI/渲染轮** | ⬜ 待写、**且暂不可测** | 见下方「为什么 UI 轮被推后」 |
| — | 中小 P1：P1-39 深水可游 / P1-41 成员铺开改路径距离 / C-4a-1 收敛通行判据 / i18n 扫描器模板字符串盲区 | ⬜ | 可合并；P1-41 属生成期，应挂在 B-4b 之后 |

### 为什么 UI 轮被推后（2026-09-17 验收方勘察）

渲染逻辑全部内联在 `src/components/GameCanvas.vue`（769 行）里，
**没有任何"给定格子 → 字形/颜色"的纯函数缝**。
这意味着 UI 轮的断言只能靠挂载 Vue 组件或截图比对，
按本项目「每条断言都必须能被某个具体的错误实现打红」的标准，**做不出有效门禁**。

所以 UI 轮的正确前置是**先做一轮纯重构**：把 cell → appearance 抽成纯函数，
渲染层只负责把它画出去。抽完之后 P1-47 / EMBERS-ASH-PLAIN_FIRE / 燃烧视觉 /
地面符号才有可测的落点。**不要在没有这个缝之前投 UI 轮**——
那一轮会产出一堆无法证伪的断言。

### B-3 交给 B-4b 的登记（2026-09-17）

- `AutoGenerator.ts` 序 1 / 序 33 两条 `CRYSTAL_WALL` 缺口：**地形侧已就位**
  （B-3 新增了 `CRYSTAL_WALL` tile），但 **`DF_CRYSTAL_WALL` 仍未入 web 的 DF 目录**
  （CE `Globals.c:607` `{CRYSTAL_WALL, DUNGEON, 200, 50, DFF_CLEAR_OTHER_TERRAIN}`）。
  接线时要连 DF 条目一起补，`c_4b` 的 E1 会 31→32。**接线即移动生成流**，只能在独占轮做。
- 圣徽是**十字 5 格**（中心 + 4 正邻，CE 100/100 波前），不是单格——UI 轮注意。
- B-3 登记的 deferral：`colorFlash` 等纯视觉、`IMPREGNABLE`（唯一置位源 `BP_IMPREGNABLE`
  在机器系统，web 缺）、碎石 DF 落地（web 无 `RUBBLE`）、`freeCaptivesEmbeddedAt`、
  `charmRechargeDelay`、per-cell `ITEM_DETECTED`。

### B-4 为什么拆成两轮

原计划一轮打包，勘察后发现范围失控：CE 的 `populateItems`（`Items.c:537-800`）
同时管**生成什么**（计量表 / 加权抽取 / 附魔模型）与**落在哪、多少个**
（热力图 / 金币投放 / 每层数量），而 web 这两块**都**与 CE 不同。
一轮全做会让「允许修改」清单覆盖半个引擎，验收也无法定位是哪一半出的问题。

拆法：**B-4a = 生成什么，B-4b = 落在哪/多少**。
两轮都移动 RNG 流，**必须串行**，各自重捕获一次基线。
两次重捕获比一次巨型轮次安全得多。

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
