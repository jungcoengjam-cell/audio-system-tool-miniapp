# 代码结构与包体审查（2026-09-30）

微信开发者工具截图显示全部代码包 2120 KB，其中主包 1204.2 KB，协议、DMX、音频布线、项目布线分包分别为 387.3、282.5、143.7、102.1 KB。该数值是 IDE 的编译包口径。当前可复现的源码文件口径为 2,550,600 bytes（约 2490.8 KiB）；两种口径不一致，且本轮未能取得开发者工具的最终编译包计数，因此不把源码字节差值当成截图所示编译包的变化量。

静态 CommonJS 入口审计覆盖 app 和 23 个注册页面，共 24 个入口触达 86 个生产 JavaScript 文件；未发现动态 `require`、孤立 JS 文件或安全可删除的整块代码。本次对 PNG 现有 IDAT 数据做无损重压探测，测得可减少 941 bytes；协议 JPG 没有可清理的大型 EXIF、ICC 或缩略图数据。两张协议样本照片合计 321,153 bytes（约 314 KiB），本轮保持原图；若继续资源优化，可另行比较展示尺寸与压缩质量的方案。本轮保留页面、分包和业务数据。

三处报告图片代码各自绘制内容不同，但在 Canvas 创建、`draw(false)`、延迟获取导出尺寸、PNG 参数、过期请求拦截、导出计时和成功/失败回调上存在同一套流程。将这段共同行为提取到 `utils/report-canvas.js`，三个调用方仍拥有自己的绘图、输入快照、修订号、加载提示、成功状态和异常处理。源码包由基线 2,550,600 bytes 降到 2,550,035 bytes，净减 565 bytes；主包 JS 从 837,628 降到 837,063 bytes，原有 818 KiB 内部门槛保持不变。净减约为源码包的 0.02%，属于小幅结构整理。

生产文件改动为 `pages/records/project.js`、`pages/led-screen/led-screen.js`、`utils/result-report-controller.js`，以及新增 `utils/report-canvas.js`。测试新增 `tests/report-canvas-equivalence.js` 和冻结 fixture，`tests/release-check.js` 仅注册新测试，预算及发布门禁未改。

审查和本轮实际改动的逐文件包体数、三处调用流程差分证据及基线出处见 [`verification/package-structure-2026-09-30/final-package.json`](verification/package-structure-2026-09-30/final-package.json)。回归测试同时运行当前实现与 `docs/recovery` 中的冻结原源码，检查三处真实调用方的 Canvas 方法及参数、属性赋值、`measureText` 输入和输出、导出参数、计时标签和细节、`setData` 回调顺序、页面数据和修订/签名状态。36 个成功、空路径、失败、过期回调、请求交错和同步异常场景的结果已固定为测试 fixture；默认发布门禁不依赖本机恢复目录，也不重新生成 fixture。可用 `node tests/report-canvas-equivalence.js --compare-before` 在保留恢复目录的本机做额外差分。

执行顺序说明：生产代码提取先于最终行为 fixture 和调用方差分测试完成；本次独立复审用起始快照的 `.baseline` 源文件补做了完整前后差分，36 个场景均一致。后续同类重构应先冻结行为 fixture，再改生产代码。

验证结果：三份 Canvas 调用流程均与冻结源码的 36 场景轨迹相同；报告绘图、报告生命周期和完整开发样本自检通过。完整 `release-check` 需要设置 `CONTROL_PROTOCOL_ALLOW_DRAFT_SAMPLE_FOR_TESTS=1` 才能覆盖仓库内现有协议开发样本；此覆盖仅用于本地回归，不代表样本可上传。默认发布检查的既有协议草稿门禁仍保留。

GPT-6.1 Sol 的独立复审通过，见[复审记录](verification/package-structure-2026-09-30/sol-independent-review.json)。最终真实执行记录见[回归执行记录](verification/package-structure-2026-09-30/final-release-execution.json)，可核对[完整本地回归输出](verification/package-structure-2026-09-30/final-local-release-stdout.log)和[默认发布检查的草稿阻断](verification/package-structure-2026-09-30/final-default-release-stderr.log)。

`wcc` 对 28 个 WXML、`wcsc` 对 26 个 WXSS 的本机编译在本次源码改动前通过；本轮生产改动仅涉及 JS。微信开发者工具状态检查未能在授权等待期内完成，未上传项目，故 IDE 编译后包体和真机行为没有本轮实测。算法、产品数据、计算基准、输入刷新、记录与存储语义、版本信息、WXML、WXSS 及图片均未改动。
