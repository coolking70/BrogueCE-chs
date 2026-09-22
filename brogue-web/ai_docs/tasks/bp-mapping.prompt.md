# 蓝图权威映射轮：给全表补 `ceBlueprintId` + 覆盖守卫

> **本地执行（`codex exec --worktree`）。**
> ⚠️ **本轮的硬指标是「零生成流移动」——见 §0。**

## 0. 铁律：本轮不许移动生成流

**只加一个字段，别的什么都不改。**

- ❌ 不许改任何蓝图的 `frequency` / `depthRange` / `roomSize` / `flags` / `features`
- ❌ 不许增删蓝图条目
- ❌ 不许改 `blueprintQualifies` 的过滤逻辑
- ❌ **不许重捕获 `src/test/fixtures/generation_baseline.json`**
- ✅ 只给 `blueprints.json` 的条目**新增 `ceBlueprintId` 字段**
- ✅ 新建守卫测试；把 §3 的三行 stdout 改成断言消息

**自检（本轮的成败判据）**：`npm run test:drift` **必须绿，且不许重捕获**。
红了就说明你动了不该动的东西。

⚠️ **一个真实的陷阱**：`blueprintQualifies` 里有 `if (bp.ceBlueprintId === 52) return false;`
（CE 52 电水晶退池）。**如果你把 52 误标给别的条目，那条就会被静默退池、生成流就变了。**
`test:drift` 会抓到，但你要知道为什么。

## 1. 为什么需要这一轮

验收方今天试图算"CE 71 条覆盖了多少"，发现**算不出可信答案**：

| 方法 | 结果 |
|---|---|
| 按 `name` 逐字匹配 | 67 / 71 |
| 按 `depthRange` + `roomSize` + `flags` 全等匹配 | 54 / 71 |

两者差 13 条。更糟的是 name 匹配产生过**危险的假阳性**：

> CE **15** 与 CE **43** 的 `name` 字符串**完全相同**
> （`"Statuary -- key on an altar, area full of statues; take key to cause statues to burst and reveal monsters"`）。
> name 匹配把两条都认领给 `reward_statuary`，于是 `key_statuary` 被判为"web 自创"。
> 逐字段一查：`reward_statuary` = CE 15（freq 0、size {35,40}、`BP_PURGE_INTERIOR|BP_OPEN_INTERIOR`），
> `key_statuary` = CE 43（freq 10、size {35,90}、`BP_ADOPT_ITEM|BP_NO_INTERIOR_FLAG`）——**两条都是合法 CE 蓝图**。

差点把一条 CE 内容当自创退出生成池，**而且没有任何守卫能发现**。

⇒ 所以本轮的产物是**权威映射 + 永久守卫**，它是后续"自创退池轮"和一切进度口径的前提。

## 2. 要做的事

### 2.1 给全部 78 条补 `ceBlueprintId`

每条取值二选一：

- **CE 索引**（1-71，按 `GlobalsBrogue.c` 的 `blueprintCatalog_Brogue[]` 顺序，
  `{0}` 之后的第一条是 1）——**必须逐 feature 核实**，不能只看 name 或只看头行
- **`null`** ——确属 web 自创，**并在同条目加 `ceOrigin` 字段写明判定理由**
  （例如 `"web 自创：CE 无同主题蓝图；最接近的是 CE 19，但 depth/size/features 均不同"`）

**核实口径（按可靠性从高到低，全部要过）**：
1. 头行四元组：`depthRange` / `roomSize` / `frequency` / bp flags 全等
2. `featureCt` 相等
3. 逐 feature 的 DF / terrain / layer / 数量区间 / 最小数量 / itemCategory / itemKind /
   monsterKind / personalSpace / hordeFlags / itemFlags / feature flags

⚠️ **已知会对不上的正常情况**，遇到要如实记录而不是硬凑：
- web 早期轮次可能对某些条目做过**登记在案的留形偏差**（读该条目附近注释或历轮报告）
- `AMULET_LEVEL` / `DEEPEST_LEVEL` 在 CE 里是常量，web 侧是 26
- 9b/9c/9d 新增的条目已有 `ceBlueprintId`，**核对它们对不对**，错了就改

### 2.2 覆盖守卫（本轮的永久产物）

新建 `src/test/blueprint_ce_coverage.test.ts`，钉死：

1. **覆盖集合全等**：`{已实现的 CE 索引}` 精确等于一个显式清单，
   缺的逐条带**理由注释**（例如 CE 48 是 CE 自己 `// DISABLED. (Not fun enough.)`、
   CE 8/13/14 的状态按本轮实际）
2. **唯一性**：同一个 CE 索引不得被两条 web 蓝图认领（就是 §1 那个坑）
3. **`null` 项有理由**：每条 `ceBlueprintId === null` 必须有非空 `ceOrigin`
4. **索引合法**：所有非 null 的 `ceBlueprintId` 落在 1-71

守卫要能回答「什么实现缺陷下会翻红」——
**至少要能抓住"新增一条 web 蓝图却忘了标 `ceBlueprintId`"和"两条认领同一个 CE 号"。**

### 2.3 顺带产出（B 轮要用）

在报告里给出一张表：**所有 `ceBlueprintId === null` 且 `frequency > 0` 的条目**，
含 id / freq / depth / size / 你判定它自创的理由 / 与哪条 CE 蓝图主题最接近。

**本轮不要退它们的池**——那是 B 轮的事，会移动生成流。

## 3. 噪音清理

`src/test/v_2b_9c_effects.test.ts` 的 `:241` / `:271` / `:294` 三处
`process.stdout.write` 在每次门禁都无条件打印：

```
9c mud: built=key_mud_pit, dormant=3, awake=3
9c haunted: dormant=5, awake=5
9c darkness: before=311, after=0
```

它们是端到端证据、有价值，**但不该每轮都打**。
改成**断言消息**（`expect(x, \`...\`)` 的第二参），失败时才显示。
**不要削弱这三条断言本身。**

## 4. 授权改动清单

- `src/data/blueprints.json`（**仅新增 `ceBlueprintId` / `ceOrigin` 字段**）
- `src/types.ts`（若 `BlueprintDef` 需加这两个可选字段）
- 新建 `src/test/blueprint_ce_coverage.test.ts`
- `src/test/v_2b_9c_effects.test.ts`（仅 §3）
- 因加字段而撞红的既有测试（如有 schema/字段集断言）

**明确不许改**：`generation_baseline.json`、`BlueprintEngine.ts`、
任何引擎文件、任何蓝图的生成相关字段。
清单外改动必须申报。`BrogueCE-master/` **只读**。

## 5. 门禁跑法

```
npx vitest run src/test/blueprint_ce_coverage.test.ts
npx vitest run src/test/v_2b_9c_effects.test.ts
npm run test:drift        ← §0 的成败判据，必须绿且未重捕获
npm run build
```
外加你认为会被加字段影响的既有测试（`v_2b_2b_blueprints`、`v_1a_blueprint_items`、
`invented_content_pool` 等，自行判断并列出跑了哪些）。

⚠️ **不要跑不带参数的全量 `npx vitest run`**——13-23 分钟，且会和验收方抢核。

**最终复跑（硬要求）**：所有编辑完成后重跑上述全部，报告给逐条结果并声明
**「这是最终状态下的运行结果，不是中途快照」**。
（你上两轮用复跑前后 SHA-256 自证无中途编辑——**继续**。）

## 6. 授权反驳

**§1 的 67 / 54 两个数字都是验收方用粗脚本算的，很可能都不准。**
以你逐 feature 核实的结果为准，并指出验收方错在哪。

你已连续三轮纠正验收方并揪出既存抄录错误
（9c：`DF_ECTOPLASM_DROPLET` 抄了 `:670` 的 `UNICORN_POOP` 参数；
9d：`DF_STENCH_SMOLDER` 抄了 `:930` 的 `DF_STENCH_BURN` 参数；
9d：`addLoops` 扫描器把负值 cost 误映为 1）——**继续这样做**。
本轮逐 feature 核对全表，**很可能再撞出同类的抄录错误**；撞到就登记，
但**不要在本轮修**（改数据会动生成流），留给 B 轮。

## 7. 报告

写到 `ai_docs/reports/bp-mapping.report.md`，含：

1. **映射全表**：78 条各自的 `ceBlueprintId`（或 null + 理由）
2. §1 两个数字错在哪、正确的覆盖数是多少、缺的是哪几条及各自原因
3. **§2.3 的自创清单表**（B 轮的输入）
4. 逐 feature 核对中发现的**既存抄录错误/留形偏差**（登记，不修）
5. 覆盖守卫的四条断言各自「什么缺陷下会翻红」
6. §0 自检：`test:drift` 是否绿、是否确未重捕获
7. **§5 的最终复跑声明**
8. 清单外改动申报
