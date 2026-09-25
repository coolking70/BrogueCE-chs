# U17a 证据索引

最终：165文件、3334 passed / 0 failed / 8 skipped / 1 todo；build、drift通过。545输入不变，四滚动基线不变，未提交。总核对见 verification-summary.json。

- 最终门禁：final-gates.json、regression-final.txt/json、build-final.txt、drift-final.txt。
- 输入冻结：frozen-inputs-before/after.json；frozen-input-differences.json 必须为空。
- 回归闭包：tests.txt、search.json、legacy-accesses.json、documentation-hits.json。
- 基线：baseline-before.sha256、baseline-after.json、baseline-comparison.json；未重捕获。
- 生成观测：generation-*.json.gz、generation-differences.json、inputs-*.json、attribution-final.txt、final-attribution-integrity.json。
- 反事实：counterfactual-summary.json 及各变体 txt/json。HEAD-premises 跑原始测试；十一个缺陷变体均 exit=1 且有真实断言失败；逐项见 counterfactual-assertion-proof.json。
- 最终浏览器：browser.json、browser-final-message-identity.txt、browser-*.png；skill-browser-final 为原技能客户端，黑色 canvas 截图不算视觉通过。
- 守卫前提修订：premise-changes.diff；静态CE黄金表新增一行证明：ce-golden-extension.json；缺口与生成表边界：scope-check.json、scope-final.json。
- regression-first.txt 为施工中的发现性运行，主动中止，不是门禁结果。
- pre-death-fix/ 为17:50冻结轮；发现真实玩家致死时序缺口后中止，修复并于18:01完整重跑。
- pre-binding-fix/ 为18:01完整发现轮，3314通过/14失败；按CE核实并修复后完整重跑。
- pre-monster-binding-fix/ 为中止的18:37轮；BoltContract错误的前提修订已撤回，最终原守卫不变，改代码补入口绑定。
- pre-instant-return-fix/ 为致死接触内部提前返回修复前中止的轮次；lethal-gas-before.txt 为修复前失败，lethal-gas-repair.json 为修复后73项全通过。
- pre-grid-retirement-fix/ 为旧图端口清理修复前中止的19:07轮；retired-grid-repair.json 为74项全通过；counterfactual-retired-grid-leaks.json 为仅移除清理后3项失败。新测试只规范化墙钟savedAt，世界/RNG全部严格比较。
- pre-message-identity-fix/ 为19:34中止轮；message-identity-before.txt 为新对抗修复前失败，message-identity-fixture-diagnostic 为自定义夹具误继承目录身份的诊断；最终message-identity-repair.json与文本去重变体提供正反证。
- targeted-*/premise-update-check/build-first/browser-final 等为迭代日志，故意保留失败，不可替代最终文件。
