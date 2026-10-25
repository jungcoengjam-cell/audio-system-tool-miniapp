# 架构后续重构验收记录

已按[架构报告](../architecture-refactor-2026-10-25.md)的优先级完成八个步骤。每一步都在定向验证、当前对话模型独立复审和完整自检通过后，才进入下一步。界面资源、功能、核心算法、产品资料、校验条件及记录存储语义保持不变。

执行由 GPT-6 Luna reasoning `max` 完成；规划、验收标准和独立复审由当前对话中用户选择的模型负责。全部修改基于本轮起始工作区，保留此前已有的未提交改动，不以 Git HEAD 代替重构前版本。

## 最终验收状态

**最终验收通过（2026-10-25）。** 八步重构及逐步验证、独立复审已完成；用户在本次对话中确认“真机测试没问题”，并要求将真机测试通过的结果补入验收报告，作为本次重构的最终验收依据。

真机测试结果来源为用户实测确认。未提供设备型号、系统及微信版本、逐项用例或性能采样，因此不据此补写具体测试覆盖或真机性能结论。现有 UI、功能、核心算法、产品数据、校验条件及记录存储语义保持不变。

## 完成范围

| 顺序 | 重构内容 | 验证结果 |
| --- | --- | --- |
| 1 | 存储底层 I/O、缓存和嵌套写入状态分离到独立实例 | 原 API、完整读写删除轨迹、返回值与最终存储一致；覆盖缓存刷新、动态平台对象、实例隔离、写入与回滚失败；完整自检通过 |
| 2 | 迁移、备份和原始快照恢复编排分离 | 原九类冻结行为不变，补充原始快照写入及回滚失败、迁移状态清理失败轨迹；完整自检通过 |
| 3 | 七个页面显式向编辑导航工厂注入离开动作 | 移除上下文到动作模块的反向依赖；加载顺序、延迟回调、保存取消与恢复验证通过；完整自检通过 |
| 4 | DMX 页分离弹层关闭生命周期和卡片手势 | 149 个公开方法及 86 项初始数据保留；手势、关闭重开、隐藏卸载后的迟回调轨迹一致；完整自检通过 |
| 5 | 项目布线页分离弹层、触摸交互和删除流程 | 220 个公开方法及 123 项初始数据保留；删除取消、失败重试、重复确认及异步返回验证通过；完整自检通过 |
| 6 | 项目列表按刷新建立灯光上下文索引 | 保留重复 ID 首条匹配规则，输出、调用轨迹和视图载荷一致；完整自检通过 |
| 7 | 四份 DMX 编译入口共用实现 | 默认及覆盖输出目录、命令参数、摘要和失败退出行为与旧版一致；四入口的官方编译实跑均通过；完整自检通过 |
| 8 | 发布自检按包体、计算数据、页面合同和运行时拆分 | 原函数、阈值、断言、前置夹具与执行顺序保留；最终独立完整自检退出码 0，stderr 为空 |

`records.js` 继续拥有记录、项目、收藏等业务入口和快照转换。底层 I/O 与迁移编排分别委托两个工厂；缓存、失败标志及迁移错误状态仍属于各自的 records 实例。快照构造留在原模块，保留原有对象来源和严格普通对象检查，避免跨 VM 加载时改变迁移行为。

页面状态仍由原 Page 持有。新控制器没有跨页面共享的可变状态；平台对象、时钟和定时器按调用时读取，并保留平台方法的 receiver。项目布线弹层仍使用私有 core 引用调用原键盘处理方法。

## 修改文件

生产代码共修改十二个原文件，新增七个内部模块。

| 位置 | 文件与职责 |
| --- | --- |
| 存储 | `utils/records.js`；新增 `utils/record-storage.js`、`utils/record-migration.js` |
| 编辑导航 | `utils/result-record-context.js`；七页接线：`pages/limiter/limiter.js`、`pages/spl/spl.js`、`pages/cable/cable.js`、`pages/camera/camera.js`、`pages/gain-structure/gain-structure.js`、`pages/led-screen/led-screen.js`、`pages/audio-wiring/index.js` |
| DMX | `pages/dmx-address/dmx-address.js`；新增同目录 `sheet-lifecycle.js`、`card-interactions.js` |
| 项目布线 | `pages/project-wiring/workspace-ui.js`；新增同目录 `workspace-overlays.js`、`workspace-interactions.js`、`workspace-deletion.js` |
| 项目列表 | `pages/projects/projects.js`，仅刷新过程中的灯光查找改为本地索引 |

测试和工具改动：

- `tests/release-check.js` 保留原命令入口，新增 `tests/release-check/package-checks.cjs`、`calculation-checks.cjs`、`page-controller-checks.cjs`、`runtime-checks.cjs` 四个专题模块。
- 新增共享编译实现 `tests/helpers/dmx-compile.cjs`；保留 `dmx-ui-refactor-2026-10-18`、`dmx-ui-refinements-2026-10-18`、`dmx-ui-native-fixes-2026-10-18`、`dmx-ui-round3-2026-10-18` 四个目录下的原 `compile.cjs` 入口及输出约定。
- 新增六组回归：`record-storage-refactor-regression.cjs`、`editor-navigation-dependency-regression.cjs`、`dmx-address-controller-boundary-regression.cjs`、`project-wiring-workspace-controller-regression.cjs`、`project-list-lighting-index-regression.cjs`、`dmx-compile-entry-regression.cjs`，均位于 `tests/`。
- 原有 82 项独立回归入口及顺序全部保留；加上六组新回归和原有项目上下文生命周期套件的登记后，共 89 项。

没有修改 WXML、WXSS、图片、路由、主题配置、产品数据文件、计算工具源码或数值基准。没有新增运行时依赖，也没有修改发布预算。

## 结构与性能结果

以下为起始工作区到最终源码的主文件行数，按换行分割计数；多数减少来自职责迁移。

| 文件 | 重构前 | 重构后 |
| --- | ---: | ---: |
| `utils/records.js` | 1389 | 1181 |
| `pages/dmx-address/dmx-address.js` | 2820 | 2428 |
| `pages/project-wiring/workspace-ui.js` | 1728 | 808 |
| `tests/release-check.js` | 5358 | 502 |

静态分析覆盖 28 个注册页面和 135 个生产 JS：全部可从入口到达，未发现循环依赖或动态 require。该分析包括方法内的延迟加载，不代表启动时加载全部模块，也不证明每个导出或方法均被使用。

项目列表将 P 个项目逐个扫描 L 条上下文的查找，改为每次刷新建立一次索引，复杂度由 O(P×L) 改为 O(P+L)。索引只属于本次刷新，不缓存到页面或全局。在 260 个项目、800 条无匹配上下文的固定样本中，上下文 ID getter 访问从 208,000 次降至 1,600 次，整个显示数据、patch、返回值与 API 调用保持一致。

另以真实 Page 代码和 fixture-backed APIs 做 Node/VM 模拟：180 个项目、600 条上下文，首轮刷新 9 个样本、重复刷新 27 个样本。中位数分别为 6.0302→1.7813 ms、3.9071→1.3147 ms，`setData` 载荷均为 32,211 bytes。这些耗时不作为门禁，不代表手机冷启动、真实存储冷读或真机帧率。

新增工厂接线和格式整理会增加少量总源码。最终源码包门禁为总计 4832.6 KiB / 5120 KiB，主包 JS 1491.5 KiB / 1536 KiB；原预算保持不变。这是源码统计，不能作为微信最终编译包或运行内存的实测值。

## 独立验证

- 以起始清单检查所有非目标生产文件；算法、产品数据、配置及界面资源没有发生本轮变更。生产代码完成后封存的 304 个文件，在两个测试工具阶段及最终复核中哈希全部一致。
- 对十个受影响页面检查初始 data 和 910 个公开方法。除计划中的编辑依赖引用与项目列表索引改动外，方法 AST 一致；DMX 和项目布线原方法、常量及辅助函数均保留。
- 存储公开 API 未变；原 71 个函数中 62 个 AST 相同，其余为预期的 I/O 适配和迁移编排迁移。完整 before/current I/O 轨迹及故障结果对照通过。
- 对发布自检原始版本与最终模块逐项比较：31 个原函数、23 项非回归清单声明的 AST 一致；原 82 项回归的顺序保留，仅增加七项登记。相对于拆分前快照，全部 24 项原声明、前置夹具和完整执行 footer 均一致。比较包含多行模板的 raw/cooked 值。
- 四个测试工厂构造时不运行检查；返回函数名与其接线字段一致。页面和运行时专题使用原入口的 require，保留相对路径、cache 和 resolve 的含义。
- 六组新增回归在禁止访问工作区 `tmp` 的子进程中，默认运行全部退出码 0；常规自检不依赖本机重构前快照。额外 `--compare-before` 才使用本地快照。
- 35 个修改或新增的生产、测试及工具 JS/CJS 文件通过 `node --check`；新增专题模块的字面量外尾随空白已检查，全仓 `git diff --check` 通过。
- 官方编译覆盖全部 28 个注册页面及其依赖，共 40 个 WXML、33 个 WXSS，wcc/wcsc 均退出码 0；最终 73 项编译输入哈希未变。四个 DMX 编译入口也分别实跑成功，其 WXML 输出哈希相同。
- 最终由主代理重新执行 `node tests/release-check.js`，退出码 0，stderr 为 0 bytes；数值、资料、存储、报告、生命周期、触感、包体与本轮新增回归均通过。

## Git 提交验证补充

按用户授权，将必要的前置改动与本次重构分开提交。前置提交为 `4c43dcd`；只纳入本次起始版本和完整自检所需的模块、资源与测试依赖，非必需的历史删改、文档和产物仍留在工作区。前置版本及叠加本次 42 个文件后的提交候选，均在从原 Git 版本构建的隔离目录中执行完整发布自检通过，退出码 0、stderr 为空；暂存内容逐文件与验证版本核对。

隔离验证修正了一处本次新增测试的可迁移性问题：`tests/dmx-compile-entry-regression.cjs` 的冻结摘要现在规范化仓库根路径，并将编译输入的原始字节哈希映射为 LF 规范化内容哈希。逐项原始字节校验、编译命令与输出断言、`--compare-before` 的完整原始轨迹比较保持不变。原目录和隔离目录的规范化轨迹一致；独立负例确认编译参数、输入哈希或输出路径改变仍会被拒绝。生产代码不受此修正影响。

上述结构与性能章节保留此前完整工作区的验收数据。因本次 Git 提交排除了非必需的历史删改，隔离提交候选的源码统计为总计 4883.3 KiB / 5120 KiB、主包 JS 1512.7 KiB / 1536 KiB，均通过原门禁；这些同样不是微信最终编译包实测值。最终验收通过状态保持不变。

## 本地证据

完整证据根目录为 `tmp/architecture-continuation-2026-10-25/`。各步日志分别保存在 `phase1-storage` 到 `phase8-release` 的对应目录；最终独立自检与最后一次空白清理前的独立输出分开保留。

主要文件：

- `start-manifest.json`、`sealed-production-manifest.json`：起始清单及生产代码封存哈希。
- `final-release-summary.json`、`final-release.stdout.log`、`final-release.stderr.log`：最终独立完整自检。
- `release-structure-review.json`、`original-release-integrity.json`：检查函数、声明、夹具及执行顺序的独立对照。
- `final-method-review.json`、`final-function-review.json`、`final-syntax-review.json`：页面、存储函数及语法检查。
- `production-architecture-final.json`：生产依赖图与主文件统计。
- `default-regressions-without-tmp.json`：新增默认回归不依赖本机快照的实际运行结果。
- `official-compile/summary.json`、`phase7-compile/actual/`：官方模板样式编译及四入口实跑。
- `phase6-projects/benchmark-before.json`、`benchmark-after.json`：模拟刷新样本与完整采样数据。
- `commit-review/prerequisite-release-summary.json`、`prerequisite-release.stdout.log`、`prerequisite-release.stderr.log`：前置提交的隔离完整自检；后两项也位于 `commit-review/`。
- `commit-review/main-release-summary.json`、`main-release.stdout.log`、`main-release.stderr.log`：本次提交候选的隔离完整自检；后两项也位于 `commit-review/`。
- `commit-review/compile-portability-review.json`：编译回归路径与换行规范化的独立复审及三类负例。

## 验证边界

自动化验证阶段没有进行微信开发者工具完整 JS 包构建、真机操作或真机性能采样。此后用户已确认本次真机测试通过，最终验收状态更新为通过。真机结果以本次对话中的用户确认作为依据；完整 JS 包构建未单独记录，真机性能未提供采样数据。官方 WXML/WXSS 编译、Node 状态回归和模拟基准不能替代这些尚未记录的检查。
