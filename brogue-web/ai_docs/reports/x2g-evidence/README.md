# X2g 证据索引

最终结论、验收项和基线登记见 [报告](../x2g.report.md)。这些文件包含实际失败与中间结果；以最终门禁摘要和冻结输入为验收结果。

- `baseline-before.json`、`drift-before.txt`、`deep-before.txt`：改动前门禁和基线摘要。
- `sources-*.json.gz`、`generation-*.json.gz`、`generation-attribution.json`：单族及入池源码快照、4种子×40层观测与归因。
- `pool-source-diff.patch`、`pool-path-differences.json`：仅入池差分及力量药水落位造成的随机流分叉。
- `ur[234]-*`、`trace-audit-summary.json`：沿原测试方法的trace候选；UR3按字段拆分，保留实际机器观察和随机差异。
- `refinement-attribution.json`、`lethal-attribution.json`、`subm-final-attribution.json`、`death-final-attribution.json`：复核修正的独立变量证据；不覆盖早期源码快照。
- `ce-oracle.c`、`ce-oracle.json`：原始C函数/算式与9040组结果；生成入口 `scripts/x2g-ce-oracle.py`。
- `original-*.test.ts.txt`、`premise-original-provenance.json`、`premises-*`、`source-premises-*`、`catalog-premises-*`、`extra-premises-*`、`discoveries-premise-*`：16份原守卫、HEAD校验、旧前提反事实、修订后结果。
- `ce-terrain-additions.json`：从CE源码独立生成的三条新增地形外观，保留既有190条黄金表。
- `negative-*`、`negatives.json`：隔离错误实现及检出结果；`lethal-test-*`记录即死流血漏接的修复前后结果。
- `browser.json`、`browser-*.png`：真实浏览器场景和已人工打开检查的全页截图；通用技能客户端的黑色canvas截图不作为视觉通过证据。
- `recapture.json`：浅/深基线各一次、UR3原方法一次的登记；UR2/4未写。复核无需再运行重捕获脚本。
- `search.json`、`tests.txt`、`source-reading-guards.json`：R∪S与源码读取守卫集合。
- `final-summary.json`、`final-gates.json`、`final-results.md`：最终完整门禁、逐文件结果。
- `frozen-inputs-before/after.json`、`complete-suite-proof.json`、`closure-coverage.json`：输入冻结与全量覆盖证明。
- `first-full/`：完整发现轮的206文件结果，保留20项失败及修复依据，不作为最终验收。
- `deferred-provenance.json`：8项既有跳过、5项既有todo所在文件与HEAD完全相同的证据。
- `source-guard-coverage.json`、`production-final-proof.json`：65份源码读取守卫的实际覆盖，以及最终111份生产文件与最后归因候选完全相同的证明。

最终冻结验收：2026-09-27 09:10:26–09:47:23（Asia/Shanghai），五项门禁全部退出0；206文件、3876通过、0失败、8既有跳过、5既有todo。959输入零变化，R∪S199/199及全部点名守卫无遗漏。

项目目录执行最终复核：`node scripts/x2g-final-check.mjs`。它完整运行build、npm test、浅层drift、深层基线与diff-check，并保存各门禁退出码；不会重录基线。
