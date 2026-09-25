# U21c-fix：U21c 外观/flare 与旧快照测试的对齐

> **本地执行（Windows 轨）。U21c 的修正轮。**

## 0. 起点

先在工作树根执行：`git apply -3 E:\bench\queue\u21c\result.patch`（U21c 的原始产出，**先读 U21c 报告**
`brogue-web/ai_docs/reports/u-21c.report.md`）。

## 1. 验收方裁决（已核实）

U21c 把地形外观换成 CE `tileCatalog` 原值（例如 FLOOR：`G_FLOOR` + `floorForeColor`{30,30,30} → `#4c4c4c`），
这是**正确方向**。r_1_appearance 约 19 条红，原因分两类，按下列方式处理：

1. **穷举钉死表**（"每个成员 {char,color,bgColor} 全等钉死"）：旧表是 web 自编外观。**重生成的期望值必须独立地
   从 CE 源码解析**（`BrogueCE-master/src/brogue/Globals.c` 的 `tileCatalog` + 颜色常量定义），写一个解析脚本产出
   黄金表并提交；**禁止用 web 新实现的输出反填**（那等于自证）。表中每条与 CE 的对应关系可追溯
2. **光照公式测试**（逐通道乘法、平方根压回、负通道钳位、记忆态变暗、幻觉等）：公式本身是 CE 的（C-7/R-1 已核），
   只因**用 FLOOR 作样本且写死了旧底色**而红——改为从当前底色推算期望，或改用合成样本地形；**公式断言的语义不许放宽**
3. `bgColor: null → 0` 这类表示变化：核对是否有消费者依赖 null 语义；统一一种并说明
4. **W-21 的 180ms 字形闪光断言**：W-21 当时明确登记这是"非 CE 半径 6 flare 的临时表现"。U21c 已实现 CE flare，
   该断言按 CE flare 翻正（观察性：可见接收者才闪、隐藏不泄漏的约束保留）
5. 其余 U21c 报告列出的冲突逐条按上面原则处理；若有**不属于这几类**的红，停下写清楚，不要扩大修改

## 2. 门禁与报告

R∪S 自查（含 p1_30、U24 硬串守卫、所有读源码守卫）+ `npm run build` + `npm run test:drift`；最终复跑声明。
在 `ai_docs/reports/u-21c.report.md` 追加 §「验收裁决后的测试对齐」：CE 解析脚本、逐类处理、公式断言未放宽的证明。
不产生 CRLF。
