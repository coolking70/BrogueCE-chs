import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
export default defineConfig({
  // 全局测试超时。本项目有多个"多 seed × 数百回合"的聚合用例，正常耗时 3-8s，
  // 机器有负载时会突破 vitest 默认的 5s——历史上已三次因此出现假失败
  // （P1-9 / P2-3 / P2-6 各一次），每次都靠逐条补 timeout 应付。
  // 在此统一放宽，避免验收被环境噪声干扰；真正的死循环由单条用例自己的
  // 更短 timeout 或断言来兜。
  test: {
    // 验收方 2026-09-16 上调：本套件有多个重型长跑用例（26 层 × 多种子的整图扫描），
    // 单文件耗时实测 c_0_add_loops 148s、p1_29 71s、invented_content_pool 52s。
    // 原来的 120s 在**并行执行方占用 CPU 时**会让它们集体假红——已发生两次，
    // 每次都要靠"单独重跑该文件"才能区分真失败与超时，代价是消耗判断力。
    // 假红比慢更有害：它训练所有人把红灯当背景音。
    // 代价：真正挂死的用例要 300s 才浮出水面，可接受。
    // 2026-09-19 再次上调 300s → 900s：V-2a 恢复机器内容物后，每局生成期
    // substantive RNG 抽取从约 30 万涨到 70-80 万，同一份代码两次全量门禁
    // 的耗时差 40%。实测撞线的四个用例（monster_stats_effect 351s /
    // invented_content_pool 404s / c_4a_terrain_catalog 350s /
    // c_4a_0_layer_model 317s）单跑全绿，全是并行争抢下的假红。
    testTimeout: 900_000,
    hookTimeout: 120_000,
  },

  plugins: [vue()],
})
