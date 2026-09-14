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
    testTimeout: 120_000,
    hookTimeout: 60_000,
  },

  plugins: [vue()],
})
