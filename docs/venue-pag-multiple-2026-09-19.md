# 会议室 PAG/NAG 多音箱取点模式

日期：2026-09-19。此功能扩展页面原有的单音箱 PAG/NAG 几何估算。

## 模式与测量

传声增益检查仍默认关闭。启用后可选“同一只音箱”或“多音箱取点”。旧偏好没有 `discussionPagNagSpeakerMode` 时按 `single` 恢复；无效的显式存储值会阻止复核，避免静默改成单音箱。切换模式会立即重算、清空 D1 和 D2 并引导重测；Ds、D0、Dn、NOM 保留。与既有行为一致，未填完整的新草稿不覆盖最近一次有效偏好，完整结果才持久化模式。完整收藏/项目记录保留模式；复制文字和结果图也会标明多音箱取点。比较记录只在至少一条已启用的讨论记录采用多音箱模式时增加“音箱取点方式”一行，缺失旧键显示“同一只音箱”。

多音箱模式中，D1 是话筒拾音头到离它最近、且实际播放该话筒信号的音箱 A；D2 是同一最远听众耳位到离该听众最近、且实际播放该话筒信号的音箱 B。A 与 B 可以是同一只。完全不播放此话筒信号的输出不属于候选集合，包括被 Mix-Minus 排除的音箱。距离均为空间直线距离，计入高度差。

两模式公式不变：`NAG = 20 log10(D0 / Dn)`；`PAG = 20 log10(D1 × D0 / (D2 × Ds)) − 10 log10(NOM) − 6`；`margin = PAG − NAG`。NOM 仍由用户填写为同时开放并送声的话筒数；固定的 6 dB 稳定余量、全向近似与 `verification=unverified` 均保持原样。没有新增指向性、AEC、自动混音或设备专属加成。原单音箱距离闭合校验及其结果保持不变。

多音箱新增的一致性检查是 `|D1 − D2| ≤ Ds + D0`。这是由“最近活动音箱集合”定义推导的必要条件，并非 Shure 规则：到同一组音箱的最近距离是 1-Lipschitz 函数，话筒与最远听众的间距不大于经嘴部路径 `Ds + D0`，所以两端最近距离之差不能超过该上界。实现先以 `max(Ds,D0,D1,D2)` 归一化再比较，`1e-9` 是相对浮点边界容差，只用于数值稳定，不代表测量误差或制造商容差。通过该检查只说明这些距离没有违反必要几何条件。

该模式仍是最近活动音箱的几何估算，不验证完整多分区路由、声级、指向性、房间反射或现场增益稳定性。最终路由、覆盖和声学结果需要工程复核及现场测量；没有采用 MXA910 等特定设备的多区域增益规则或额外收益。

方法参考：Shure《Understanding Sound System Design and Feedback Using (Ugh!) Math》中 “THE WORST CASE” 的最近音箱取点方法，以及 Shure MXA910 Voice Lift 指引中的 Mix-Minus 路由说明：[Shure 声学系统设计与反馈资料](https://www.shure.com/damfiles/default/global/documents/publications/en/performance-production/us_pro_sound_system_design_ea.pdf-b62c5a07422e6b7e79a9291999cb6e8a.pdf)，[Shure MXA910 Voice Lift 技术资料](https://content-files.shure.com/Pubs/MXA910/MXA910%20Voice%20Lift_Technical.pdf)。此处只借用通用取点和路由概念，不套用设备专属增益。

## 修改范围与验证

本次运行时修改限于 `utils/venue-pag-nag.js`、`pages/venue/pag-nag.js`、`pages/venue/venue.js`、`pages/venue/venue.wxml`、`pages/venue/venue.wxss`、`utils/record-comparison.js`；新增 `tests/venue-pag-nag-multiple-regression.js` 并登记在 `tests/release-check.js`。未修改核心公式、产品数据、布局算法、存储通用层或版本号。

完整 `node tests/release-check.js` 通过。独立复核通过 1,104 组单音箱纯函数精确比较、57 组旧页面/输出/偏好/记录精确比较、1,000 组三维多音箱几何场景和 37 个保护文件审计；96 个常规页面视觉状态及最终 D2 文案的 8 个复核状态通过。21 个 WXML 与 22 个 WXSS 原生编译通过。报告容量覆盖 540 个有效场景和 678 个无效房间场景，最多 20 行且每行最多 2 个物理行；3 张实际报告图保留全部输入数值。

最终有效包为 1,718,354 bytes（相对测量引导版本增加 7,906 bytes）；主包 JS 779,646 bytes，WXSS 227,392 bytes，WXML 206,097 bytes，媒体 254,616 bytes（无变化）。版本仍为 5.0.0，未上传或发布。验证使用桌面视觉测量；未进行微信真机或现场声学测试。

证据：[`independent-audit.json`](verification/venue-pag-multiple-2026-09-19/independent-audit.json)、[`visual-metrics.json`](verification/venue-pag-multiple-2026-09-19/visual-metrics.json)、[`visual-final-d2.json`](verification/venue-pag-multiple-2026-09-19/visual-final-d2.json)、[`report-capacity-check.json`](verification/venue-pag-multiple-2026-09-19/report-capacity-check.json)、[`report-render.json`](verification/venue-pag-multiple-2026-09-19/report-render.json)、[`native-compile.json`](verification/venue-pag-multiple-2026-09-19/native-compile.json)、[`package-review.json`](verification/venue-pag-multiple-2026-09-19/package-review.json)、[`release-check.log`](verification/venue-pag-multiple-2026-09-19/release-check.log)。
