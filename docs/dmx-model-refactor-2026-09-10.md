# DMX 位置图模型抽取（2026-09-10）

本轮将 `pages/dmx-layout/page-factory.js` 中的纯几何、杆位排布、位置归一化/恢复、舞台矩形和导出测量模型迁移到 `pages/dmx-layout/layout-model.js`。页面工厂仍保留 `createDmxLayoutPage`、Canvas 上下文、手势、存储、生命周期和导出执行体，并通过原有参数和返回结构调用模型。

新增 `tests/dmx-layout-model-test.js`，直接使用纯模块与真实 `calculateDmxAddressPlan` 合法灯具结果，覆盖 1–6 排、top/top-front/full、1–3 对侧光、前沿方向、竖横画布、杆位守恒与平衡、位置保存恢复、最近吸附、杆位互转、舞台比例居中、测量分支、排序和状态。

Astra 独立复审完成 648 个场景、33294 次纯函数结果对比，26 个迁移函数体与原文逐字一致；`createDmxLayoutPage` 逐字一致。页面等价复核覆盖 24 个场景（横竖屏、浅深主题、1/17/500 台、保留未布置两种状态）、144 个状态快照、207512 条 Canvas 指令，以及存储和提示效果，结果完全一致。

补充专项断言后，`node tests/dmx-layout-model-test.js` 与完整 `node tests/release-check.js` 均通过；完整发布检查包体为 1510.7 KiB / 1512.0 KiB。

本轮未修改编址页、`utils/`、`data/`、WXML/WXSS、手势/存储语义、算法基准或版本预算。包体仍按既有源码门禁记录；未进行 IDE 编译、浏览器渲染或真机验证。
