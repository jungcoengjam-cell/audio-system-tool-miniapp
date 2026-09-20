# 全项目代码审查（2026-09-10）

本次仅新增审查报告，未修改生产代码、产品数据、算法或用户存储。主代理已执行完整 `release-check` 并通过；本次复现使用内存模拟，不接触真实用户存储。未进行 UI 编译、浏览器渲染、真机手势或真机性能检查。

## 优先顺序

### P2：产品详情页忽略偏好写入失败

位置：[pages/products/detail.js:101-133](../pages/products/detail.js:101)。限幅器、声压、摄像机和 DMX 入口调用 `writePreferences` 后无论返回值如何都继续导航。内存注入 `wx.setStorageSync` 抛错时，摄像机入口仍进入计算页，用户看不到设置失败提示，目标型号也不会被可靠带入。

最小修复是为各入口统一处理写入结果，并在失败时停止导航、显示可重试提示。实现时必须区分 [utils/preferences.js:24](../utils/preferences.js:24) 的“签名未变化”返回 `false` 与 [utils/preferences.js:31](../utils/preferences.js:31) 的“存储失败”返回 `false`；不能简单把所有 `false` 都当作失败。建议给 `writePreferences` 增加不改变现有调用者语义的结果区分，或提供单独的失败可观测接口。

验收标准：偏好未变化时入口照常导航；注入 `setStorageSync` 抛错时不导航并提示重试；成功写入时四类入口行为保持不变。

### P2：LED 与项目报告导出失败回调缺少 revision 守卫

位置：[pages/led-screen/led-screen.js:320-323](../pages/led-screen/led-screen.js:320)、[pages/records/project.js:516-519](../pages/records/project.js:516)。两处 `canvasToTempFilePath` 的 `fail` 回调没有检查当前 `reportRevision`，会在页面卸载或新请求开始后仍执行 `finishReportGeneration` 和失败 Toast。VM 模拟 `generate → onUnload → late fail` 已复现旧失败 Toast；迟到成功/失败和新旧请求交错也应覆盖验证。

最小修复是在失败回调进入时检查对应 revision，保持共享 `result-report-controller` 已有的 revision 过滤语义。不能只隐藏 loading；迟到失败的测量收尾和用户提示也应被旧请求抑制。

验收标准：卸载后迟到成功/失败均不更新页面、不弹 Toast；旧请求失败不影响新请求；当前请求失败仍恢复按钮状态并提示用户。

### P2：最近产品记录对非法条目缺少逐项校验

位置：[utils/products.js:607-637](../utils/products.js:607)。`readRecentProductKeys` 只判断存储值是数组，`[null]` 等内容会通过；随后 `markProductViewed` 的 `item.type`、`getRecentProducts` 的 `item.type` 会抛 `TypeError`，影响产品库加载或产品详情页记录最近查看。

最小修复是在入口统一过滤合法的 `type` 和非空 `model`，保留合法最近项，不清除收藏、项目或其他用户数据。过滤后的数组仍按原有顺序和数量限制工作。

验收标准：存储包含 `[null, {}, {type:'speaker',model:'存在型号'}]` 时页面不抛错，合法项仍显示；未知型号被忽略；正常最近查看顺序不变。

## 页面职责重构建议

### DMX 位置图工厂

[pages/dmx-layout/page-factory.js](../pages/dmx-layout/page-factory.js) 当前约 1596 行。建议先做一次小范围抽取，保持 `createDmxLayoutPage` 和所有 WXML handler 名称不变：

1. 先抽 69–368 行的纯几何和排布模型：位置定义、杆位计数、保存位置归一化、杆位与位置互转、最近杆位、舞台几何。输入输出保持 JSON 可序列化，不引用 `this`、`wx` 或页面数据。
2. 再抽 631–888 行的 Canvas 测量与绘制适配，渲染器只接收画布上下文、几何数据和导出选项；图片导出仍留在页面报告控制边界内。
3. 暂缓拆手势、存储和十几个小 controller。手势状态机约 1100–1470 行，存储/生命周期约 433–623 行，先用现有行为测试锁定后再拆。

验收标准：现有自动排布、批量上杆、侧光、清空本杆、横屏返回和生成图片行为不变；新增纯模型回归覆盖不同排数/侧光对数的保存恢复、杆位计数互转、缩放锚点和四角平移边界；Page API 与 `utils/dmx-address` 不变。

### DMX 编址页

[pages/dmx-address/dmx-address.js](../pages/dmx-address/dmx-address.js) 当前约 1320 行。建议按数据流拆分：

1. 抽 130–535 行的组输入归一化、偏好投影和结果视图投影；保留 `calculateDmxAddressPlan` 作为唯一地址算法入口。
2. 将 617–927 行的灯具组编辑、灯具搜索、库内/自定义切换和批量添加作为一个编辑边界，统一输出新的 `groups` 与选择器状态。
3. 将 973–1221 行的域/分组浏览、分页、逐台完成标记和通道指南作为结果浏览边界。
4. 最后再处理 536–612、928–971 的生命周期/计算调度，以及 1223–1318 的记录、复制、收藏和报告适配。

验收标准：地址结果、域容量、通道编址规则和偏好/记录存储语义不变；500 台灯具分页、逐台标记、搜索选择、库内/自定义切换、通道指南和进入位置图的现有回归全部通过。不要一次性拆成多个 controller，以免在没有独立行为边界时改变页面状态时序。

### 报告绘图重复代码

以下三个文件重复实现 `roundedRect`、`setText`、`drawText`：

- `utils/result-report.js:22`
- `pages/records/project-report.js:28`
- `pages/led-screen/report.js:19`

三个基础函数的多余副本加上前两个文件的 `splitText` 多余副本，原始重复文本合计约 2758 bytes（未扣 imports，也不等同于最终编译净收益）。建议先抽基础绘图函数，保留默认颜色、坐标和各报告自己的内容布局，暂不统一整个导出 controller。

验收标准：三类报告图片逐项保持文字、换行、颜色、圆角和坐标一致；在相同输入下导出结果不改变；包体门禁单独记录变化。

## 测试架构与包体说明

`tests/release-check.js` 约 6911 行，应保留唯一入口和失败退出码。已有约 6898 行附近的独立脚本模式可逐步复用，把域行为测试迁移到独立回归脚本，减少对源码字符串的绑定，使行为失败和包体门禁可以分别定位。

当前源码内部预算约 1511.5/1512 KiB，不等于微信编译后的上传包体。后续包体优化应另外测编译产物，不能用调整预算代替测量。

`README.md:62` 关于摄像机双轴计算的描述过时；`docs/camera-fov-calculation.md:50,63` 与 `tests/release-check.js:2607,2658` 已有水平预估说明，彼此一致。本次不改文档或算法。灯光清单不属于本次审查范围。

## 低优先 API 契约附记

以下情况来自非法或当前生产数据不会触发的输入，暂不作为现有页面算法缺陷：

- `utils/limiter.js:20,71` 在传入非法 `wiring='garbage'` 时，8 Ω × 2 加 16 Ω 功率表会回退到有效的 16 Ω 结果；页面 [pages/limiter/limiter.js:49](../pages/limiter/limiter.js:49) 始终枚举合法 wiring，因此当前页面基线未复现错误。建议补 API 入参契约测试，再决定是否显式拒绝未知 wiring。
- `utils/spl.js:93,140` 对非正功率会产生 `-Infinity` 或 `NaN`；现有音箱资料没有非正功率，页面也使用固定产品库。建议在 API 层补非正功率测试和明确错误语义，不默认改变当前计算规则。
- `utils/camera-fov.js:116` 的通用 `calculateCoverage` 传入 `horizontalOnly` 且垂直角为 `null` 时会得到 0 高度/面积；生产页面使用专用水平覆盖函数，当前调用链未触发。建议补 API 契约测试后再决定是否改校验。

本轮另外抽查了 limiter、spl、cable、gain-structure、camera-fov、venue、venue-plan、venue-discussion、venue-discussion-plan、led-screen、dmx-address 等核心/布局模块；在合法生产输入基线上未发现新的公式错误。本附记不是对全部输入空间的穷尽证明。

## 其他低优先事项

- [pages/products/detail.js:87](../pages/products/detail.js:87) 直接调用 `decodeURIComponent`，畸形外部 URL 可能抛 `URIError`；应用内部使用 `encodeURIComponent`，当前正常导航不受影响。可作为 API 防御性修复单独处理。
- [pages/dmx-layout/page-factory.js:1462](../pages/dmx-layout/page-factory.js:1462) 的 `touchcancel` 会进入拖动结束路径；这是否应提交或回滚位置取决于产品对中断手势的定义，当前记为待确认交互选择，不定性为缺陷。

## 建议实施顺序

先建立可恢复基线（当前仓库无 HEAD，本次未自动提交），再处理三处已复现问题；随后做三个报告基础绘图函数去重；最后将行为测试逐步拆分，并配合 DMX 纯模型小步抽取。手势和存储职责拆分后置。
