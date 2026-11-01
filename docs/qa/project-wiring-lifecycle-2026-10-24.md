# 项目布线报告与生命周期整理（2026-10-24）

本轮以开始时的工作区快照为基准，保留此前未提交改动。生产改动仅限项目布线页面的职责拆分；计算、存储、产品数据、WXML/WXSS、报告绘图与图片导出格式保持不变。

## 实现

- 新增 `pages/project-wiring/report-controller.js`，集中现有报告生成、缓存、预览、保存队列、工作区关闭动画与延迟清理方法；继续延迟加载 `report.js`。
- 新增 `pages/project-wiring/page-lifecycle.js`，集中四个生命周期入口，并按原顺序调用初始化、恢复、隐藏和销毁阶段。保留显式路由、偏好恢复、迟到回调、主题取消监听，以及原函数引用与动态 `this` 调用的区别。
- `index.js` 显式组合页面、工作区、报告和生命周期；`workspace-ui.js` 删除已迁移的方法。原四个生命周期与三个报告方法的重复覆盖由 32 处降至 25 处，其余覆盖不在本轮范围。
- 默认 data 与全部 220 个对外方法名保持一致。独立复审确认 216 个非生命周期方法函数体仅存在缩进变化；生命周期阶段、顺序及偏好读取也保持等价。

## 回归与测试夹具

- 新增 `tests/project-wiring-report-lifecycle-regression.cjs` 并登记完整发布检查。三组组合场景在原版和整理后均通过：保存中隐藏/返回并缓存重开、销毁后的相册及主题回调、旧页画布回调迟到、新预览遇到旧关闭动画回调。
- `project-wiring-native-interactions-test.cjs` 的 16 处已选项目场景补齐显式夹具路由；断言不变。调整后的测试在原版和整理后均通过。
- `project-wiring-module-refinements-test.cjs` 原版已有 13 项失败：旧默认项目选择假设，以及 schema 3 夹具在当前 schema 4 触发迁移。只更新本套件的默认当前存储夹具、11 处已选项目路由，并将缺失/读取失败偏好时的选择断言对齐既有正式页面测试；保留 schema 1 场景、全部无项目写入断言和删除/异步断言。调整后原版与整理后均为 21/21 通过。
- 没有修改共享测试 runtime。原版对照通过临时加载钩子读取本轮保存的 `index.js`、`workspace-ui.js`，无需回滚工作区。
- module-refinements 的历史输出目录由临时 runner 覆盖为本轮 `tmp` 下路径，未覆盖旧证据；最初失败结果另存为 `original-controller-checks.json`。

## 验证结果

| 验证 | 结果 |
| --- | --- |
| 新增组合回归，before / after | 各 3/3，exit 0 |
| 调整后的 native 交互回归，before / after | 均 exit 0 |
| 调整后的 module-refinements，before / after | 各 21/21，exit 0 |
| 17 项额外定向检查 | 全部 exit 0，含 D1 的 91 条断言及 swipe 回归 |
| 完整 `node tests/release-check.js` | exit 0，72 个登记独立脚本及入口检查通过 |
| 主代理独立源码复审 | 方法/data、生命周期顺序、7 处覆盖消除、延迟加载检查通过 |
| 官方 WXML/WXSS 编译 | 主代理执行 exit 0，7 个编译输入文件哈希无漂移 |
| 微信真机 | 未执行；未将模拟回归表述为真机验证 |

完整发布检查之后仅调整了未进入发布链的 module-refinements 测试夹具，并完成该套件 before/after 验证；生产代码没有继续改动，因此未重复完整发布检查。

本轮证据位于 `tmp/project-wiring-lifecycle-2026-10-24/`：`before-manifest.json`、`changes.json`、`validation-summary.json`、`independent-review.json`、`release-check.log`、各 before/after 日志及 `targeted/`。工作区原始快照共 11,361 个文件。
