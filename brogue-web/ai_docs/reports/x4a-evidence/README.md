# X4a 证据索引

- `full-summary.json` / `full.json` / `full.txt`：最终完整全量门禁：221 文件，4060 passed / 0 failed / 8 skipped / 5 todo，1910.810s。
- `pre-fix-full-*`、`pre-fix-full.json` / `.txt`：第一轮完整全量的四项失败，保留归因证据。
- `tsc-summary.json`、`build-summary.json`、`drift-summary.json`：冻结代码后的其他门禁，exit code、耗时、文件 hash。
- `final-audit.json`：最终执行覆盖、基线保护、hash 对应、LF、无 dist/暂存修改审计：ok=true。
- `rs-closure.json`：R 56、S 72、并集 97 文件；实际门禁覆盖无遗漏。
- `mandatory-results.json`：任务书重点、黄金 trace、原失败项与新增 X4a 的最终逐文件结果。
- `u03-counterfactual.json`、`u03-contract-delta.json`：新状态字段登记的反事实与唯一增量。
- `u19e-failure.txt`、`u19e-counterfactual.json` / `.txt`：行走拾取单变量反事实，原夹具 2/2 通过；含还原 hash。
- `fix-targeted-summary.json` / `.json` / `.txt`：修复与夹具消费者 6 文件、110/110。
- `ce-references.txt`：本地 CE 源码行号摘录。
- `interrupted-full-*`：早期主动终止轮次，不计完整执行或通过。

截图暂未生成：mimo 的共享运行时未注入 agent；Computer Use 无已连接浏览器且拒绝 Arc。已请求明确允许本地 Playwright，尚未获得答复。

获准后的准备脚本为 `node scripts/x4a-browser-evidence.mjs`；它在本地 Chrome 中挂载生产 GameCanvas/TargetBar，before 只将渲染规范化替换为 identity，after 使用正式实现，计划输出桌面/手机 × 视野内/记忆 × 前/后共 8 张 PNG，以及两种输入的投掷取消检查。脚本未执行，不构成现有截图证据。
