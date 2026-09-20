# DMX 位置图绘制抽取（2026-09-10）

本轮将 `pages/dmx-layout/page-factory.js` 的 `drawLayout` 绘制指令抽取到 `pages/dmx-layout/layout-renderer.js`。页面保留 Canvas 创建、无方案与 Canvas 能力判断、display/view 缩放与平移、`save`/`restore`、`draw` 及回调；renderer 只接收显式只读快照，不依赖 `this`、`wx` 或存储，也不持有或改写输入。

新增 `tests/dmx-layout-renderer-test.js`，使用真实 `calculateDmxAddressPlan` 合法灯具结果，覆盖浅色/深色、竖屏/横屏、前沿两方向、全部/智能/隐藏地址、导出强制地址并屏蔽选择与拖动预览、完成圈/选择圈、palette 预览、缺失位置、1/31/61/101/151/301 台半径阈值、超过 8 组图例和冻结快照。专项已接入 `tests/release-check.js`，主题源码断言同时检查 factory 与 renderer。

独立复核记录：1872 组 Canvas 场景、2,498,568 条绘制指令完全一致；24 组页面场景、144 个状态快照、207,512 条指令与存储提示完全一致；79 个非 `drawLayout` 页面方法函数体保持逐字一致。WCC/WCSC 原生编译覆盖两页 WXML、app.wxss、共享主题 WXSS 与两页 WXSS，均 exit 0；这不是完整 IDE 打包、浏览器视觉验证或真机验证。

`node tests/dmx-layout-renderer-test.js` 与完整 `node tests/release-check.js` 已通过；按源码门禁计算的发布包总量为 1511.7 KiB / 1512.0 KiB（不是微信实际上传后的压缩包体积）。

本轮未修改 `utils/`、`data/`、`layout-model.js`、WXML/WXSS、手势、存储、算法基准、配置、预算或版本。
