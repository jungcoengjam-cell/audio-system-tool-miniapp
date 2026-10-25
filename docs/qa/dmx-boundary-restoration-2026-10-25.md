# DMX 浏览器边界覆盖恢复验收（2026-10-25）

本轮恢复此前测试迁移中缩减的动态边界检查，修复阶段只修改测试代码。以任务开始时的工作区为基准，保留用户已确认的七页编辑工具条模板引用删除；没有新增其他生产页面、UI、功能、核心算法、产品数据或存储语义改动。后续 Git 提交范围和隔离验证见下文。

执行由 GPT-6 Luna reasoning `max` 完成，当前对话模型独立复审代码、运行证据、输入哈希和截图，并执行故障注入、既有浏览器用例及完整发布自检。

## 最终验收状态

**最终验收通过（2026-10-25）。** 自动化验证及独立复审完成后，用户在本次对话中确认“真机测试没问题”。真机结果来源为用户实测确认；未提供本轮设备版本、逐项用例或性能采样，不额外推定这些细节。

## 修改范围

| 文件 | 处理 |
| --- | --- |
| `tests/dmx-ui-refinements-2026-10-18/browser-rotation-test.cjs` | 从仅检查退役路由，恢复为当前共享页的真实浏览器 resize 测试入口 |
| `tests/dmx-ui-round3-2026-10-18/browser-rotation-test.cjs` | 同上，使用其原有 round3 浏览器适配器运行 |
| `tests/dmx-ui-round3-2026-10-18/placement-sheet-test.cjs` | 恢复此前删除的入口，将面板检查迁移到当前共享页和真实 DOM 结构 |
| `tests/helpers/dmx-layout-browser-boundaries.cjs` | 两个 resize 入口共用的断言、输入哈希清单及证据输出 |

生产路由继续为 `pages/dmx-layout/dmx-layout`，配置继续为 `portrait`。没有恢复独立横屏路由，也没有修改页面方向配置。宽视口是当前竖屏页面的浏览器 resize 压力场景，不代表微信原生横屏能力。

## 恢复的检查

- 两个 resize 入口均保留退役路由及源目录缺席检查，并实际加载 `page=layout`。尺寸序列为 `390×844 → 844×390 → 568×320 → 390×844`；核对页面收到的新尺寸、Canvas DOM 与 backing store 重测、舞台边界和横向溢出。
- resize 期间完整方案、完整布局、每台灯具位置、存储内容、写入次数和导航次数保持不变。
- 设置面板打开时 Canvas 节点及控制器引用均释放；短宽视口和恢复竖屏后，面板均避开模拟胶囊及底部安全区。滚动主体高度为正且在卡片范围内，底部不覆盖真实 `.settings-actions` 操作区，应用按钮保持可见。关闭后取得新的 Canvas 节点，重新测量并绘制，方案与存储不变。
- 灯具选择面板检查标题、杆位概览、预览条、搜索区和列表的四边及排列顺序。当前面板没有旧 `.placement-summary` 底栏，因此检查真实列表尾部；固定底栏边界由设置面板覆盖，没有增加或伪造生产组件。
- 四种视口分别为 `390×844/light`、`320×568/dark`、`844×390/light`、`568×320/dark`。每次导航传入主题并核对实际主题；27 台测试灯具全部保留，使用真实触摸滚动到列表尾部，实际命中遮罩后关闭，确认无导航、无存储写入、方案和布局不变。

resize 测试全程使用并核对实际浅色主题，不把仅改变浏览器媒体查询误记为小程序主题切换。明暗主题的面板覆盖来自上述逐次导航的四组用例。

## 验证结果

| 验证 | 结果 |
| --- | --- |
| refinements resize 入口 | 6/6，通过，实际退出码 0 |
| round3 resize 入口 | 6/6，通过，实际退出码 0 |
| 恢复后的 placement-sheet 入口 | 4/4，通过，实际退出码 0 |
| 当时工作区的既有 `browser-refinements.cjs layout` | 2/2，通过；真实搜索、身份与地址恢复、只读选择、完整 PNG 附表和尺寸检查保持通过，实际退出码 0；该文件的历史改动未纳入本次提交 |
| 独立反向验证 | 禁用 `onResize`、将设置底栏移出视口、使遮罩外部区域穿透，三种故障分别被对应断言拒绝，实际退出码均为预期的 1 |
| 完整发布自检 | `node tests/release-check.js` 退出码 0，stderr 为 0 bytes |
| 语法与差异 | 四份测试代码 `node --check` 通过；本次跟踪文件的 `git diff --check` 通过，新 helper 的空白另行核对 |
| 独立范围检查 | 306 个受保护生产及配置路径、2630 个非目标路径哈希均未变化；七页已确认的 WXML 删除保持任务开始时的原始字节 |

16 项定向检查包含两个静态退役路由检查，不将它们计为动态浏览器交互用例。故障注入仅修改隔离的 headless 页面运行状态或临时样式，不修改生产源码；预期失败与正常通过证据分别保存。

测试使用已有源码驱动浏览器适配器和 headless Chrome `155.0.8059.85`。主代理抽查了短宽视口的设置底栏与暗色灯具选择面板截图。浏览器映射、模拟微信 API 和 DOM 几何断言不代表微信原生渲染或真机验收。自动化验证阶段未进行真机或微信编译包验证；其后用户已确认本轮真机测试通过，作为最终验收依据。微信编译包验证未单独记录。

## 本次提交范围与隔离验证

用户确认将测试修复、验收记录及七页工具条删除提交并推送到既有远程 `master`。提交限定为 20 个文件：上述四份测试代码、一份本验收记录、七页 WXML，以及两个浏览器测试目录各自的 `browser-host.cjs`、`browser-runtime.js`、`browser.js`、`browser.html` 共八个必要依赖。

八个配套文件提供可独立加载的 HTML 入口及退役路由守门；两个 driver 已在原提交中。无需带入历史 baseline、照片、生成器或旧验收产物。`browser-refinements.cjs`、其他历史 runner、README、设计规范和旧代码删除等未获本次提交授权的改动继续留在工作区。

从当前 Git 版本导出全新隔离副本，仅覆盖这 20 个路径后，三个目标入口分别 6/6、6/6、4/4 通过，实际退出码均为 0；完整 `node tests/release-check.js` 退出码 0，stderr 为空。另对全部 28 个注册页面的 40 个 WXML、33 个 WXSS 执行官方 `wcc`/`wcsc` 编译，两者均退出码 0、stderr 为空。该编译不等同于微信开发者工具完整 JS 包构建。

七页 WXML 仅删除此前明确批准的编辑工具条模板引用，涉及接线助手、线材、摄像机、增益结构、LED、限幅器和声压级。没有改动其他生产源码。隔离运行证据保存在 `tmp/dmx-boundary-restoration-2026-10-25/commit-review/` 的 `browser-summary.json`、`release.stdout.log`、`release.stderr.log` 和 `official-compile/summary.json`；这些是本地证据，不是测试运行依赖。

## 复跑与证据

从仓库根目录运行，`LIGHTING_QA_OUT` 可将新证据写入指定目录，避免混入历史证据：

```powershell
$env:LIGHTING_QA_OUT = 'tmp/dmx-boundary-restoration-2026-10-25/recheck'
node tests/dmx-ui-refinements-2026-10-18/browser-rotation-test.cjs
node tests/dmx-ui-round3-2026-10-18/browser-rotation-test.cjs
node tests/dmx-ui-round3-2026-10-18/placement-sheet-test.cjs
```

使用对应目录已有的 `browser.html`、`browser.js`、`browser-runtime.js`、host 和 driver；每次证据记录实际页面及浏览器适配器输入哈希。没有运行会重写适配器、编译入口或历史参考图的 `prepare-browser.cjs`。

证据根目录：`tmp/dmx-boundary-restoration-2026-10-25/`。

- `agent-before/`：修改前测试快照。
- `luna-evidence-final/verification.json`：三次定向执行的退出码、用例、输入哈希和截图索引。
- `root-input-review.json`：主代理逐项核对最终输入哈希与通过证据一致。
- `root-negative/summary.json`：三种预期失败的独立验证；首轮遮罩注入同时阻断列表触摸，随后将卡片设为可交互，仅验证遮罩外部穿透，原始日志分别保留。
- `root-existing-refinements/`：原有搜索与完整 PNG 导出用例的实际运行结果。
- `root-release.stdout.log`、`root-release.stderr.log`、`root-verification-summary.json`：完整发布自检及最终独立汇总。
- `root-scope-review.json`：生产与非目标文件哈希复核。

两次 resize 入口分别使用各自适配器；没有要求旧横屏页面重新注册，也没有删除新的搜索或导出断言来取得通过。
