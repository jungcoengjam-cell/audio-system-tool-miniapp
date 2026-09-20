# DMX 结果视图模型提取（2026-09-10）

## 范围

将 `pages/dmx-address/dmx-address.js` 中的结果视图建模函数提取到 `pages/dmx-address/result-view.js`：`getFixtureProgressKey`、`formatViewAddress`、`buildUniverseGroups`、`buildUniverseDetailGroups`、`buildGroupViews` 和 `buildResultView`。新模块保留 `DMX/构建结果视图` 的性能测量调用及原参数，导出页面实际使用的 `UNIVERSE_LABELS`、`FIXTURE_DETAIL_PAGE_SIZE`、`getFixtureProgressKey` 和 `buildResultView`。

页面继续负责 `calculateDmxAddressPlan`、输入归一化与分组、搜索和编辑、生命周期、分页事件、增量 `setData`、进度读写、报告记录及通道指南懒加载。结果视图模块只读取 `stage-lighting` 的型号集合以显示通道指南入口，不提前加载完整通道资料。

## 验收

- `node tests/dmx-result-view-test.js`：通过。覆盖真实编址结果的自动跨域、手动分域、域尾和满域边界、空闲域、universe/group 模式、非法选择回退、折叠展开、80/160/500 台分页、部分分组、TL-SE3401 4/16/88/168CH 指南可用性与 custom 无指南、错误结果对象 identity，以及输入 result/viewState/Set 不变性。
- 独立对照：5040 组 view 场景、6450 次函数检查、6 个迁移函数体逐字不变；页面 `Page({...})` 文本与 72 个 Page 方法原样保留；测量事件参数/顺序一致；输入 result/viewState/Set 无改写；无提前加载通道指南。
- `node tests/release-check.js`：通过（exit 0）。发布包总计 1511.5 KiB / 1512 KiB，主包 JS 663.1 KiB，DMX 分包 JS 235.8 KiB，WXSS 208.0 KiB，WXML 188.5 KiB；既有 audit/runtime/layout/report 回归均通过。
- 已完成原生编译相关检查：WCC 编址页、结果报告预览模板、WCSC app/sharedtheme/编址页样式均 exit 0；未执行完整 IDE 编译或真机检查。
- 页面从 1319 行减至 1042 行；本轮生产源码净增加 357 bytes。源码门禁结果为 1511.5 KiB / 1512 KiB，不代表微信实际上传包体；本轮未测量上传包体。

本次未改变编址算法、产品数据、输入输出校验、记录或存储语义，也未改动布局模块。预算按当前项目基线维持。
