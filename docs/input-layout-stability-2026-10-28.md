# 输入期间结果区高度稳定性记录（2026-10-28）

## 现象与修正

线缆、声压级和 LED 大屏页面在数值输入期间会用 pending/空态替换大块结果内容，导致结果区收缩；计算完成后再恢复，页面随每次输入或删除跳动。摄像机页已有测高占位，本次未修改。

三页在首次渲染、页面显示、窗口尺寸变化、SPL 结果分类切换，以及有效结果提交后测量 `.result-card`。仅在 pending 或无有效结果时应用测得的 `min-height`；有效结果继续按内容自然撑开，不固定高度、不裁切结果。reset 时直接清除占位样式。101→1011 等输入若产生真实的新警告，完成态按完整警告内容自然增高。

共享 helper 对 selector 不可用或抛错、无效高度、页面隐藏/卸载、输入 pending、结果引用变化及过期测量请求做保护；相同高度不重复触发 `setData`。测量不参与计算结果、校验、输入时机、偏好写入或记录存储。

## 修改范围

- `pages/cable/cable.js`、`pages/cable/cable.wxml`
- `pages/spl/spl.js`、`pages/spl/spl.wxml`
- `pages/led-screen/led-screen.js`、`pages/led-screen/led-screen.wxml`
- `pages/common/result-card-placeholder.js`
- `tests/input-layout-stability-2026-10-28.cjs`
- `tests/package-reclaim/ui-resources.cjs`、`tests/release-check.js`
- `tests/report-canvas-equivalence.js`（完整页面状态合同显式容纳纯布局字段）

新增主包 JavaScript 为 1629 bytes；按任务开始时 1,571,134 / 1,572,864 bytes 计算，剩余 101 bytes。未调整预算门槛。

## 验证

- `node --check`：页面 JS、共享 helper 与本次测试文件通过。
- `node tests/input-layout-stability-2026-10-28.cjs`：helper 竞态、无效测量与异常路径通过。
- `node tests/package-reclaim/ui-resources.cjs`：历史 WXML 哈希通过；测试仅剥离三处精确的 `resultAreaStyle` 绑定，并断言每处在对应结果卡上且只出现一次。
- `node tests/report-canvas-equivalence.js`：通过，12 个 LED 生命周期场景与 12 个历史结果图场景通过；报告 fixture 和画布输出合同未改。
- `git diff --check`：通过。
- 官方小程序 `wcc`/`wcsc`：exit 0，74 个编译源文件通过。
- `node tests/release-check.js`：exit 0，完整发布检查通过；日志：`tmp/input-layout-jump-20261028/release-final.log`。
- 浏览器几何复验：`tmp/input-layout-jump-20261028/after/summary.json` 及同目录截图。首屏缓存高度为 cable 364px、SPL 437px、LED 414px；三页 pending 时输入卡坐标偏移均不超过 1px。普通值、空态、错误、恢复与 reset 的业务结果/动作状态和 before 一致。
- 边界复验：cable 输入 `1011` 后完整显示两条真实警告，结果卡因内容增加自然增高 201.6px；删除期间保留 566px 占位，普通结果完成后自然缩回。SPL 切换距离/参考页后输入仍按原 handler 返回声压级页，pending 保留已缓存的高度；完成后结果自然变矮 63.3px/28.0px，原有切换语义未改变。
- 页面构建后 10 个生产源 hash 与当前文件一致。未人为调整结果文案、输入内容或校验来规避位移。
- 用户验收：2026-10-28，用户通过最新手机预览二维码 `phone-preview-20261028-142631` 验收线缆、SPL、LED 大屏三页的数字输入/删除稳定性。本记录仅覆盖此项修复，不外推为其他页面或动画已通过手机/真机验收。

本次输入稳定性修复未更改 `utils/`、`data/`、数值规则、偏好/记录存储语义或相机页面。版本号与发布状态见[版本记录](../CHANGELOG.md)。
