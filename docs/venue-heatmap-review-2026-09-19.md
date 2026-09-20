# 会议室布局图热力与几何交叠复核（2026-09-19）

报告/培训型布局图此前使用五档固定色。默认场景的 896 个听音网格均落在 `-3～+6 dB`，实际范围为 `-2.923～+5.410 dB`，因此整片听音区显示为同一绿色。围桌图此前只有很浅的几何覆盖填色，交叠层级和未覆盖区域不易辨认。

本轮只调整页面绘图和页面展示：报告图改为固定 dB 锚点渐变，使用 `relativeLevelDbRaw`；围桌图增加 32 列、按比例 20～48 行的几何包络交叠色层。报告图表达距离模型相对目标声压级，围桌图表达未包络、1 区、2 区和 ≥3 区几何交叠，两者都不代表现场声学覆盖达标。报告图例与 renderer 共用固定色带，画布高度按房间比例自适应并设上下限，编号标签增加浅色底板。

涉及页面文件为 `pages/venue/plan-renderer.js`、`pages/venue/venue.js`、`pages/venue/venue.wxml`、`pages/venue/venue.wxss`；新增专项为 `tests/venue-heatmap-renderer-regression.js` 与 `tests/venue-plan-controller-regression.js`。6 个 venue Canvas 视觉 fixture 由受限脚本更新，camera fixture 保持不变。

专项结果显示默认报告听音区由单色变为 190 种颜色。9 个页面案例（报告默认、热点、长墙、小场地；围桌圆桌、矩形、吸顶、壁挂、壁挂宽场）均完成 320/430 宽度、light/dark 共 36 状态检查，页面绑定和越界检查通过。原生编译通过 21 个 WXML 与 22 个 WXSS 文件。独立复核及图形统计见 [`docs/verification/venue-heatmap-2026-09-19/independent-review.json`](verification/venue-heatmap-2026-09-19/independent-review.json)，页面指标见 [`metrics.json`](verification/venue-heatmap-2026-09-19/metrics.json)，绘图记录见 [`drawings.json`](verification/venue-heatmap-2026-09-19/drawings.json)，原生编译记录见 [`native-compile.json`](verification/venue-heatmap-2026-09-19/native-compile.json)。

独立复核确认 34 个 `utils/`、`data/` 文件未变，4 个 camera fixture 未变。最终完整检查测得有效包 1,697,445 bytes、主包 JS 774,508 bytes、WXML 197,313 bytes、WXSS 220,405 bytes；相对初始总增 6,812 bytes，其中最后的刻度定位增加 362 bytes。该数值用于本轮内部预算记录，不代表平台上限。完整 `node tests/release-check.js` 已通过，日志见 [`release-check.log`](verification/venue-heatmap-2026-09-19/release-check.log)。

本轮未进行微信真机验证、厂家预测软件对照或现场声学测量；版本仍为 5.0.0，未发布。
