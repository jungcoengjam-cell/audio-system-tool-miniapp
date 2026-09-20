# DMX 位置图布局修复

本次修复只调整位置图的视觉几何与绘制：肖像画布为前沿灯具预留了独立的标注带，图例从前沿标记和灯具圈下方开始；面光文字会根据前沿方向放在灯具圈外。30 台以内的密集灯具按实际点间距限制绘制半径，页面原有的 44px 命中区域和位置模型保持不变。

模型继续提供唯一的 `stageRect`，拖动、点选和绘制共用同一舞台矩形。图例最多绘制 8 组，超过部分使用画布内的溢出说明。验证覆盖 12×8m、纵向/横向画布、前沿上下方向、双主题、地址显示开关和导出模式。

本轮文件清单：`pages/dmx-layout/layout-model.js`、`pages/dmx-layout/layout-renderer.js`、`tests/dmx-layout-model-test.js`、`tests/dmx-layout-renderer-test.js`、`tests/dmx-layout-overlap-test.js`、`tests/release-check.js`、`CHANGELOG.md`。专项回归覆盖 64 个场景；全量 release 检查通过，正式包预算结果以本次 release 输出为准。另经独立复核，21 个 WXML、22 个 WXSS 原生编译通过，模型保护函数源码和页面 controller 未变；真实 Canvas 10 个场景的普通图与导出图共 20 张已检查无文字碰撞或裁切。这些是静态/Canvas 验证，未进行真机或完整 IDE 验证。
