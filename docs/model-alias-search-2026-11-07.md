# 设备选择器对照型号搜索

2026-11-07

## 功能与数据

限幅器功放/音箱、增益架构功放、声压级音箱、摄像机和 DMX 编址灯具选择器现在可用资料库中的其他型号搜索；DMX 灯位图的放置筛选和查找也支持已选灯具的对照型号。搜索结果仍选择原资料库型号并沿用原参数与能力筛选。提示只标明命中的对照型号，不表示参数来源发生变化。

离线索引位于 `data/model-alias-search-index.js`，对应现有对照记录的型号值和历史目标型号，不依赖网络或分包加载；非空查询时才加载。对照表中完全相同的 `[型号, 型号]` 值对以 `[型号]` 存储，并在导出前展开回原结构。压缩前后导出数据深度一致，来源、列、品牌、历史关系和空值语义保留不变。

维护索引可运行 `node tests/generate-model-alias-search-index.cjs` 重建，或加 `--check` 校验是否与对照表同步。生成器拒绝原型号或对照型号包含 `|`、CR、LF，避免分隔格式产生歧义。

## 验证与限制

- 型号索引、页面交互和产品对照回归通过；包含大小写、局部匹配、筛选、历史关系、一对多灯具型号及索引分隔符负例。
- WXML/WXSS 本地编译通过，覆盖 21 个 WXML 和 15 个 WXSS；冻结哈希与源码包体门禁通过。
- 源码预算读数为主包 JS 1554.0 / 1558 KiB（约余 4 KiB），总体 5099.2 / 5120 KiB。该读数是源码门禁统计，不是微信开发者工具实际编译包体大小。
- 完整 `node tests/release-check.js` 已通过（exit code 0），原数值基准正常。原检查时尚未进行微信真机验证；用户随后确认本次型号对照搜索真机测试正常。

## 本次功能涉及文件

- 索引与选择逻辑：`data/model-alias-search-index.js`、`utils/model-alias-search.js`、`utils/catalog-selector.js`、`pages/products/data/model-cross-reference.js`
- 选择器与灯位筛选：`styles/device-picker-shared.wxss`、`pages/limiter/limiter-overlays.wxml`、`pages/gain-structure/gain-overlays.wxml`、`pages/spl/spl.wxml`、`pages/camera/camera.js`、`pages/camera/camera.wxml`、`pages/camera/camera.wxss`、`pages/dmx-address/fixture-catalog.js`、`pages/dmx-address/dmx-address.wxml`、`pages/dmx-address/dmx-address.wxss`、`pages/dmx-layout/page-factory.js`、`pages/dmx-layout/layout-interactions.js`
- 回归与发布检查：`tests/model-alias-search-test.js`、`tests/model-alias-page-flow-test.cjs`、`tests/generate-model-alias-search-index.cjs`、`tests/dmx-compile-entry-regression.cjs`、`tests/dmx-search-lifecycle-regression.js`、`tests/release-check.js`、`tests/package-reclaim/ui-resources.cjs`
