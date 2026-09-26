# X2b：地形派生 opaque/passable 与全层 flags 统一，并按职责核对消费者（⚠️ 可能移动生成/运行流）

> **本地执行（Mac 轨）。X-1 剩余工作 §7.1 "X2-地形派生与消费"。**

## 0. 规格

**`ai_docs/reports/x-1-survey.report.md` 的 §4 N05、§3 K42、§7.1 是权威规格**（`bd40bbc0`）：

> N05：`Grid.ts:1187–1204、1207–1237` 更新 passable/opaque 的小白名单未覆盖完整 terrain catalog；`BlueprintEngine:1613` 等真实 feature 直接写层；
> DF 专用 `DungeonFeature.ts:176–182` 会完整刷新，但不是所有写口都走 DF。自然新局 seed424242/D1：**106 格差异**（103 遮挡、7 通行）；
> 例 (1,6) TORCH_WALL passable=true/opaque=false，按全层 flags 应 false/true；FOLIAGE 也漏 opaque。
> `G:2395` FOV、:9503 视线、:9659 搜索读旧 opaque，:9408/9420 自动探索读旧 passable。
> **这不是说 CE 玩家/气味/逃跑各 cost 应使用同一布尔值**
> §7.1：按写口闭合 opaque/passable；按职责核 FOV/搜索/自动探索/推拉，保留 CE 不同 cost 口径；用自然 TORCH_WALL/FOLIAGE 样本与全层写口覆盖

## 1. 范围（**全部请自行核实 CE**）

- `Cell.isPassable/isOpaque` 的定义改为由**全部四层**地形 flags 派生（CE `cellHasTerrainFlag(T_OBSTRUCTS_PASSABILITY/VISION)` 语义），所有写层口（Grid.setTerrain/setTerrainLayer、BlueprintEngine、Architect、Lake、DF、Promotion、清层）统一刷新——或改为按需计算，二选一，以不破坏性能守卫为准
- 逐一核对每个消费者按 CE 应读的判据：FOV（`T_OBSTRUCTS_VISION`）、视线/弹道、搜索、自动探索/旅行、怪物/玩家移动、气味、逃跑图、推拉——**保留 CE 各自不同的 cost/判据口径**，不一刀切成同一布尔值
- 独立守卫：全图任意时刻"派生值 == 全层 flags 计算值"（自然生成 + 运行中晋升/DF/燃烧/开门后）；TORCH_WALL/FOLIAGE 自然样本；每个写口的正反例
- 若影响生成（生成期读 passable 的连通性/落位）→ 生成流变化

## 2. 生成流

先 drift 与 deep drift 记录 → 单变量归因（派生刷新、每类消费者各一段）→ 独立守卫 → 如有变化一次重捕获（浅层与 D27–40 深层基线分别处理）。
黄金 trace（UR2/UR3/UR4）若翻红，单变量归因后按原方法重录并登记。📌 用户裁决：生成变化不是卡点。

## 3. 约束

📌 **任务书与 CE 冲突时以 CE 为准并写明**；**撞上守卫时改代码，不改守卫**；**守卫靠旧规则才绿时**先反事实证明、只修前提、交验收方裁决；
**反查闭包含 p1_30、U24、U01/U03、U17a–f、U18a*、U19*、U26a、c_*、v_*、w_14、UR2–UR4 trace、p1_42 搜索与所有读源码守卫**；不产生 CRLF。

## 4. 门禁与报告

R∪S + build + test:drift + 深层基线；**全量 npm test 完整跑完**；最终复跑声明；基线前后哈希。报告 `ai_docs/reports/x2b.report.md`。
