# X2a：录像 checkpoint 提交时点与参考屏关闭

## 规格与裁决

依据 `x-1-survey.report.md` §4 N01、§7.1，以及 U27 v2 命令录像合同。v2 的既定字段是命令完成后的状态；同步录像本来如此，动画在推进前提交属实现错误。因此保持 v2，既有正确 v2 录像继续接受，v1 仍直接拒绝。不改生成流程或 `test:drift`。

## 实现

- `Game.executeCommand` 在命令边界立即写入动作、参数和确认决策事件。若动作开启分帧推进，把该事件引用置于实例隔离的 `RecordingRuntime`；`finishAdvancement` 完成怪物、环境和回合尾声后，更新其位置、深度、tick、回合、双流 RNG 和终局 checkpoint。同步路径当场提交同一时点。推进期间拒绝导出未完成的录像；新局/读档/seek 重建会丢弃在途提交引用。
- 动画 `replayStep` 同样延至推进结束才核对 checkpoint、推进游标和报告 OOS。同步回放与 seek 走同一核对函数。自动行走仍按原同步快进路线，每步单独记录。
- `ReferenceOverlay.vue` 的鼠标遮罩/按钮和键盘关闭都调用 `executeCommand('escape')`，因此发现/帮助屏关闭有明确事件，回放不会把下一命令误吞进 modal 分支。

## 验证

- 新增 `x2a_recording_checkpoint.test.ts`：seed424242 动画 wait 在命令边界已有一条事件但 checkpoint 未提交、收尾后与同步完整事件相等；动画逐条回放和 seek 无 OOS；篡改 tick 准确报第 1 条 OOS；慢回合中间暂停帧仍不提交 checkpoint；发现屏关闭事件与 modal 回放；另以同 seed 混合序列逐条对比动画开/关的全部 checkpoint。
- 新增 `scripts/x2a-browser-acceptance.mjs`，在本机 Edge 真页面启动 seed424242，确认 `animationEnabled`，执行等待、搜索、移动、背包开关、食物确认取消/接受、发现屏鼠标关闭、帮助屏 Escape 关闭、鼠标自动行走一步、楼梯命令。导出 JSON，重载页面，逐条回放与 seek。14 条事件，确认决策 `[[false],[true]]`，`auto_step` 存在，两条回放均 `cursor=14, error=null`。该场景的楼梯命令在非楼梯格上执行，未覆盖实际换层。
- 反查既有守卫：`p1_30_i18n_gate`、`u24_hardcoded_text`、`u_00_new_run`、`u_03_whole_run_snapshot`、`u_27_recording`、`u_r1`–`u_r4`、`p2_*`、`ui_*`；核对 `ReplayControls`、`App`、`GameCanvas`、`ReferenceOverlay` 的读写与 ticker 调用位置。守卫、黄金 trace 与 `test:drift` 均未改。
- 反事实门禁：最初延迟写入整个事件，`p2_2_real_speed` 的 C2/D1/D2 三条守卫因命令边界事件数不增而失败。按任务书“事件本身在命令边界”修正为立即写事件、只延后 checkpoint；未改守卫。修复后该文件与 X2a/U27 定向合跑通过。
- UR4 黄金 trace 单变量归因：旧/新 gzip JSON 逐叶比较共 212 项变化，**全部**位于 `recording` 或 `state.run.recordedInputEvents`，仅为动画事件提交时点带来的 turn/RNG 等 checkpoint 值；世界快照、日志、tick 和独立双流 RNG 无差异。用原测试的 `UR4_CAPTURE=1` 重录 `u-r4-trace.json.gz`，普通 UR4 守卫复跑 1/1 通过。未改守卫或 UR2/UR3 trace。

## 最终复跑

- `npm test -- --maxWorkers=2 src/test/p2_2_real_speed.test.ts src/test/x2a_recording_checkpoint.test.ts src/test/u_27_recording.test.ts`：25 通过、2 跳过、0 失败。
- `npm run build`：通过。
- `npm run test:drift`：1/1 通过，脚本未改。
- `npm test -- --maxWorkers=1 src/test/u_r4_trace.test.ts`：1/1 通过（重录后普通模式）。
- `node scripts/x2a-browser-acceptance.mjs`：14 条事件，逐条与 seek 均零 OOS。
- 全量最终复跑 `npm test -- --maxWorkers=6`：199/199 文件通过；3770 通过、8 跳过、5 todo、0 失败，退出码 0。覆盖重录后的 UR4 守卫。最终生产代码上的 build、未修改的 `test:drift`、浏览器混合录像和全量测试均通过。

所有修改文件为 LF；未提交 git。
