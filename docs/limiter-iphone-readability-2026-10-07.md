# 限幅器 iPhone 可读性与分享/项目 UI 专项（2026-10-07）

**状态：专项范围经 Sol 独立复审 PASS_SCOPE_ONLY；整体 NOT_COMPLETE。** [独立复审记录](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-iphone-readability-2026-10-07/iphone-sol-review.json)确认没有剩余必改源码项。本报告记录本轮真实源代码和模拟器证据。用户提供的三张 iPhone 截图只证明改版前标题间距与输入字形存在问题；改版后的实体 iPhone 截图尚未取得，因此本文不声称裁字问题已在 iPhone 上修复或通过。

改版前用户截图：[主页面](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-iphone-readability-2026-10-07/iphone-before/main.jpg)、[项目搜索](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-iphone-readability-2026-10-07/iphone-before/project-search.jpg)、[项目配置](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-iphone-readability-2026-10-07/iphone-before/config.jpg)。

## 改动范围

“输入配置”标题调为 18px。普通高度下标题行高 25px、标题区 26px，输入面板至少 226px；高度不超过 640px 时标题行高与标题区均为 22px、输入面板至少 219px。输入区保留原有行数和空间：负载三行普通高度 52px、短屏 51px；设备和设置两行普通高度 78px、短屏 76.5px。结果卡到输入区的 CSS 间距为普通高度 12px、600px 及以下 8px。

项目选择、创建和配置弹层的三个输入框统一为 52px 高、16px 字号、52px 行高和 0px 垂直内边距；WXML 为占位文字明确传入 16px/52px 样式。说明文字输入仍为 16px、上限 200 字。输入值、最大长度、事件处理和项目存储流程均保持原有行为。

分享图改为白底、无徽章和独立卡片的双列明细。仅收拢严格同值或同组合的重复展示，异值、冲突与说明继续保留。渲染器按实际文字测量并完整换行，遇到画布上下文创建或测量失败时沿用失败提示路径。该项只改变结果图的绘制，不修改计算结果、产品数据、阈值基准、记录载荷、缓存或存储语义。

源文件变更仅限以下三项，224 项基线清单中的 221 项保持不变；主控制器、主页面 WXML、计算/数据/存储代码均未修改。基线为 `master` / `de758b643ff1bd4beabd6f6dbb1ee88a4d026e0e`。

| 文件 | 本轮 SHA-256 | 说明 |
|---|---|---|
| [limiter.wxss](C:/Users/wxx/Documents/Codex/audio-system-tool-miniapp/pages/limiter/limiter.wxss) | `3b7fe04cbcaf4fb2b404e9df9b2cfd97510c11d5000a32f93245c00736ab5f7b` | 主标题、面板间距及项目/分享弹层的视觉规则 |
| [limiter-overlays.wxml](C:/Users/wxx/Documents/Codex/audio-system-tool-miniapp/pages/limiter/limiter-overlays.wxml) | `cce3e0e46dbf05a6f60c97f393959f33ac925f48779661ea6624a3a13565259a` | 项目输入占位样式 |
| [limiter-report.js](C:/Users/wxx/Documents/Codex/audio-system-tool-miniapp/pages/limiter/limiter-report.js) | `6d339d281044c26ef3223dc214ebbfe83c629c5206a9f0276dc972642de2bd1a` | 结果图文本测量、换行及绘制失败处理 |

[limiter.js](C:/Users/wxx/Documents/Codex/audio-system-tool-miniapp/pages/limiter/limiter.js) 保持原 SHA-256 `624e5f0464733d3978225d8342c57612cb1f508217e8fccfb95f106cc6eb07bf`；主页面 WXML 保持 `4f903fcc96dcd448d1c2eb66cad9133696540b56f536c4eca81ca3648cf31b2c`。完整范围记录见 [scope-verification.json](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-iphone-readability-2026-10-07/scope-verification.json)。

## 验证结果

**主页面 Chromium 矩阵：18/18 状态通过，0 失败。** 使用实际页面控制器、WXML 解析/渲染器和 WXSS，覆盖 320×480、320×601、390×753，浅色/深色及设备、负载、设置三组。最终运行源码 hash 稳定，标题均为 18px；短屏行高 22px 且完整落在标题区内，普通高度行高 25px。三项分组按钮均为 44px；各组行高保持 51/52px 与 76.5/78px；没有整页溢出，也没有浮动操作遮挡阈值或时间值。320×601 的结果卡到输入面板几何距离为 13px，面板底部 CSS padding 为 12px；报告按 1px 渲染差容差判定。其他短屏的几何距离与 CSS 间距均为 8px。该矩阵是 Chromium 排版近似，不是微信真机测试。见 [最终矩阵报告](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-iphone-readability-2026-10-07/main-layout-after-final/main-layout-after-metrics.json) 和 [390×753 浅色截图](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-iphone-readability-2026-10-07/main-layout-after-final/390x753-light-device.png)。

**项目弹层 Chromium 矩阵：52/52 状态通过，0 失败。** 覆盖 320px 和 390px、浅色/深色下的 13 种选择、空态、加载、创建、详情、成功、校验和错误场景，共 128 张截图（含 24 张输入字形裁切图），并检查长项目名与 CTA 可达性。输入框实测高度/行高 52px、字号 16px、垂直内边距 0px；标题 20px，主要按钮 16px，长名称可换行，短屏 CTA 可滚动到达。报告在 Chromium 中无法可靠读取 `::placeholder` 行高（返回 `normal`），因此只核对了 WXML 中声明的 16px/52px，占位字形是否真实居中仍由 DevTools 和实体设备确认。

这 52 态是在最终 CSS 之前、CSS SHA 为 `b710183b5d14f0dc7185179abb627c6508534084826c8692034846546394f875` 的冻结输入规则上运行。之后最终 CSS `3b7fe04cbcaf4fb2b404e9df9b2cfd97510c11d5000a32f93245c00736ab5f7b` 的差别限于主页面短屏标题行高；项目弹层输入规则没有改变，但没有在最终全文件 hash 上重复跑 52 态。运行使用 fake `wx` 和内存 Map，没有新建或保存真实项目。见 [52 态报告](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-iphone-readability-2026-10-07/project-modal-after/project-modal-browser-metrics.json) 及 [创建输入截图](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-iphone-readability-2026-10-07/project-modal-after/320x480-light-project-create-input-glyph-crop.png)。

**结果图：8 张 QA 图均无裁切、重叠或缺失。** 其中 6 张来自真实计算引擎场景：普通、未选 HPF、提示态、并联、桥接和高 HPF；常规图高 1522px，提示态 1620px。另有 2 张明确标记的合成补充/冲突换行夹具，高 1994px 和 1730px，仅用于排版压力测试，不代表真实设备配置。实际输入组合示例见 [普通结果图](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-iphone-readability-2026-10-07/after-reports/valid.png)、[提示态图](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-iphone-readability-2026-10-07/after-reports/advisory.png)；所有场景和文本边界记录见 [evidence.json](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-iphone-readability-2026-10-07/after-reports/evidence.json)。

**DevTools 页面与绘图证据。** 当前微信开发者工具视口记录为 390×753、浅色；标题行框 25px，输入面板因自然布局分配为 260px，结果卡到输入面板的几何距离约 12.67px。当前页面既有输入为 TC-2700B / KF-D12F、1 只、1V、HPF 20Hz，计算结果阈值 −18.1 dBFS、Attack 45ms、Release 720ms。DevTools 实际导出图为 1500×3044（逻辑高度 1522px），预览与导出走相同生成路径；截图可见 [最终主页面](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-iphone-readability-2026-10-07/final-main-native.png)、[导出图](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-iphone-readability-2026-10-07/final-native-export.png)与[分享预览](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-iphone-readability-2026-10-07/final-share-native.png)。

项目输入的 6 张 DevTools 字形截图（5 个测量阶段及 1 张选择态截图）显示输入框为 52px 高；这些截图来自 CSS SHA `b710183b5d14f0dc7185179abb627c6508534084826c8692034846546394f875`、renderer SHA `3ee525ea20dc72cbe13c3b7e46d804607a81b493a454ceed4b7ca304b3fc19b0`，仅用于观察占位符和含下降笔画的字形：[搜索空态](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-iphone-readability-2026-10-07/select-empty-native.png)、[创建填字态](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-iphone-readability-2026-10-07/create-filled-native.png)、[详情填字态](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-iphone-readability-2026-10-07/details-filled-native.png)。随后变更只涉及短屏主标题行高和结果图重复信息展示，不触及普通 390×753 项目输入规则。DevTools 输入框截图不等于项目创建/保存流程通过，也不等于实体 iPhone NativeInput 验收。完整平台、尺寸和来源说明见 [native-evidence-summary.json](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-iphone-readability-2026-10-07/native-evidence-summary.json)。

**回归与编译。** 三个专项脚本（限幅器页面状态、项目元数据、结果图生命周期）及两项 JS 语法检查均 exit 0；生成/缓存、画布上下文创建失败、文本测量失败、延迟导出 4 个生命周期场景通过。微信官方本地编译器处理 29 个 WXML 与 26 个 WXSS 文件，均 exit 0。记录分别见 [专项测试执行](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-iphone-readability-2026-10-07/tests/execution.json)、[生命周期回归](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-iphone-readability-2026-10-07/generation-regression.json)和[官方编译记录](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-iphone-readability-2026-10-07/compile/compile-execution.json)。

`tests/release-check.js` 在包体积总量门禁退出，未执行后续门禁。独立源码体积报告按项目打包忽略规则统计 204 个有效源码文件：总量 2,799,882 bytes（2734.26 KiB）/2650 KiB，主 JS 936.404/874 KiB，WXSS 309.688/292 KiB，WXML 291.352/284 KiB，四项均超限。本轮总量较冻结前减少 624 bytes；门槛未改。这是有效源码统计，不是微信编译包或上传包。详见 [源码体积记录](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-iphone-readability-2026-10-07/source-size-after-refinement.json)。

## 手机预览

已按本次持续真机测试的授权，从主项目目录生成新版私人预览码（2026-10-07 12:18，UTC+08）。官方 CLI 返回 `√ preview`，二维码文件实际存在：[新版手机预览码](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-iphone-readability-2026-10-07/phone-preview-20261007-readability/wechat-preview-qr.png)。[官方预览回执](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-iphone-readability-2026-10-07/phone-preview-20261007-readability/wechat-preview-info.json)记录编译预览包总量 2,379,324 bytes、主包 1,401,624 bytes；该统计与前述有效源码门槛口径不同，不代表源码门槛通过或实体设备验证通过。

## 未验证事项

- 新版实体 iPhone 上的输入裁字、iPhone/Android 设备差异；目前三张用户 iPhone 图是改版前证据。
- 原生短屏和深色主题、系统键盘、动态大字、实体设备触感与性能。
- 系统分享菜单、向好友发送后收到纯图片、相册权限，以及真实项目创建/保存数据流。
- 已上传私人预览供真机测试；没有 commit、push、正式发布或部署。

模拟器和 Chromium 结果不能替代以上设备验证。实体 iPhone 截图取得后，才能把 NativeInput 裁字状态从“未验证”改为设备实测结论。
