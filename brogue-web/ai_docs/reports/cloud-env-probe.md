# Cloud environment probe

以下输出按执行时的 stdout/stderr 原样记录；“执行器耗时”是命令执行器报告的 wall time。第 4、5 条命令本身带有 `time`，因此其代码块末尾同时保留了 shell `time` 的原始结果。所有命令均正常退出，没有超时或被环境终止。

## 1. `date -u`

执行器耗时：`0.000233442` 秒；退出码：`0`。

```text
Tue Sep 22 03:58:38 UTC 2026
```

## 2. `node -v; npm -v; nproc; uname -a`

执行器耗时：`0.366096994` 秒；退出码：`0`。

```text
v20.20.2
npm warn Unknown env config "http-proxy". This will stop working in the next major version of npm.
11.4.2
3
Linux localhost 6.18.44 #1 SMP Sat Sep 12 15:35:21 UTC 2026 x86_64 x86_64 x86_64 GNU/Linux
```

## 3. `cd brogue-web && ls node_modules | wc -l`

执行器耗时：`0.000164449` 秒；退出码：`0`。

```text
133
```

## 4. `cd brogue-web && time npx vitest run src/test/smoke.test.ts`

shell `time` 报告的实际耗时：`0m34.683s`；退出码：`0`。

```text
npm warn Unknown env config "http-proxy". This will stop working in the next major version of npm.

 RUN  v4.1.11 /workspace/BrogueCE-chs/brogue-web


 Test Files  1 passed (1)
      Tests  3 passed | 1 todo (4)
   Start at  04:00:17
   Duration  32.38s (transform 2.26s, setup 0ms, import 3.34s, tests 28.53s, environment 1ms)


real	0m34.683s
user	0m39.864s
sys	0m2.681s
```

## 5. `cd brogue-web && time npm run build`

shell `time` 报告的实际耗时：`0m31.693s`；退出码：`0`。

```text
npm warn Unknown env config "http-proxy". This will stop working in the next major version of npm.

> brogue-web@0.0.0 build
> vue-tsc -b && vite build

vite v7.3.1 building client environment for production...
transforming...
✓ 801 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                               0.76 kB │ gzip:   0.44 kB
dist/assets/index-BHqeIIvc.css               18.06 kB │ gzip:   4.30 kB
dist/assets/Filter--SOTwCK2.js                0.90 kB │ gzip:   0.48 kB
dist/assets/BufferResource-DFsaXvSP.js       10.60 kB │ gzip:   2.80 kB
dist/assets/webworkerAll-DJBWpD_l.js         11.88 kB │ gzip:   3.93 kB
dist/assets/CanvasRenderer-C-JJhHX3.js       22.67 kB │ gzip:   7.08 kB
dist/assets/WebGPURenderer-IIsseByy.js       38.19 kB │ gzip:  10.65 kB
dist/assets/browserAll-D7kmB955.js           41.30 kB │ gzip:  10.82 kB
dist/assets/RenderTargetSystem-dwpb7CJv.js   45.60 kB │ gzip:  12.57 kB
dist/assets/WebGLRenderer-Gd97kP3b.js        68.42 kB │ gzip:  18.76 kB
dist/assets/index-CZdS95SH.js               985.50 kB │ gzip: 288.22 kB

(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rollupOptions.output.manualChunks to improve chunking: https://rollupjs.org/configuration-options/#output-manualchunks
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
✓ built in 12.08s

real	0m31.693s
user	0m48.503s
sys	0m5.700s
```

## 6. `free -m; df -h .`

执行器耗时：`0.000110833` 秒；退出码：`0`。

```text
               total        used        free      shared  buff/cache   available
Mem:           18008        1404       16411           0         517       16604
Swap:              0           0           0
Filesystem      Size  Used Avail Use% Mounted on
overlay          32G  403M   30G   2% /
```

## 7. `ulimit -a`

执行器耗时：`0.000040714` 秒；退出码：`0`。

```text
real-time non-blocking time  (microseconds, -R) unlimited
core file size              (blocks, -c) 0
data seg size               (kbytes, -d) unlimited
scheduling priority                 (-e) 0
file size                   (blocks, -f) unlimited
pending signals                     (-i) 71956
max locked memory           (kbytes, -l) 8192
max memory size             (kbytes, -m) unlimited
open files                          (-n) 16384
pipe size                (512 bytes, -p) 8
POSIX message queues         (bytes, -q) 819200
real-time priority                  (-r) 0
stack size                  (kbytes, -s) 8192
cpu time                   (seconds, -t) unlimited
max user processes                  (-u) 71956
virtual memory              (kbytes, -v) unlimited
file locks                          (-x) unlimited
```

## 8. `curl -sS -o /dev/null -w '%{http_code}' https://registry.npmjs.org/`

执行器耗时：`0.151398288` 秒；退出码：`0`。该命令的原始输出没有末尾换行。

```text
200
```

## 结论

- **单条命令最长可运行时长：**本次可直接确认至少约 **35 秒**（Vitest 的 `real` 为 34.683 秒）仍能正常完成；没有任何一条命令超时或被环境终止，因此这些数据不能证明一个确定的硬上限。换言之，当前实测下限约为 35 秒，而不是观察到“到某秒必停”的最长上限。
- **`node_modules` 完整性：**目录顶层共有 133 项；指定 Vitest 测试正常完成（3 passed、1 todo），并且 TypeScript/Vite 构建成功处理 801 个模块。就当前项目的测试和构建所需依赖而言，`node_modules` 是完整且可用的；仅凭这些命令不能证明所有未使用的可选依赖也都存在。
- **联网：**仍可联网。访问 npm registry 得到 HTTP `200`，耗时约 0.151 秒。
