# 计算依据详情排版记录（2026-10-28）

## 范围

六篇计算依据采用同一技术文章布局：图标和标题紧凑横排，示意图居中，正文左对齐，参数按标签和值对齐，来源与适用边界分区。原公式以纯文本式独立横向滚动行显示，不使用底框、彩色竖线或圆角，字号不低于 15px，并提示长公式可左右滑动。

展示辅助片段存放在 `presentation.article`。`quick` 和 `completeExplanation` 原文对象及其公式、说明、单位、来源和边界保持原值；显示片段按原顺序逐字符重组一致。未改算法、数据、校验、记录存储或工具导航逻辑。原有完整说明 `disclosure-motion` wrapper 与展开/收起行为继续保留。

## 本次文件

- `pages/basis/detail.wxml`
- `pages/basis/detail.wxss`
- `pages/basis/presentation.js`
- `tests/basis-detail-editorial-layout-2026-10-28.cjs`
- 六张页面图示：`pages/basis/assets/{cable,gainStructure,limiter,spl,camera,ledScreen}.png`
- 可编辑图示源与 PNG 生成器：`tests/basis-editorial-2026-10-28/diagrams/*.svg`、`tests/basis-editorial-2026-10-28/generate-png.cjs`
- 浏览器内容基线、守恒及截图验证：`tests/basis-editorial-2026-10-28/qa/`
- 导航/展开行为断言：`tests/homepage-refactor-2026-10-18/navigation-basis-behavior.cjs`、`tests/disclosure-motion-regression.cjs`

## 局部复现

```powershell
node --check pages/basis/presentation.js
node tests/basis-detail-editorial-layout-2026-10-28.cjs
node tests/basis-editorial-2026-10-28/qa/content-preservation.cjs
node tests/basis-editorial-2026-10-28/qa/run-browser-qa.cjs
node tests/homepage-refactor-2026-10-18/navigation-basis-behavior.cjs
node tests/disclosure-motion-regression.cjs
node tests/release-check.js
git diff --check -- pages/basis/detail.wxml pages/basis/detail.wxss pages/basis/presentation.js tests/basis-detail-editorial-layout-2026-10-28.cjs
```

## 验收状态

- 局部内容守恒、公式分段、展开关系与文件差异检查：已通过。
- `node tests/release-check.js`：通过，exit 0；664 项原有值守恒通过。
- 小程序官方 `wcc`/`wcsc` 编译：最终无框样式通过，exit 0 且 stderr 为空；74 个编译源文件 SHA 与当前文件一致，覆盖 28 个注册页面、40 个 WXML 与 34 个 WXSS。
- 浏览器布局/交互全矩阵：36 个场景各跑折叠/展开（72 组合）通过，另有 8 个字体放大场景与 6 条路由通过。用户要求移除公式底框和竖线后，最终样式另经 320px 浅/深色、1.25×字体、横向滚动公式末端专项复验及截图复审；末字可见，页面本身无横向溢出。
- 最终无框样式截图：`tmp/basis-editorial-2026-10-28/qa-evidence/review-2026-10-28T05-41-20-581Z/`（含 limiter 方法区、公式横滚末尾、1.25×字体及深色 cable 样例）。此前有框版本截图不作为最终样式证据。
- `navigation-basis-behavior`、`disclosure-motion-regression`、局部内容守恒及 `git diff --check`：通过。
- 版本号与发布状态见[版本记录](../CHANGELOG.md)。

## 顶栏紧凑调整

详情顶栏已改为横排：32px 图标与标题/分类两行文字相邻，标题 20px/700、分类 12px；简介原文仍为 15px，距顶栏约 8px。长标题按可用宽度自然换行，不省略。

before/after 浏览器验证覆盖 36 个常规场景及 2 个 1.25×放大场景；标题无裁切、两行信息不重叠，320/390/430px 及浅/深色下页面无横向溢出。顶栏高度在 320px 视口缩短 72.2px，在 390/430px 缩短 74.7px。最终截图与尺寸摘要见 `tmp/basis-compact-header-20261028/after/`，包括 `limiter-320-light.png`、`camera-390-dark.png`、`limiter-320-light-125pct.png` 和 `camera-320-dark-125pct.png`。

用户于 2026-10-28 通过最新手机预览二维码 `phone-preview-20261028-142631` 验收本次紧凑顶栏；该结论只对应计算依据详情标题/图标空间压缩。
