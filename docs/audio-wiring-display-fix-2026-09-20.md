# 接线助手原生 Canvas 显示层级修复记录

日期：2026-09-20。接线助手仍是本地未发布功能，正式版本保持 `5.0.1`。

## 真机反馈

真机截图显示，接线图 Canvas 覆盖了接口选择弹层和底部操作按钮，导致弹层选项与按钮可能无法触摸。此前 54 个浏览器模拟状态只覆盖普通页面绘制和 CSS 布局，没有覆盖微信原生 Canvas 与 WXML 组件的层级关系，因此未能发现这个问题；那批模拟结果不能作为原生层级通过的证据。

此问题发生在页面显示与触摸层级，不涉及 15 种支持映射或计算/记录语义。修复已将屏幕接线图迁移到微信 `type="2d"` Canvas API，同时保留用于生成接线报告图片的 legacy Canvas 导出路径。屏幕图在接口选择弹层或报告预览显示时会隐藏，避免原生 Canvas 层盖住 WXML 交互区域。

## 修复后的本地验证

修复后本地检查已完成：

- 完整 `node tests/release-check.js` 通过，日志见[release-check.log](verification/audio-wiring-display-2026-09-20/release-check.log)。页面专项测试使用严格 mock 覆盖映射、选择弹层、过期查询、resize、hidden/unload、报告缓存成功/失败及分享/保存路径。
- 本地 `wcc` 编译 22 个 WXML，`wcsc` 编译 23 个 WXSS，均退出码 0，见[native-compile.json](verification/audio-wiring-display-2026-09-20/native-compile.json)。
- 浏览器视觉检查覆盖 54 个页面状态和 210 个 Canvas 绘图状态，未发现绑定错误、页面溢出、屏幕 Canvas 溢出或文字重叠，见[summary.json](verification/audio-wiring-display-2026-09-20/final-review/summary.json)。独立视觉度量显示 selector/preview 状态不创建屏幕 Canvas，普通状态底部按钮未被 Canvas 覆盖；弹层打开时遮罩按预期阻断底层交互，见[visual-metrics.json](verification/audio-wiring-display-2026-09-20/final-review/visual-metrics.json)。最终截图包括[选择器（375 px，深色）](verification/audio-wiring-display-2026-09-20/final-review/selector-375-dark.png)和[XLR 接头视角（375 px，深色）](verification/audio-wiring-display-2026-09-20/final-review/xlr-back-375-dark.png)。
- 2D 后端像素检查覆盖 51 个绘制样例，均产生非空像素；DPR 稳定，未发现异常或 legacy 屏幕 Canvas 调用，见[real-canvas-review.json](verification/audio-wiring-display-2026-09-20/real-canvas-review.json)。这是本地 Canvas 2D 后端测试，不是微信真机。
- 修复后包体测量为 `1,895,808 bytes`；版本文件保持 `5.0.1`，34 个旧保护文件未变。包体细项见[package-review.json](verification/audio-wiring-display-2026-09-20/package-review.json)。

这些本地检查不能证明微信真机上的原生层级已经通过。真机层级、触摸和系统相册权限仍待验收；接线助手未发布，正式版本仍为 `5.0.1`。

## 待真机验收

1. 打开接口选择器，确认弹层显示在接线图上方，选项可点选且可关闭。
2. 弹层关闭后，滚动长接线图时确认底部“生成接线图”和“复制接法”仍可点击；弹层打开时确认遮罩阻断底层交互。
3. 在浅色/深色主题和不同屏幕尺寸下滚动页面、切换连线图/接头视角，确认 Canvas 正常绘制，弹层和底部操作保持可用。
4. 生成报告图并验证预览、转发和相册保存；确认 legacy 导出 Canvas 工作正常，并实际检查系统相册授权/拒绝流程。
