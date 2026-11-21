# 现库型号对照导入（2026-11-03）

## 来源和覆盖

来源文件：`（无密1）2026年--产品参数表汇总@V20260928~V20261010版.xlsx`，版本 `V20260928~V20261010`。

- `方案参数` 精确匹配现库 323 个型号；`停产` 表补充 35 个型号，共 358 个精确/停产现库型号。
- `舞台灯光规格表` 收录 34 条真实旧型号，按现库型号关联。第 97、99 行的“旧型号”栏填写的是“600W追光灯”这一名称，未作为型号或搜索别名。
- 另记录 3 个仅有历史关系的现库型号：`KT-B10A → KT-B10`、`TS-606A → TS-606H`、`TS-6152 → TS-8152`。对应来源为方案参数备注及“音箱信息、支架表”备注；这些关系不复制目标型号的品牌对照或参数。
- 内部识别型号与产品型号分别保留，产品型号按各表表头标为“型号”“产品型号”或“产品型号（开票型号）”。SENLANG 有 4 处两字段不同，按原值分别保存和搜索。

## 搜索和数据边界

资料库搜索同时检查现库型号、内部识别型号、产品/开票型号和历史关系目标。命中后仍显示现库产品，列出命中的对照型号；多条命中会保留多项结果。分类与能力筛选继续生效，搜索不会自动选择产品。

对照仅表示来源表中的型号关系，不表示参数相同或当前可供货。该导入未修改核心计算参数、计算基准或产品计算数据。

## 本次修改文件

- 对照数据与匹配逻辑：`pages/products/data/model-cross-reference.js`、`pages/products/utils/model-cross-reference.js`、`pages/products/utils/products.js`。
- 资料库搜索结果和详情展示：`pages/products/library.js`、`pages/products/library.wxml`、`pages/products/library.wxss`、`pages/products/detail.js`、`pages/products/detail.wxml`、`pages/products/detail.wxss`。
- 回归测试和说明：`tests/product-model-cross-reference-test.js`、`tests/release-check.js`、本说明、`docs/product-data.md`。

## 验证

- 独立源表核对比较了 323 条方案参数与 35 条停产记录中的 14,425 个非空来源单元格，差异为 0。另一轮逐字段复核确认 10,024 个导入字段、34 个灯光旧型号原文及 4,741 条型号关联搜索映射一致；原 361 个型号的参数/能力快照未变。
- `node tests/product-model-cross-reference-test.js` 通过：4,738 个去重型号查询词均能通过 `filterProducts` 找回所属现库型号，并覆盖一对多结果、分类/能力筛选、历史关系、详情来源和实际页面搜索/导航。
- `node tests/release-check.js` 全量通过（exit code 0）。
- 微信开发者工具本地 `wcc`/`wcsc` 编译资料库和详情页通过（exit code 0）。浏览器复核覆盖 320、390、430px 与浅、深主题，无溢出；未做真机检查。
