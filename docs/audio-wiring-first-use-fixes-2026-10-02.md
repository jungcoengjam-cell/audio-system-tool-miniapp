# 接线助手首次使用体验修复验收记录

日期：2026-10-02

这次调整针对第一次打开“接线助手”的使用过程，范围是 `pages/audio-wiring` 页面、绘图和报告、相关专项测试及方法说明。接线模型、产品数据和原有接线条件校验保持不变。

## 使用体验问题与修复

1. **默认接口容易被当成已识别的设备。** 页面仍以 XLR 平衡输出接平衡端子作为示例，但现在明确标记“当前为默认示例；正式制作前，请核对并选择实际两端接口”。两端分别记录用户是否选择；选择器里点中当前接口也算手动选择该端。只手动选择一端时，另一端仍显示默认示例。示例仍可查看、复制和导出，提示同时写进复制文本和导出图，不新增确认门槛。

2. **只看接头外形不容易判断信号类型。** 接口卡把接口类型和信号用途分开展示，例如 LINE OUT 与平衡单声道，设备类别降为“常见于……”说明。选择器的帮助页解释 OUT、IN、LINE，说明 TS 有 T/S 两个触点、TRS 有 T/R/S 三个触点，但触点数量不能判定平衡方式或声道数；TRRS 耳麦、MIC 输入和数字接口不在本助手范围内。端子按 +、−、G 功能丝印和具体型号说明书核对。

3. **3.5 mm 立体声输出接单声道时，不清楚该选 L 还是 R。** `sourceChannel` 选项旁现在说明：直连只取 L 或 R 一路，另一路不接；需要左右两路内容时，应接双路输入，或先由播放设备/混音器合成为单声道，不能直接并接 L/R。

4. **平衡输出接 RCA/TS 时，冷端确认不清楚，也难以撤回。** 页面在 `outputMode` 选择旁提供手册核对步骤：按两台设备的具体型号查 LINE OUT/LINE IN、pin 3、−/cold、shield/ground，并确认手册明确允许在输入端汇接。找不到明确许可时先停止并联系厂家。用户选了冷端汇接后，可点“无法确认？撤回确认”，接法立即回到原有 `needs-choice` 状态；没有默认冷端悬空选项。

5. **导出图可能与当前看到的视角不同。** 导出现在使用点击时的连线图/接头视角、插接面/焊接面、选中连线和主题，并在报告中标明视角。所有接线对应、未接脚、注意事项和资料来源仍保留；提示状态或视角改变时会清除过期图片。按钮标为“导出方案图片”，并说明“按当前视角导出”。

6. **离开后重进会忘记接口和视角，或让人担心旧条件仍生效。** 页面仅在本机按版本保存接口 ID、两端是否手动选择以及视角/观察面。重进时恢复这些偏好并提醒按本次设备核对；L/R、分送和冷端等条件每次重新选择，历史值不能让接线自动就绪。页面不保存接线结果、复制内容或针脚方案。存储数据无效、API 缺失或读写失败时会回退或提示，当前页面仍可操作。

复审另补：复制内容也带默认示例、单端未手动选择或恢复待核对提示；两端都手动选择后则复制原接线正文，不附加提示。程序记录的是端口选择操作，不能证明用户查阅了设备手册。正文里的接线内容保持模型生成结果。

## 验证结果

- 三项专项 Node 测试全部退出码 0：模型、页面控制器和报告绘图回归通过。页面测试使用严格 Canvas、选择器和系统接口 mock；它不验证微信原生渲染层、真机表现或相册权限。
- 微信小程序编译器检查通过：WCC 编译 28 个文件、WCSC 编译 26 个文件，退出码均为 0。
- 本地浏览器模拟当前页面 WXML、WXSS 和页面逻辑：在 320、375、430 px 的浅色和深色条件下检查首屏；另在 375 px 浅色和 320 px 深色检查帮助、声道、焊接面导出、退出重进及冷端撤回等交互。未发现横向溢出、控件超出视口或低于 44 px 的新增控件。该模拟不是微信真机测试。
- 报告绘图检查覆盖 67 种可显示方案 × 3 种视角 × 2 种主题 × 3 种提示状态，共 1,206 张 Canvas 报告；文字边界检查未发现越界或重叠。
- 保护清单中的 39 个 `utils/`、`data/` 文件和 8 个模型、共享模板、样式及配置文件哈希均未变化。
- **完整发布检查未通过。** 修复前后 `tests/release-check.js` 都在同一条既有主题导入集合断言失败：实际 21 项、预期 17 项；`samePreexistingGate` 为 `true`。因此本记录确认专项和页面验收结果，不代表完整发布检查通过。未验证真机相册系统权限或分享面板行为。

## 证据

证据文件保存在本机目录 `C:\Users\wxx\.codex\visualizations\2026\10\02\01a0fcf0-baf0-7073-80f9-351f66028727\wiring-fix`：

- [audio-wiring-tests.log](/C:/Users/wxx/.codex/visualizations/2026/10/02/01a0fcf0-baf0-7073-80f9-351f66028727/wiring-fix/audio-wiring-tests.log)：三项专项测试的命令和退出结果。
- [native-compile.json](/C:/Users/wxx/.codex/visualizations/2026/10/02/01a0fcf0-baf0-7073-80f9-351f66028727/wiring-fix/native-compile.json)：WCC/WCSC 编译结果。
- [browser-verification.json](/C:/Users/wxx/.codex/visualizations/2026/10/02/01a0fcf0-baf0-7073-80f9-351f66028727/wiring-fix/browser-verification.json) 和 [browser-layout-metrics.json](/C:/Users/wxx/.codex/visualizations/2026/10/02/01a0fcf0-baf0-7073-80f9-351f66028727/wiring-fix/browser-layout-metrics.json)：模拟器交互及布局测量结果。
- [report-visual-summary.json](/C:/Users/wxx/.codex/visualizations/2026/10/02/01a0fcf0-baf0-7073-80f9-351f66028727/wiring-fix/report-visual-summary.json)：报告数量和越界/重叠汇总。
- [protected-after.json](/C:/Users/wxx/.codex/visualizations/2026/10/02/01a0fcf0-baf0-7073-80f9-351f66028727/wiring-fix/protected-after.json)：受保护文件哈希对比。
- [release-summary.json](/C:/Users/wxx/.codex/visualizations/2026/10/02/01a0fcf0-baf0-7073-80f9-351f66028727/wiring-fix/release-summary.json)、[release-before.log](/C:/Users/wxx/.codex/visualizations/2026/10/02/01a0fcf0-baf0-7073-80f9-351f66028727/wiring-fix/release-before.log) 和 [release-after.log](/C:/Users/wxx/.codex/visualizations/2026/10/02/01a0fcf0-baf0-7073-80f9-351f66028727/wiring-fix/release-after.log)：记录完整发布检查的既有失败及前后对照。
- 截图：[375 px 默认页·浅色](/C:/Users/wxx/.codex/visualizations/2026/10/02/01a0fcf0-baf0-7073-80f9-351f66028727/wiring-fix/after-default-375-light.jpg)、[320 px 接口帮助·深色](/C:/Users/wxx/.codex/visualizations/2026/10/02/01a0fcf0-baf0-7073-80f9-351f66028727/wiring-fix/after-interface-help-320-dark.jpg)。

## 本次文件

- `pages/audio-wiring/index.js`
- `pages/audio-wiring/index.wxml`
- `pages/audio-wiring/index.wxss`
- `pages/audio-wiring/wiring-renderer.js`
- `tests/audio-wiring-page-test.js`
- `tests/audio-wiring-renderer-test.js`
- `docs/audio-wiring-method.md`
- `docs/audio-wiring-first-use-fixes-2026-10-02.md`（本记录）
