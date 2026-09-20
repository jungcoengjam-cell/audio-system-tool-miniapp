# 围桌讨论型会议室单链路 PAG/NAG 复核

本页记录 2026-09-15 的单音箱实现历史；多音箱取点扩展与当前验证见 [`docs/venue-pag-multiple-2026-09-19.md`](venue-pag-multiple-2026-09-19.md)。

日期：2026-09-15

## 范围与输入

本轮为页面 Voice Lift 的可选传声增益检查，默认关闭。它固定同一发言人、话筒、实际送声音箱和最远听众，只计算一条传播链路；页面不把远端会议分支纳入本检查。

复核有六项输入：`ds`、`d0`、`dn`、`d1`、`d2` 为距离（m），`nom` 为同时开放话筒数。含义为：`ds` 发言人—话筒，`d0` 发言人—最远听众，`dn` 发言人—最近听众，`d1` 话筒—实际送声音箱，`d2` 该音箱—同一最远听众，`nom` 同时开放的话筒数。输入只接受有限正距离和正安全整数 `nom`；数字字符串可转换为数值，数组、对象等输入拒绝。

`dn > d0` 严格拒绝。`ds`、`d1`、`d2`、`d0` 还要满足四条距离可以闭合的广义三角不等式；这是依据欧氏直线距离作出的输入一致性约束，不是 Shure 的强制标准。实现使用 `1e-9` 的相对数值容差处理边界，它不是实测误差容许值。

## 计算与输出边界

NAG 用于对齐近、远听众听到的发言声，可写为 `20 log10(d0 / dn)`；它不是会议等级的最大声压要求。PAG 按单链路参考计算：

`PAG = 20 log10(d1 × d0 / (d2 × ds)) - 10 log10(nom) - 6`

`marginDb = PAG - NAG`。固定扣除 `6 dB` 反馈稳定余量，结果返回 `basis=omnidirectional-single-path`、`verification=unverified`，不叠加指向性、AEC 或自动混音额外增益。`NOM=1` 只在用户实际填写 1 时成立，不能默认采用，也不能由参会人数推导。

该计算只说明单链路的几何与增益参考，不输出全部路由稳定、不会啸叫或声学合格结论。页面仍只开放 Voice Lift。

## 页面与记录边界

检查默认关闭时，旧方案、JSON 偏好和原计算结果不变。启用后六项数据未填完整仍可查看基本布局，但复制、生成图片、收藏和加入项目拒绝，不能保存为完整结果；数据完整时，记录保存输入，复制文字和结果图保留输入、PAG/NAG 数值及差值边界。详情 UI、记录联动和完整发布回归专项均已核对。

## 数学专项证据

独立数学检查已完成：300 组三维距离、300 组等价数值字符串（含浮点距离）、600 组缩放不变性、107 组拒绝、2 组极端有限数和 4 组 `d0` 抵消检查。该证据只覆盖纯计算，不能替代页面、记录、编译、包体、真机或现场声学验收。记录见 [`verification/venue-pag-nag-2026-09-15/mathematical-check.cjs`](verification/venue-pag-nag-2026-09-15/mathematical-check.cjs) 与 [`verification/venue-pag-nag-2026-09-15/mathematical-check.json`](verification/venue-pag-nag-2026-09-15/mathematical-check.json)。

## 页面与报告专项证据

页面独立检查 23 项全部完成，覆盖 24 组关闭状态精确对照、6 组缺字段恢复和 8 组旧结果比较；报告容量检查覆盖 270 个有效报告和 339 个无效基础房间拒绝，最多 19 个逻辑行且每项实际字体测宽不超过 2 行。68 个 `320/430` 宽度与明暗状态均无页面溢出或未解析绑定，生成 5 张真实 Canvas 报告图；原生编译为 21 个 WXML、22 个 WXSS，均退出码 0 且无 stderr。完整发布自检由根审执行退出码 0；两个新增专项、既有八模块、产品数据和数值渲染基准均通过。证据见 [`verification/venue-pag-nag-2026-09-15/independent-page-check.json`](verification/venue-pag-nag-2026-09-15/independent-page-check.json)、[`verification/venue-pag-nag-2026-09-15/report-capacity-check.json`](verification/venue-pag-nag-2026-09-15/report-capacity-check.json)、[`verification/venue-pag-nag-2026-09-15/metrics.json`](verification/venue-pag-nag-2026-09-15/metrics.json)、[`verification/venue-pag-nag-2026-09-15/native-compile.json`](verification/venue-pag-nag-2026-09-15/native-compile.json) 和 [`verification/venue-pag-nag-2026-09-15/release-check.log`](verification/venue-pag-nag-2026-09-15/release-check.log)。后续用户反馈：少量真机试用未发现异常；完整真机用例及现场声学对照仍待完成。

包体复核的当前有效范围为 163 个文件、1,690,633 bytes；主包 JS 768,946 bytes，WXML 197,008 bytes。相对重建基线 1,671,838 bytes，增量为总包 18,795、主包 JS 14,367、WXML 3,601、WXSS 827 bytes，媒体增量为 0。按实际值向上取整后，三项必要内部预算为总包 1652 KiB、主包 JS 751 KiB、WXML 193 KiB；其余预算未变，这些是项目内部预警预算，不是平台上限。范围与计算口径见 [`verification/venue-pag-nag-2026-09-15/package-review.json`](verification/venue-pag-nag-2026-09-15/package-review.json)。版本号保持 5.0.0，本轮改动尚未发布。

输入后立即复制、保存或生成图片，会先完成待计算，避免输出旧结果。已检查停用输入比较，结果图片保留完整 Mix-Minus 原则和 NAG 目标，六项输入分三行显示以避免长小数截断；布局估算警示与单链路复核说明各自适用范围。关闭状态的新旧记录偏好和原布局结果保持一致。核心布局、`utils/venue.js`、`utils/venue-discussion.js`、产品库和 `VERSION` 未变。

本轮实现涉及 `pages/venue/venue.js`、`pages/venue/venue.wxml`、`pages/venue/venue.wxss`、`pages/venue/pag-nag.js`、`utils/venue-pag-nag.js`、`utils/record-comparison.js`，以及 `tests/venue-pag-nag-regression.js`、`tests/venue-pag-nag-page-regression.js` 和 `tests/release-check.js` 入口。

## 原厂依据与后续核对

Shure 在线 PAG/NAG 计算器与《Microphone Techniques for Live Sound Reinforcement》PDF 正文第 19/20 页用于公式和边界的研究依据： [PAG/NAG Calculator](https://www.shure.com/en-US/support/tools/pag-nag-calculator)；[Shure PDF（正文第 19/20 页）](https://www.shure.com/damfiles/default/global/documents/publications/en/performance-production/microphone_techniques_for_live_sound_reinforcement_english.pdf-3df433145fca686a736beeb5da588efa.pdf)。资料中的全向基础、`-6 dB` 余量和自动混音 `NOM=1` 是工具或示例假设，不能直接当作所有现场的合格条件。

下一步应对一条实际送声链路做实测并与现场对照，核对位置、NOM 和反馈稳定度；单链路结果不能代表所有分区稳定，也不自动形成声学合格标签。
