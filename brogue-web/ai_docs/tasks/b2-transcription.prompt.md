# B2 轮：抄录错列回填（16 个点位）

> **本地执行（`codex exec --worktree`）。**

## 0. 三条教训（已连续五轮验证有效，继续照做）

- **0.1 闭包**：填活 DF 的 tile 要沿 `promoteType`/`fireType`/`propagationTerrain`/
  `subsequentDF` 四条边递归走完，闭包内每个地形实跑普通与 fire 晋升要求 `deferred === null`
- **0.2 退池留形 = 加引擎过滤，不是改数据**
- **0.3 覆盖门没有观测对象时换样本，不改期望**；换样本后不钉精确台数

📌 **B1 新增一条**：**「建成 0 台」≠「RNG 足迹为 0」**。
一条蓝图只要还在抽签池里，`chooseBP` / 选址 / 失败重试就都在消费 RNG，
即使它一台都没建成过。判断影响要看**是否参与抽签**，不是看建成数。

## 1. 来源与性质

`bp-mapping` 轮（已合入 `a8a2cae`）逐 feature 核验全表时登记了一批
**既存抄录错误**，当时只登记不修（改数据会动生成流）。本轮统一回填。

**全部 16 处验收方已逐行核对 CE 原表确认属实**，行号见下。
但 §6 仍授权你驳回——**验收方只核了值，没核 web 侧是否存在登记在案的留形理由**。

## 2. E 类：错列 / 漏列（7 处）

| 代码 | CE 位置 | web 现值 → CE 原值 |
|---|---|---|
| E31 | 31/F1 `GlobalsBrogue.c:380` | personalSpace **3 → 5**；另核 `MF_NOT_IN_HALLWAY` 是否漏 |
| E39 | 39/F0 `:431` | personalSpace **3 → 2** |
| E44 | 44/F3 `:469` | personalSpace **1 → 2** |
| E40 | 40/F0–F4 `:438-442` | 五条 personalSpace 全部 **1 → 2**（⚠️ F5/F6 的 1 是对的，**不要整条统一替换**） |
| F10 | 10 头行 `:248` | frequency **8 → 12** |
| B55 | 55 头行 `:538` | flags 漏 `BP_MAXIMIZE_INTERIOR` |
| **E71** | 71/F0 `:619` | monsterId **`'MK_SENTINEL'` → `'sentinel'`** |

### ⚠️ E71 与其余六条性质不同——**它是活 bug，修完会改变行为**

`Game.resolveBlueprintMonster`（约 `:1074`）是
`allMonsters.find(m => m.id === monsterId)`，**精确匹配**。
`'MK_SENTINEL'` 在 `monsters.json` 里不存在 ⇒ 返回 `null`
⇒ **`ce_71_sentinels` 自 V-2b-8 落地至今，哨兵一只都没生成过。**

（验收方已复核：9d 的 CE 14 写的是正确的 `'sentinel'`，两轮声明不冲突，坏的只有 71 号。）

修完哨兵会真的出现，所以本轮要**额外回答**：
- 71 号现在实测建成几台？每台真的实化出哨兵了吗？（给实测数据，别只说"数据改了"）
- 哨兵是 `STATUE_INERT` 上的 `{3,3}`——**它们会不会堵死通路？** 回 CE 看 71 号的
  结构，并跑 `c_8_connectivity` 确认坏层率没变

### ⚠️ B55 的效果是**潜伏的**

CE 55（`key_worm_tunnels`）当前**被引擎过滤退池**（等隧道 DF tile，见 B1 的说明）。
所以补上 `BP_MAXIMIZE_INTERIOR` 现在**不会**改变生成，要等 55 号解锁那轮才生效。
**照样补**（数据要对），但在报告里说清它当前是潜伏的，别把它算进本轮的基线漂移成因。

## 3. D 类：漏 DF 列（5 处）

| CE | 行 | 漏的 DF |
|---|---|---|
| 6/F2 | `:225` | `DF_MAGIC_PIPING` |
| 7/F2 | `:231` | `DF_MACHINE_FLOOR_TRIGGER_REPEATING` |
| 15/F0 | `:291` | `DF_LUMINESCENT_FUNGUS` |
| 22/F0 | `:324` | `DF_MEDIUM_HOLE` |
| 28/F1 | `:363` | `DF_MEDIUM_HOLE` |

映射轮的说明：

> 4 轮报告 §3 登记前几条"FeatureDef 当时无 DF 列"，压力板也有早期留形；
> **现在有 featureDF 载体，但这些原条目尚未回填。缺列不是"DF=0"的原文。**

⚠️ **补 DF 会消耗生成随机数**——这是本轮基线漂移的主要成因之一。
⚠️ 按 §0.1 走闭包：这五条 DF 各自的 tile / `subsequentDF` 链是否都已落地？
没落地的**登记**，不要为了补列而顺手新建地形（那会把本轮变成混合轮）。

## 4. L 类：漏显式 layer（4 处）

CE 16/F0 `:300`、17/F0 `:303`、27/F0 `:358`、27/F1 `:359` 缺显式 `layer = DUNGEON`。

⚠️ **这不是格式差异，映射轮说得很清楚**：

> 当前引擎对无 layer 走 `setTerrain`，显式 layer 走 `setTerrainLayer`；
> **目标地形虽同，清其他层的语义不同**，不能当成纯格式差异擅补。

⇒ **先查清两条路径的实际差异**（`setTerrain` 会不会清掉 SURFACE/GAS 层？），
再决定补不补。**若补了会改变现有行为，要在报告里给出前后对照**；
若查清 CE 语义确实要求 `setTerrainLayer`，那就补并说明。
**这四处允许你判定"暂不补"并登记理由**——前提是给出 CE 依据。

## 5. 生成流会动——基线重捕获是最后一步

E 类（除 B55 潜伏）+ D 类必然移动生成流，L 类视 §4 结论。
**重捕获放在所有改动之后**，之后 `npm run test:drift` 必须绿。

**成因分离**（沿用 B1 的做法，它做得很好）：
①personalSpace 改动影响落位密度；②F10 频率 8→12 改变抽签权重；
③E71 哨兵开始实化改变怪物数；④D 类补 DF 消耗随机数；⑤L 类（若补）。
**能分就分，分不开就如实说分不开**——B1 的单变量实验是好范例，但不强求每条都做。

## 6. 授权反驳

**验收方只核了"CE 原值是多少"，没核"web 侧是否有登记在案的留形理由"。**
若某处是历轮**有意**的留形（读该条目附近注释与历轮报告），**驳回并给出登记位置**，
本轮不改它。映射轮自己也说过：

> 未找到历史理由不等于能证明作者当时一定无意。报告不伪造溯源归因。

你已连续四轮纠正验收方并揪出既存错误
（9c ectoplasm 错行、9d STENCH 错行与 addLoops 负值 cost、
映射轮的 `DEEPEST_LEVEL=40`、B1 的"建成 0 台≠无影响"）——**继续**。

**对抗性要求**：E71 的断言必须能区分
**"数据里写了 sentinel"** 与 **"哨兵真的实化在网格上了"**。

## 7. 授权改动清单

- `src/data/blueprints.json`（**本轮允许改**，仅 §2/§3/§4 列出的点位）
- `src/test/fixtures/generation_baseline.json`（**仅最后一步重捕获**）
- 新建 `src/test/b2_transcription.test.ts`
- 因生成流移动而撞红的既有测试

**不许**改引擎（`BlueprintEngine.ts` / `Game.ts` 等）——若 §4 的结论要求改引擎，
**停下来在报告里说明，不要动手**。
清单外改动必须申报。`BrogueCE-master/` **只读**。**守卫顺延不放宽**；
**行为断言**撞断 > 5 个停下来说明（穷举表连带不计入）。

## 8. 门禁跑法（本地）

跑新建守卫 + `blueprint_ce_coverage` + `b1_retire_invented` + 以下：
`v_1a_blueprint_items`、`v_1b_alternative`、`v_1c_machine_structure`、
`v_2a_vestibule_return`、`v_2b_2a_placement_flags`、`v_2b_2b_blueprints`、
`v_2b_3_wired`、`v_2b_4_altars`、`v_2b_5_dormant`、`v_2b_6_keys`、
`v_2b_7_features`、`v_2b_9b_environment`、`v_2b_9c_effects`、
`v_2b_9d_dungeon_profile`、`blueprint_center`、`p1_20_item_placement`、
`p1_26_invariants`、`p1_31_35_placement_snapshot`、`p1_33_machine_chokepoint`、
`p1_37_machine_flag_i18n`、`b_4b_item_placement`、`c_4b_dungeon_feature`、
`c_6_autogenerators`、**`c_8_connectivity`（E71 必查）**、`g_2_gas_df_wiring`

⚠️ **不要跑不带参数的全量 `npx vitest run`**。`npm run build` 要跑；
重捕获后 `npm run test:drift`。

**最终复跑（硬要求）**：所有编辑完成后重跑上述全部，给逐文件结果并声明
**「这是最终状态下的运行结果，不是中途快照」**。
（继续用复跑前后 SHA-256 自证无中途编辑。）

## 9. 报告

写到 `ai_docs/reports/b2-transcription.report.md`，含：

1. 16 个点位逐条：CE 原值 / web 旧值 / 处置（改了还是驳回，驳回给登记位置）
2. **E71 专节**：实测 71 号建成台数 + 哨兵实化数 + 连通性坏层率前后对照
3. §3 的闭包自查：五条 DF 的 tile / subsequentDF 链是否齐全
4. **§4 的结论**：`setTerrain` vs `setTerrainLayer` 实际差异，补/不补及依据
5. §5 基线重捕获与五股成因分离（分不开就说）
6. §6 对抗性要求的回答
7. **§8 的最终复跑声明**
8. 清单外改动申报
