# 限幅器居中、分享图与项目键盘验收（2026-10-07）

**状态：86 项浏览器矩阵通过，当前 DevTools 键盘几何检查通过，分享图检查通过；Sol 范围复审 PASS_SCOPE_ONLY，整体 NOT_COMPLETE。** 实体手机与系统键盘未验，DevTools 与 Chromium 均不代表实体 iPhone/Android。[独立复审记录](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-centering-share-keyboard-2026-10-07/sol-final-review.json)

基线为 `master` / `de758b643ff1bd4beabd6f6dbb1ee88a4d026e0e`。原有 dirty worktree 保留，未重置、提交、推送或正式发布。计算、产品数据、校验、记录/payload、偏好、缓存与 15 秒提醒语义不变。范围报告核对 219 项保护文件未变、14 个受保护 helper 不变、旧数据字段无差异、无违规；`commitInput` 与 `saveProjectConfiguration` 除键盘 UI reset 调用外保持一致。[范围报告](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-centering-share-keyboard-2026-10-07/scope-verification.json)

| 文件 | 本轮用途 | SHA-256 |
|---|---|---|
| [limiter.js](C:/Users/wxx/Documents/Codex/audio-system-tool-miniapp/pages/limiter/limiter.js) | 本页键盘高度、步骤与 episode UI 状态 | `543919E8BE54829131FAA8866D691B1E9C818CF30DFCE23209F512926864545E` |
| [limiter-overlays.wxml](C:/Users/wxx/Documents/Codex/audio-system-tool-miniapp/pages/limiter/limiter-overlays.wxml) | 项目弹层与输入字段的键盘/episode 绑定 | `DE3EA4416898662225C0868824705E8F47FB141953A2E23D28F2F99EE07109B0` |
| [limiter.wxss](C:/Users/wxx/Documents/Codex/audio-system-tool-miniapp/pages/limiter/limiter.wxss) | 页面、弹层样式；键盘态备注框 84px | `C82F96B3D39687564E1CA8F45027E976321C02413B334B2FC9FB54496B28FB34` |
| [limiter.wxml](C:/Users/wxx/Documents/Codex/audio-system-tool-miniapp/pages/limiter/limiter.wxml) | 页面键盘态容器 class | `CD20D4B93D72DEF74D9C159CE452F7280BDBC2B95FD9CFDD3084A276E94A43A8` |
| [limiter-report.js](C:/Users/wxx/Documents/Codex/audio-system-tool-miniapp/pages/limiter/limiter-report.js) | 分享图片视觉绘制 | `DD6DA755B9450BC274FEB67625BE5F04D67E9D579E251A149C58B6BD04A97B99` |

## 居中与分享图

390×753 Chromium 测量中，卡片、次级网格和 Attack/Release 组合中心约 195px，阈值数字加单位为 194.99px；墨迹组合约 193.3–193.9px。纯数字范围中心 175.43px 是右侧单位造成的范围差异。320×480 次级区滚至 `scrollTop=59` 到底。DevTools 主卡及主内容容器中心约 195px；四格数值与标签偏差不超过 0.51px 的结论来自 Chromium。证据不支持整体平移。[Chromium 居中与短屏滚动测量](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-centering-share-keyboard-2026-10-07/centering-measurements/centering-metrics.json)、[DevTools 主结果测量](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-centering-share-keyboard-2026-10-07/final-main-native-bounds.execution.json)。

分享图为浅灰底、淡蓝主卡、绿色主值；状态、固定说明、信任说明、版本/资料/来源/生成时间不绘制。最终 8 个 Canvas 样本（6 个真实计算场景、2 个合成补充/冲突场景）无裁切、重叠、缺失或意外旧文案；普通图高 994px，提示图 1058px，旧普通图 1522px。[最终绘制证据](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-centering-share-keyboard-2026-10-07/final-reports/evidence.json)。DevTools PNG 为 1500×1988px，renderer DD6 与最终一致；该导出来自先前键盘控制器 JS5C 版本，仅验证绘图。输入 TC-2700B/KF-D12F、单只、HPF 20Hz、1V，结果 −18.1dBFS / 45ms / 720ms。[实际导出图](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-centering-share-keyboard-2026-10-07/final-native-export.png)

## 项目键盘

项目弹层采用固定标题、滚动表单、独立底部操作区；四个控件绑定布尔 `adjust-position=false`。键盘可视区用 `H0`（打开时窗口）、`H`（当前窗口）、`K`（键盘高度）计算 `visible=max(0,min(H,H0-K))` 和 `lift=max(0,K-max(0,H0-H))`，避免 resize 后重复抬升。早期创建表单 body 在 DevTools 收缩为 0；最终 Chromium 的 55 项列表已可滚达。正文现为自然高度并受可视高度约束。步骤字段白名单和递增 `projectKeyboardEpisode` 拦截切步、关开、隐藏恢复后的迟到 focus/blur/height；focus-session 与时间戳守卫保留。

最终 86 项 Chromium 矩阵 source-stable、0 failures：12 main、16 project、48 keyboard、10 lifecycle。它使用实际页面、WXML 声明绑定和 Chromium，不是原生运行时。55 项列表可到达，CTA 至少 48px，键盘底部操作区距键盘上沿至少 8px、输入框 52px 且不被覆盖；K=0 与 resize 情况的底部锚点稳定，弹层顶部随内容自然变化允许。Bridge 将原生 textarea 默认 150px、键盘态局部规则映射为 84px；不据此声称真机光标/输入通过。矩阵 SHA-256：`17E456F05CE9D948F3F7E4B697DBB43CCCC9704A75FC9F1B5B623B5D1EBC5B`。[最终矩阵](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-centering-share-keyboard-2026-10-07/keyboard-layout-matrix-candidate5/execution.json)

DevTools 最新 note 测量使用 JS543 / overlayDE / CSS C82：键盘高度为 0 时备注框 150px；注入 K=300 后为 84px；再次 K=0 恢复 150px。[K=0 前](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-centering-share-keyboard-2026-10-07/note-final-zero-before-native-bounds.execution.json)、[K=300 备注框边界](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-centering-share-keyboard-2026-10-07/note-final-active-native-bounds.execution.json)、[活动态截图](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-centering-share-keyboard-2026-10-07/note-final-active-native.png)、[K=0 恢复](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-centering-share-keyboard-2026-10-07/note-final-zero-after-native-bounds.execution.json)。活动态 body 从 y=63 到 391.67px，footer 底为 444.67px、可视区底（键盘上沿）为 453px，间距约 8.33px。

当前 episode 合法的 create K=300 DevTools 捕获测得输入框高 52px、body 高 75.86px、footer 间距 8.33px；该捕获是 JS543/overlayDE/CSS E287，备注框规则尚未加，但该步骤不包含备注。[create 边界](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-centering-share-keyboard-2026-10-07/create-final-keyboard-native-bounds.execution.json)、[create 截图](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-centering-share-keyboard-2026-10-07/create-final-keyboard-native.png)。独立事件归属检查 4 项通过，但使用 fake wx/内存 Map，不模拟原生键盘。[episode 检查](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-centering-share-keyboard-2026-10-07/sol-keyboard-episode-review.json)

最终原生几何审计在 JS543、overlayDE、CSS C82 下通过：备注框高度按 K=0 → K=300 → K=0 为 150 → 84 → 150px；项目设置输入框高 52px，K=300 时 footer 底部距键盘可视上沿约 8.33px，记录与偏好保持一致。[原生最终汇总](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-centering-share-keyboard-2026-10-07/native-final-summary.json)

这些采样运行于微信 DevTools：platform `devtools`、SDK 3.16.2、窗口 390×753、屏幕 390×844、安全区底部 34px、`physicalDevice=false`。备注高度场景以注入的键盘高度触发 CSS，不是 iOS/Android 系统键盘。200 字备注光标可见性、物理 iPhone/Android 键盘与触摸、实际创建/保存以及动态大字未验证。最终设备状态见[DevTools 环境记录](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-centering-share-keyboard-2026-10-07/final-native-system.execution.json)。

## 编译、回归与预算

- 最新 CSS C82 官方编译：55 个页面文件，wcc/wcsc 均 exit 0。[编译记录](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-centering-share-keyboard-2026-10-07/compile/compile-execution.json)
- 页面状态、项目 metadata、报告生命周期 3 项回归，2 项语法检查与 4 项生成/缓存路径回归均在 JS543 / overlayDE 上通过，时间早于最后增加的 CSS 84px 规则；JS/WXML 未在该规则后改变。[回归记录](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-centering-share-keyboard-2026-10-07/tests/execution.json)、[生成回归](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-centering-share-keyboard-2026-10-07/generation-regression.json)
- 最新有效源码统计：204 文件共 2,815,223 B / 2749.241 KiB，超 2650 KiB 预算 101,623 B；主 JS 948.959/874 KiB、WXSS 310.319/292 KiB、WXML 293.147/284 KiB 均超限。这是有效源码体积，不是编译/上传包。[源码统计](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-centering-share-keyboard-2026-10-07/source-size-after-refinement.json)。`release-check.js` 的旧运行在加入 84px CSS 前以 2749.179 KiB 在总量门禁 exit 1，后续门禁未执行；未将其描述为当前 CSS 下完整 release 检查。

## 手机预览与剩余验证

2026-10-07 13:15（UTC+08）已按持续真机测试授权，从主项目目录上传私人预览并生成[新版二维码](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-centering-share-keyboard-2026-10-07/phone-preview-20261007-centering-share-keyboard/wechat-preview-qr.png)。官方 CLI 返回 `√ preview`、exit 0；[官方回执](C:/Users/wxx/.codex/visualizations/2026/10/06/01a11025-2118-7183-883a-0925c68a2bba/limiter-centering-share-keyboard-2026-10-07/phone-preview-20261007-centering-share-keyboard/wechat-preview-info.json)记录总编译包 2,390,041 B、主包 1,412,341 B。五个源码哈希与上传前的冻结清单相同；此统计口径与有效源码门槛不同，不代表四项源码门槛通过。

实体 iPhone/Android 键盘避让、长备注光标、原生短屏/深色和动态大字、实际项目创建与保存、系统分享与相册权限仍待验证。没有正式发布或部署。
