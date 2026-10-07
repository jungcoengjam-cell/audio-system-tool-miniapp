# 限幅器结果节奏与层级对比调整

日期：2026-10-07。状态：**PASS_SCOPE_ONLY（Sol 视觉范围复审通过）**；整体验收：**NOT_COMPLETE**（源码预算仍超限，真机及原生交互未验）。Sol 于 `2026-10-07 02:53:04Z` 完成复审，记录见[审查 JSON](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-rhythm-contrast-2026-10-07/rhythm-contrast-sol-review.json)。最终 center 候选的源码编译、Chromium 矩阵、DevTools 模拟器布局、颜色/笔画与变更范围均已按同一组哈希核验；前一 `1A488` 候选只作历史参考，不计入当前最终验收。

基线为 `master` / `de758b643ff1bd4beabd6f6dbb1ee88a4d026e0e`；本轮限幅器视觉范围是 [limiter.wxml](C:/Users/wxx/Documents/Codex/audio-system-tool-miniapp/pages/limiter/limiter.wxml) 与 [limiter.wxss](C:/Users/wxx/Documents/Codex/audio-system-tool-miniapp/pages/limiter/limiter.wxss)。最终证据对应的页面 SHA-256：JS `0a3d7341c157bdd3405fe9b5e2a3e0d0185061729736f0cfdbc6113cdda3368b`、WXML `4f903fcc96dcd448d1c2eb66cad9133696540b56f536c4eca81ca3648cf31b2c`、WXSS `1e7c6a20806164c8325f93cdbdd8603b2b3de850ce48a9fe0c8f6772804e2e3e`。工作区包含其他任务的既有差异，本记录不把它们归因于本轮。本轮视觉返工不改计算算法、产品数据、输入校验、记录存储语义或 15 秒提醒逻辑。

## 本轮视觉目标

- 提醒条继续显示“其他组沿用现值”，移除了输入标题旁的秒数。内部仍按 `15000` 毫秒计时，提醒暂停/恢复及到期清除逻辑保留；隐藏的是数字显示。
- 浅色主题统一整张结果卡底色为 `#eef3f8`；二级网格、指标单元、数值与标签均透明，不另设下方面板底色（此前的 `#e8eef5` 次级底色方案已取消）。深色主题由整张外卡承载连续主题渐变，内部同样透明；层级只用细分隔线及数值 `20px`、标签 `13px` 的字号区分。最终 PNG 取样、亮度与文字对比结果见验收表。
- 功能 glyph 的主要描边调整为 `2px`；图形盒仍为 `22×22px`，四个按钮的 `44×44px` 点击区域保留。收藏图标的 V 形负形仍由 CSS 绘制。
- 下部四项指标压至 `128px` 高，并以每行 `64px` 的内嵌 2×2 网格共用整张结果卡的连续底色；网格及单元不另画背景、独立外框或卡片圆角，仅用细分隔线划分。Attack/Release 是共同结果卡内的两格时间显示区；最终布局矩阵确认渲染尺寸。
- 页面不再显示 `result.statusText` 的额定功率说明小字。它仍保留在限幅器结果文本与导出内容中，计算结果和警告语义没有删除。
- 有效计算的状态 badge 不随结果内容栈移动，也不占布局行：普通视口（`>690px`）绝对定位于共同 `.result-card` 左上角 `20px/20px`；中短屏（`≤690px`）左上角使用 `6px/12px`。阈值、保护时间与下方指标共用一个外框。
- 普通视口（高于 `690px`）将整个自然高度结果内容栈垂直居中：`.result-card` 使用 `justify-content:center`；主标题不伸缩、高度自适应且 `min-height:250px`；内部 `24px` 间距、文案区 `16px` 底距及 `128px` 二级区高度保持。中短屏（不高于 `690px`）保留紧凑布局，不随普通视口规则改变。
- 普通视口的上下余白差不超过 `16px`，最高 `820px` 视口的底部余白不超过 `112px`。整体内容上移这一最新要求覆盖旧的“二级区到输入区不超过 `24.5px`”约束；其余 `24px` 区间距保留。阈值与 `0 dBFS = +18.4 dBu` 校准提示实测间距为普通视口 `4px`、短屏 `1px`，`10px` 是该距离的验收上限，不是目标间距。

## 验收状态

| 检查项 | 状态 | 说明 |
| --- | --- | --- |
| 限幅器状态/触感测试 | **NOT_RUN** | 本轮为 UI-only；JavaScript、数据、输入校验与测试文件逐字节未变，因此未重跑完整业务回归。旧候选结果不计入当前验收。 |
| `tests/release-check.js` | **NOT_RUN** | 本轮为 UI-only；JavaScript、数据、输入校验及测试文件逐字节未变，因此未重跑完整业务门禁。 |
| 微信开发者工具源码编译（29 WXML + 26 WXSS，共 55 项） | **PASS（55/55）** | 官方 `wcc` / `wcsc` 均 exit 0，时间 `2026-10-07 02:39:05Z`；manifest 的限幅器 WXML/WXSS 哈希与本文最终哈希一致。[编译执行记录](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-rhythm-contrast-2026-10-07/compile/compile-execution.json) |
| Chromium 最终 256 场景布局矩阵 | **PASS** | `failures=[]`、`hashesStable=true`；普通视口上下余白差最大 `12.219px`（≤16），最高 `820px` 视口底部余白最大 `102.5px`（≤112）；常规校准间距 `4px`、短屏 `1px`。HPF `10 Hz` 实测 Attack/Release `45/720 ms`，`2500 Hz` 实测 `0.3/4.8 ms`。[最终布局矩阵](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-rhythm-contrast-2026-10-07/final-layout-results.json) |
| 短屏二级指标滚动可见性 | **PASS（Chromium）** | `320×480`、safe-area `34px`、light/dark 四次检查均可通过两次滚动完整读出两行四项指标，单次滚动位置 `7/72px`、可视区 `47px`。[滚动核验记录](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-rhythm-contrast-2026-10-07/short-scroll-verification.json)；截图：[浅色第 1 行](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-rhythm-contrast-2026-10-07/320x480-light-load-safe34-width184-scroll-row0.png)、[浅色第 2 行](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-rhythm-contrast-2026-10-07/320x480-light-load-safe34-width184-scroll-row1.png)、[深色第 1 行](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-rhythm-contrast-2026-10-07/320x480-dark-load-safe34-width184-scroll-row0.png)、[深色第 2 行](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-rhythm-contrast-2026-10-07/320x480-dark-load-safe34-width184-scroll-row1.png) |
| 主项目 DevTools 三种分组截图与 API/bounds 检查 | **PASS_NATIVE_SIMULATOR_LAYOUT_ONLY** | 主项目 `platform=devtools`、iPhone 12/13 (Pro) 模拟器、`390×753.33`、底部 safe-area `34px`、SDK `3.16.2`、light。device/load/settings 均为单一结果卡、1 个绝对定位 badge、无重叠；输出区 `501.333px`、输入区 `252px`、主区 `263px`，设备/设置输入各两行 `78px`、负载输入三行 `52px`、无多余行；下部 2×2 网格 `128px`。上/下余白 `57.052/45.833px`、差 `11.219px`；二级区到输入区实测 `50.5px`，旧 `≤24.5px` 指标已由最后确认的整体上移要求覆盖。实际 threshold `−18.1 dBFS`、Attack/Release `45/720 ms`。报告明确不是实体 iPhone。[DevTools 核验](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-rhythm-contrast-2026-10-07/native-layout-verification.json)；截图：[设备](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-rhythm-contrast-2026-10-07/after-device-native.png)、[负载](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-rhythm-contrast-2026-10-07/after-load-native.png)、[设置](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-rhythm-contrast-2026-10-07/after-settings-native.png)。收藏 glyph 截图使用临时 `setData` 视觉态并恢复，没有执行持久化收藏：[临时视觉态截图](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-rhythm-contrast-2026-10-07/after-bookmark-visual-native.png)。 |
| 浅色/深色 PNG 取样、亮度与文字对比度 | **PASS（渲染器测量）** | 浅色一级/二级同为 RGB `238,243,248`；相对亮度分别下降 `0.035631` / `0.101188`。文字最低 `4.542727:1`；深色文字 `7.2148–15.1362:1`；glyph 描边均核实为 `2px`。[颜色与笔画记录](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-rhythm-contrast-2026-10-07/final-contrast-verification.json) |
| 变更范围 | **PASS** | HEAD/分支保持 `master` / `de758b643ff1bd4beabd6f6dbb1ee88a4d026e0e`；保护的 218 个 runtime 文件与两份测试文件未变，只改限幅器 WXML/WXSS（WXML `9065→9540 B`；WXSS `23697→26302 B`），JS 未变。[范围核验](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-rhythm-contrast-2026-10-07/scope-verification.json) |
| 有效源码预算 | **超限** | 203 个有效源文件：总量 `2718.277/2650 KiB`（超 `69,916 B`）；JS `922.847/874 KiB`（超 `50,019 B`）；WXSS `307.419/292 KiB`（超 `15,789 B`）；WXML `291.196/284 KiB`（超 `7,369 B`）。预算阈值未改。[源码体积记录](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-rhythm-contrast-2026-10-07/source-size-after-refinement.json) |
| GPT-6.1 Sol 最终独立复审 | **PASS_SCOPE_ONLY** | 于 `2026-10-07 02:53:04Z` 确认无源码返工项；整体验收仍为 `NOT_COMPLETE`。[审查 JSON](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-rhythm-contrast-2026-10-07/rhythm-contrast-sol-review.json) |

### 前一协调候选的历史证据（不计当前验收）

前一协调候选 `1A488` 的历史布局和截图保存在[候选9布局结果副本](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-rhythm-contrast-2026-10-07/candidate9-coordinated-layout-results.json)、[候选9设备截图](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-rhythm-contrast-2026-10-07/candidate9-native/after-device-native.png)、[候选9负载截图](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-rhythm-contrast-2026-10-07/candidate9-native/after-load-native.png)、[候选9设置截图](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-rhythm-contrast-2026-10-07/candidate9-native/after-settings-native.png)及其[设备 bounds 副本](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-rhythm-contrast-2026-10-07/candidate9-native/after-device-native-bounds.stdout.txt)。这些旧截图、失败 candidate（含 candidate8）与 `stale-badge-native` 缓存均保留，但不计入当前最终结果。

## 设备与数据边界

Chromium 的 `safe-area=0/34` 和 `width=184` 是布局压力参数；`width=184` 是推断值，不是从 iOS 原生 UA 测得的宽度。主项目微信开发者工具使用 `platform=devtools`，模拟器字段显示 iPhone 12/13，视口 `390×753.33`、底部安全区 `34`、SDK `3.16.2`、浅色主题；这些均是开发者工具模拟环境，不是实体 iPhone。

最终 DevTools 截图读取了原有本地偏好：功放 `TC-2700B`、音箱 `KF-D12F`、HPF `20 Hz`、灵敏度 `1 V`、数量 `1`；实测 `−18.1 dBFS`、Attack `45 ms`、Release `720 ms`，与基线一致。`TC-2500` / `TS-610` 仅作为浏览器临时 QA fixture，不代表产品默认值，也未写入默认数据。

限制：DevTools 模拟器只核验了浅色布局；模拟器深色主题、选择器/分享/点击/震动交互均 **NOT_RUN**。实体 iOS/Android、D08 实际收图与分享菜单、键盘、动态大字号及真机性能检查均 **NOT_RUN**。短屏滚动检查来自 Chromium，不能证明微信触摸手势。源码预算按项目打包忽略规则计算有效源文件，**不等于编译产物或上传包大小**；预算阈值未改。本轮未提交、推送、生成预览二维码、发布或部署。此前失败候选与 `stale-badge-native` 缓存继续保留，不计入当前最终结果。

最终证据根目录：`C:\Users\wxx\.codex\visualizations\2026\10\06\01a11025-2118-7183-883a-0925c68a2bba\limiter-rhythm-contrast-2026-10-07`。
