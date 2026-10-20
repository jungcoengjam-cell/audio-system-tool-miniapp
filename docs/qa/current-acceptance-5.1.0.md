# TuneBuddy 5.1.0 当前 QA 验收入口

日期：2026-10-05。验收对象：当前工作区源码，HEAD `de758b643ff1bd4beabd6f6dbb1ee88a4d026e0e`。用户已告知正式版上传；这里尚无正式包与当前源码的一致性证据。

## 完成范围与入口

维护当前可重复执行的 QA 基准，保留旧失败、旧冻结清单和原始全面体检；完成本机可用的原生渲染取证及源码体积评估。没有修改生产代码、算法、产品数据、UI 或体积门限，没有提交或发布。

当前功能验收只需运行：

```powershell
node tests/current-qa/5.1.0-2026-10-05/run.cjs
```

该入口运行 13 个功能套件和隔离的适配器检查，输出单一 JSON；失败返回非零。普通套件必须返回非空检查集合，进程型 Shared operation gate 由子进程退出码判定，返回检查数明确记为 0。`returnedChecks` 是套件返回项目数，不能当作断言数或独立失效机制数。

11 个既有套件只读复用；两个 Camera 套件在新目录保留副本，修正两阶段项目确认、真实项目 chooser、存储故障和旧结果提示的测试 oracle。页面真实方法和旧尾部断言继续执行。生命周期适配器只在 QA 中补全测试环境，隐藏页仍在加载栈内；隐藏、非顶页、卸载后的实际保存回调分别验证零副作用。

实现、原始执行及旧文件 SHA 映射见 [当前 QA 说明](../../tests/current-qa/5.1.0-2026-10-05/README.md)、[provenance](../../tests/current-qa/5.1.0-2026-10-05/provenance.json)。

## 三个独立验收层

| 层 | 状态与依据 |
| --- | --- |
| 本地源码/离线 QA | 当前 runner、P0/P1、数值回归、release-check；详见 [当前报告](../../tests/current-qa/5.1.0-2026-10-05/REPORT.md) |
| 微信模拟器 | 本机官方工具在隔离副本渲染首页、Camera、LED、Venue；自动化接口超时，交互验收未完成 |
| 已发布包/真机 | 未取得包身份映射或物理设备控制；待验证，不能由前两层替代 |

真机流程和证据表已准备在 [原生环境验收记录](../../tests/current-qa/5.1.0-2026-10-05/native/README.md)。没有把模拟器或 mock 写成真机通过。

## 体积与历史完整性

[体积评估](../../tests/current-qa/5.1.0-2026-10-05/budget/source-budget-report.md)：当前有效原始源码 198 文件、2,324,120 B；内部源码总量预警余量 360 B，主包 JS 628 B，媒体 8 B。这些是项目内部源码预警值，不是微信编译/上传包限额。没有证明任何可以安全删除的资源；安全节省为 0 B，已忽略的文档/测试资源不能算作当前可回收空间。

历史 4,945 文件冻结清单中的 `minimal/led-operation.cjs` 漂移在本轮之前已经存在、且已提交在当前 HEAD。保留旧 manifest 和 FAIL，另用本轮前后全仓哈希核对判断本轮是否新增变动。Phase 1、Gain Structure、Limiter、generation experiment、Run 1/Run 2/Protocol/GT 与原全面体检均保持封存。

Jev 的长期角色仍是 **STRUCTURED QA REVIEWER / RISK FILTER / CHALLENGE LAYER**。本轮维护不需要再询问 Jev 确定性事实；引用此前封存的真实 Jev 信号，新增测试维护由 Codex/Luna 执行、Sol 独立复审，不制造 Jev 生成用例或新失效产出率。
