# 会议室 PAG/NAG 测量引导

本页记录 2026-09-19 单音箱图示引导的历史实现；多音箱取点扩展与当前验证见 [`docs/venue-pag-multiple-2026-09-19.md`](venue-pag-multiple-2026-09-19.md)。

2026-09-19 为会议室讨论型“传声增益检查”增加按测量项切换的图示引导。选择 Ds、D0、Dn、D1 或 D2 时，图上突出当前端点和对应测量线；选择 NOM 时，显示话筒“计入 / 不计”的状态示意。图下只显示所选项的原有输入，不自动填入距离或支数。距离图中的发言人、话筒、听众和实际送声音箱固定表示同一条链路，按空间直线距离测量并计入高度差。图示不按比例，也不根据房间或布局参数自动生成距离。NOM 按现场同时开放并参与该链路的话筒支数统计，即使暂时无人讲话；不代表参会人数或总安装数。

本次涉及 `pages/venue/venue.js`、`pages/venue/venue.wxml`、`pages/venue/venue.wxss`、`tests/venue-pag-nag-guide-regression.js` 和 `tests/release-check.js`。只增加临时引导选择状态、页面图示与必要的视觉回归/内部包体预警；计算、校验、结果与报告输出、收藏和存储语义未变。

验收证据：视觉脚本覆盖 320/375/430 宽度、浅/深色及空值/有效值共 48 状态；21 个 WXML、22 个 WXSS 原生编译通过；57 组业务结果与记录精确比较通过；完整 `node tests/release-check.js` 退出码 0。包体为 1,710,448 bytes，主包 JS 774,810 bytes、WXML 203,570 bytes、WXSS 226,849 bytes，媒体增量 0。详细结果见 [`visual-metrics.json`](verification/venue-pag-guide-2026-09-19/visual-metrics.json)、[`independent-audit.json`](verification/venue-pag-guide-2026-09-19/independent-audit.json)、[`native-compile.json`](verification/venue-pag-guide-2026-09-19/native-compile.json)、[`package-review.json`](verification/venue-pag-guide-2026-09-19/package-review.json) 和 [`release-check.log`](verification/venue-pag-guide-2026-09-19/release-check.log)。

版本仍为 5.0.0，本次未上传或发布；未进行微信真机或现场声学测试。
