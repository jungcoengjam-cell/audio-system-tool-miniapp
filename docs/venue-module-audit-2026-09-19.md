# 会议室扩声模块自检与修复

本轮修复了三个可复现的问题：重复点选当前会议模式会清空仍在显示的布局图；直接卸载页面时，结果图片生成没有取消；页面隐藏或收起后，延迟到达的 Canvas 测量、导出与清理回调仍可能更新页面，旧清理回调还可能取消新导出的回退计时器。现在相同模式点击不触发清理，卸载会取消结果图任务；布局异步任务按可见状态和修订号作废，快照回调仅能清理自己的计时器。

PAG/NAG 数值编辑现在复用场景与实际计算输入相同的核心结果。连续有效编辑不重复执行房间估算或布局构建，不清除布局快照；结果报告仍会在内容变化后失效。输入校验、偏好、记录和报告内容保持原有语义。参数标签与分级卡片字号已增大，SPL 与等级改为上下排列，保持控件点击高度不少于 44px，并保留 PAG 图示。

| 最大围桌案例：40 次 Ds 编辑，方案图已打开 | 修改前 | 修改后 |
| --- | ---: | ---: |
| 结果桥接载荷累计 | 1,367,782 bytes | 24,862 bytes（减少 98.18%） |
| 讨论型估算器调用 | 40 | 0 |
| 方案布局构建调用 | 40 | 0 |
| 单次最大桥接载荷 | 34,210 bytes | 637 bytes |

以上性能数字来自桌面 Node.js 测量，只计算页面状态补丁，不含微信设备桥接与 Canvas 绘制耗时，不能代表手机帧率。它衡量指定 40 次编辑场景，不扩展算法或声学模型的适用范围。

`node tests/release-check.js` 退出码为 0；21 个 WXML 和 22 个 WXSS 文件通过原生编译；浏览器近似渲染的 48 个页面状态无绑定错误、溢出或过小控件。独立兼容性核对通过 619 项比较、180 次输入提交、3 次偏好恢复、5 次报告失效、2 个延迟渲染场景及旧快照回调隔离检查。

最终有效包为 1,720,282 bytes（主包 JS 781,465、WXSS 227,501、WXML 206,097、媒体 254,616 bytes）；版本仍为 5.0.0。

运行时代码改动仅在 `pages/venue/venue.js` 与 `pages/venue/venue.wxss`。相关回归位于 `tests/venue-lifecycle-regression.js`、`tests/venue-pag-nag-performance-regression.js`，并更新 PAG 页面/多音箱测试的 `setData` 嵌套路径模拟和发布检查入口。`utils/`、`data/`、renderer、计算基准、+18.4 dBu 校准值及记录存储语义未改。版本仍为 5.0.0；未上传或发布，未做真机或现场声学测试。

审计证据：

- [独立兼容性检查](verification/venue-module-audit-2026-09-19/independent-compatibility.json)
- [性能修改前](verification/venue-module-audit-2026-09-19/performance-before.json) 与[修改后](verification/venue-module-audit-2026-09-19/performance-root-after.json)
- [原生编译结果](verification/venue-module-audit-2026-09-19/native-compile.json) 与[完整发布检查日志](verification/venue-module-audit-2026-09-19/release-check.log)
- [包体测量](verification/venue-module-audit-2026-09-19/package-review.json)、[修改前页面检查](verification/venue-module-audit-2026-09-19/before/visual-summary.json) 与[修改后页面检查](verification/venue-module-audit-2026-09-19/after/visual-summary.json)
