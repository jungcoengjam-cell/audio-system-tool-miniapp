# 接线入口性能观察与验证（2026-10-27）

本文记录接线助手和控制协议入口调整后的性能观察，以及自动化验证范围。真机数据来自本轮真机 Console 观察；自动化测试结果来自 Node 和模拟 Canvas/Page harness。两类证据分别列出。

## 真机 Console 样本

| 页面与样本 | 记录值 |
| --- | --- |
| 接线助手，调整前热进入 | `total=863ms`，`diagramHeight=385ms`，`reportHeight=429ms`，`setData=1` |
| 接线助手，调整后冷进入 | `total=2448ms`，`tapToModule=1652ms` |
| 接线助手，调整后热进入 | `total=220ms`，`initialData=187ms`，`diagramHeight=94ms`，`reportHeight=91ms`，`setData=1`，`onLoadEndToReady=6ms` |
| 控制协议，直达详情页 | 一次冷样本 `245ms`；热样本记录为 `62ms` 和 `84ms` |
| 控制协议，经旧 index 中转页 | 热样本记录为 `568.8ms` 和 `603.7ms` |

这些是少量单次样本，未形成设备或版本分组下的统计结果。冷、热样本及入口路径不同，不能据此把差异归因于单一改动，也不能据此保证其他设备或环境有相同表现。真机开发调试链路可能带来额外延迟，但本表没有量化它的影响。

`onReady` 是本计时探针记录的生命周期边界，不代表接线 Canvas 图片已经加载完成、首帧已绘制或页面已完全可操作。`tapToReady` / `total` 不应解释为完整图片就绪时间。`initialData` 子项的分段是探针耗时，不是对各业务操作耗时的独立分析。

## 用户反馈的真机测试范围

用户反馈已完成以下真机操作，并明确确认“都正常”：接线助手两次、控制协议两次、接线图显示、接口切换和结果图片预览。此结论只覆盖用户报告的这些场景。

## Node 与 harness 验证

2026-10-27 在本地工作区完成以下验证：

- `node tests/load-timing-probe-regression.cjs`：通过。覆盖计时样本、直接控制协议入口、旧 index 查询转发以及接线助手 `onLoadEnd` 分段与 Page 语义。
- `node tests/audio-wiring-geometry-cache-regression.cjs`：通过。使用真实 Page 定义和模拟 SelectorQuery/Canvas 对照冷算与热缓存路径，比较高度、曲线、交叉避让段、命中区域及报告绘图命令；也覆盖主题/宽度/接口变化、两槽淘汰、对象污染隔离和异常回退。
- `node tests/release-check.js`：通过，exit code 0。
- JS `node --check`：相关源码及专项测试通过。计时接入时，工具页 WXML 已通过官方 `wcc` 编译；后续缓存和入口优化未再改动 WXML/WXSS。

以上是 Node 与模拟 Canvas/Page harness 的结果，不是微信运行时或真机性能证明。

## 变更范围与缓存边界

- 工具卡中的控制协议入口改为直达详情页；旧 index 路由仍保留，并继续兼容两个 query 字段的转发。导航回归覆盖新入口和旧入口。
- 接线助手为 `onLoad` 增加耗时分段，并在符合条件时使用最多两个跨页面的纯几何曲线快照。缓存只接收本页 `onLoad` 静态模型工厂生成的模型；命中后绑定当前页面自己的端点锚点，仍执行原有交叉避让处理。
- 缓存不保存或共享页面模型、图片、Canvas、用户记录或持久化数据；不成功或无效的几何结果不写入缓存。缓存辅助路径异常时回退原 solver；solver 自身异常仍沿用既有安全 fallback。
- 本轮未修改 `selectSolderRoutes`、`addCrossingGaps`、产品数据、界面视觉、存储语义或记录格式。
