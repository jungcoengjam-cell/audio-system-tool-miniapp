# 限幅器输入与结果布局比例调整

日期：2026-10-07。Sol 独立复审：**PASS_SCOPE_ONLY**；整体验收：**NOT_COMPLETE**。GPT-6.1 Sol 独立范围复审于 `2026-10-06T18:57:19Z` 完成；[复审记录](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-balanced-layout-2026-10-07/balanced-layout-sol-review.json)。

后续节奏与对比修订状态见[最新记录](limiter-rhythm-contrast-2026-10-07.md)。本文件中的旧版截图、矩阵与 `PASS_SCOPE_ONLY` 不代表最新一轮视觉验收。

本批针对真机参考图中输入区过松、结果区比例不足的问题重调比例，并把四个功能键改为悬浮在结果区右上方的竖排工具栏。仅限幅器 WXSS 有净改动；计算、产品数据、输入含义与校验、记录存储、15 秒提醒、触感、校准值及引擎状态语义均未改变。没有提交、推送、发布或部署。

## 布局变更

- 普通视口输入区固定为 `230px + safe area`，单行高 `56px`、控件高 `48px`；内容视口高度 `≤640px` 时固定为 `215px + safe area`，单行高 `51px`、控件高 `44px`。例如原生 DevTools 的 `390×753` 页面使用普通规格。字段行与选择器不再通过剩余空间等分拉高。输入区预留三个固定行位以避免切换“设备/负载/设置”分组时跳动；只有两行的分组至多留下一个空行高度。
- 结果区改为占用剩余视口高度。主结果卡在 `600px` 以下固定 `182px`，`601–690px` 固定 `200px`，更高视口以 `220px` 为基础并可增长至 `280px`；次级结果区使用剩余空间。底部安全区仍计入输入面板高度。
- 四个功能键作为 `.result-pane` 的直接子级绝对定位覆盖层，使用 `z-index:3`，不占结果布局行列，低于层级 `100` 的 sheet。普通视口位于 `top:8px/right:12px`、间隔 `2px`；短视口位于 `top:1px/right:6px`、间隔 `1px`。每键保持 `44×44px` 点击区域，图形最长边约 `18–22px`；按钮采用主题表面圆底和轻阴影。书签轮廓态与收藏态均保留完整 V 形负形；遮罩背景跟随圆底，按压态跟随主题表面状态。
- 阈值与 Attack/Release 继续在结果面板整体中轴附近呈现，内容区两侧对称预留约 `52–56px`，避免右侧悬浮键挤压左侧。阈值、时间、HPF/来源/范围、校准提示及完整状态警告不因布局调整而删除或省略；标定提示仍为 `0 dBFS = +18.4 dBu`。

## 验证结果

本轮 Chromium 浏览器近似布局矩阵共 **256** 个场景：既有 238 个场景，新增 390×753、安全区 34 的设备/负载/设置三种状态各跑浅色与深色 6 个场景，并加入 HPF 10Hz/2500Hz 边界的 12 个场景。最终 `failures=[]`，矩阵前后源码哈希稳定。320×480 的四个长引擎错误场景继续采用整页自然滚动回退。矩阵使用项目页面的 WXML、WXSS 与控制器进行 Chromium 渲染；`safe0`、`safe34` 和 `width184` 是模拟压力参数，`width184` 并非测得的 iOS 原生 UA 宽度。旧 238 场景通过的是旧布局验收标准，不能替代本批标准下的结果。

矩阵证据：[最终结果 JSON](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-balanced-layout-2026-10-07/after-layout-results.json)。代表图：[390×753 浅色设备态](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-balanced-layout-2026-10-07/after-layout/390x753-light-device-safe34-width184.png)、[390×753 深色设置态](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-balanced-layout-2026-10-07/after-layout/390x753-dark-settings-safe34-width184.png)、[320×480 深色短屏负载态](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-balanced-layout-2026-10-07/after-layout/320x480-dark-load-safe34-width184.png)、[402×760 深色书签态](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-balanced-layout-2026-10-07/after-layout/402x760-dark-bookmark-safe34-width184-toolbar.png)。

主项目微信开发者工具的实际页面渲染/API bounds 在 `platform=devtools` 下完成；设备模型字段显示 iPhone 12/13 (Pro)，视口 `390×753`、屏幕高 `844`、底部安全区 `34`、SDK `3.16.2`、浅色主题。这是微信开发者工具模拟环境，**不是实体 iPhone**。设备、负载、设置三种状态的最终记录均无按钮/文字重叠；阈值和时间中心偏差约 `0.005px` 与 `0.00001px`。输入行高均为 `56px`；两行状态各剩一个 `56px` 空行位，三行状态无剩余行位。结果区高度为 `489.33px`，其中主卡高度 `280px`；输入区为 `264px`。对照锁定的旧源码快照，旧结果区/输入区分别为 `348px`/`405.33px`，当时两行各被拉伸到 `150.67px`。当前页面实际存储输入为 TC-2700B、KF-D12F、HPF 20 Hz，阈值 `−18.1 dBFS`；验证没有改写输入或偏好。原生 bounds 证据：[before/after 记录](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-balanced-layout-2026-10-07/native-layout-verification.json)，[设备态截图](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-balanced-layout-2026-10-07/after-device-native.png)、[负载态截图](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-balanced-layout-2026-10-07/after-load-native.png)、[设置态截图](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-balanced-layout-2026-10-07/after-settings-native.png)。

书签视觉截图使用临时 `Page.setData(currentFavorite=true)` 设置展示态，随后恢复原先 `false` 状态和设备分组；没有调用收藏存储服务，因此仅验证图形绘制，不代表真实收藏交互或持久化测试：[临时收藏视觉态截图](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-balanced-layout-2026-10-07/after-bookmark-visual-native.png)。原生检查验证面板尺寸、动作键位置、中心和交叠；设置态 HPF 选择器在 DevTools 中呈现约 `69.1875×48px` 的内容宽 badge，左端与右侧控件列对齐，`20Hz` 与箭头完整可见。浏览器 fixture 将该控件渲染为整列宽，两端视觉不完全同形；本批未调整选择器自身的 flex 规则，也未验证原生选择器触摸行为。

微信开发者工具官方编译器于 `2026-10-06T18:39:42Z` 完成：WCC 编译 29 个 WXML、WCSC 编译 26 个 WXSS，两个进程退出码均为 `0`，清单共 55 项。证据：[编译执行记录](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-balanced-layout-2026-10-07/compile/compile-execution.json)。

本轮没有运行 `tests/release-check.js` 或限幅器页面状态测试；两份测试文件均按保护基线保持原字节。未在实体 iPhone/Android 验证绘制或触感；未验证原生深色主题、真实触摸、selector/share 行为、键盘/大字号、低于 480px 视口，也未验证纯图分享的实际发送与接收。

## 修改范围、哈希与项目体积

本批允许变更范围只有 `pages/limiter/limiter.wxml` 和 `pages/limiter/limiter.wxss`。最终只有 WXSS 有净改动：`22,768 → 23,697` 字节，`+929` 字节；WXML 前后相同。

| 文件 | 本批前 SHA-256 | 当前 SHA-256 | 状态 |
| --- | --- | --- | --- |
| `pages/limiter/limiter.wxml` | `a5fa10d54cb06364ed35a348252c32984fa20888663c33cac5c791118afe88ae` | `a5fa10d54cb06364ed35a348252c32984fa20888663c33cac5c791118afe88ae` | 未变 |
| `pages/limiter/limiter.wxss` | `6e8003d9c0a7fc0d6ba7b74afd7d11f5b785efcceaa2f2de2aeda30833dbc9a0` | `d6d0bcf5231a5893f3bc7eabc3683ce166714676256995914b3469d77f5250a8` | 净增 929 字节 |
| `pages/limiter/limiter.js` | — | `0a3d7341c157bdd3405fe9b5e2a3e0d0185061729736f0cfdbc6113cdda3368b` | 保护文件，未变 |
| `pages/limiter/limiter-overlays.wxml` | — | `38b596cad97cd7dc31cdd22cb3df59189fd382d074b40208d228d9e5d30fb117` | 保护文件，未变 |
| `tests/limiter-refactor-2026-10-06/limiter-page-state-test.js` | — | `30b250a0862658f6a855ca60547cf1b780ad4d719d1c3e379fcdda65471a627a` | 保护文件，未变 |
| `tests/release-check.js` | — | `530cca671dab1c927bf48d404a39397eedda1bd9fb02cab8786415b2a86acddb` | 保护文件，未变 |

范围记录确认允许文件仅 WXSS 的 SHA 变化，受保护的 218 个 runtime 文件、JS、overlay 与两份测试文件无差异。分支仍为 `master`，HEAD 仍为 `de758b643ff1bd4beabd6f6dbb1ee88a4d026e0e`。工作区在本批前已有大量其他任务的未提交差异；本记录不声称工作区干净，也没有 reset 或改写这些差异。证据：[基线清单](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-balanced-layout-2026-10-07/baseline.json)、[范围核验](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-balanced-layout-2026-10-07/scope-verification.json)、[WXSS 差异](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-balanced-layout-2026-10-07/limiter.wxss.scoped.diff)、[WXML 差异](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-balanced-layout-2026-10-07/limiter.wxml.scoped.diff)。

按 `project.config.json` 打包忽略规则统计的 203 个有效源文件当前合计 `2,780,436` 字节（约 `2715.270 KiB`），主 JavaScript `944,995` 字节、WXSS `312,192` 字节、WXML `297,710` 字节；相对 `2650/874/292/284 KiB` 旧门槛仍超限。预算没有修改。这是当前有效源文件统计，不是微信编译或上传包大小，也不将工作区全部体积变化归因于本批。证据：[源文件体积记录](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-balanced-layout-2026-10-07/source-size-after-refinement.json)。

## 复审与后续

Sol 独立复审结论为 **PASS_SCOPE_ONLY**，范围内阻塞项为空；审查确认本轮布局、结果区上层竖排悬浮工具栏和图形绘制达到已批准范围标准。此结论不替代实体设备、真实触摸或发布门禁验收，故整体验收仍为 **NOT_COMPLETE**。本批没有提交、推送、发布或部署。
