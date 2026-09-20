# 围桌讨论型会议室人数输入复核

日期：2026-09-15

## 本轮范围

本轮只修正 `participantCount` 的输入边界。实现仅将数字或字符串转换为数值，再直接用整数条件和 `4～40` 范围校验，不再四舍五入；只有转换后为 `4～40` 的整数，或对应的整数文本，才进入正常计算。

| 输入 | 结果 |
| --- | --- |
| `3.9` | 拒绝；转换后仍为非整数 |
| `12.6` | 拒绝；转换后仍为非整数 |
| `40.4` | 拒绝；转换后仍为非整数 |
| `4～40` 的整数或整数文本 | 正常 |
| 数组、对象等非标量输入 | 拒绝，不做隐式转数值 |

页面配置只开放本地 Voice Lift。`remote` 仍是既有工具层分支，不新增页面入口或新的 UI 配置。用户旧收藏的原始数据不迁移、不改写；恢复旧的小数人数会进入输入错误，用户需改为整数后再生成。

## 当前验证记录

根审已实跑 1,332 个合法整数输入（37 个人数 × 2 桌形 × 3 安装 × 2 模式 × 3 层高），另有 1,332 个对应整数字符串输入结果等价，25 个非法输入拒绝；完整结果 SHA256 与变更前全同。`node tests/release-check.js` 退出码 0。163 个生产/测试文件哈希中仅 `utils/venue-discussion.js` 与 `tests/venue-discussion-accuracy-regression.js` 变化，10 个保护文件未变；发布包 1,671,838 bytes，主包 JS 754,579 bytes，原预算 1633/737 KiB 未提高。页面结构和样式未变，本轮未重新执行 WXML/WXSS 编译；仍未进行微信真机、现场声学或实际 DSP 验证。实际旧 `12.6` 偏好恢复后保留原字符串并显示整数错误，storage 和旧 record 未改写。原始记录见 [`verification/venue-discussion-2026-09-15/independent-check.cjs`](verification/venue-discussion-2026-09-15/independent-check.cjs)、[`verification/venue-discussion-2026-09-15/independent-check.json`](verification/venue-discussion-2026-09-15/independent-check.json) 和 [`verification/venue-discussion-2026-09-15/release-check.log`](verification/venue-discussion-2026-09-15/release-check.log)。版本号保持 5.0.0，本轮改动尚未发布。

## 先前研究建议（已接续本轮可选复核）

本段保留前一阶段的研究边界；本轮已进入可选单链路复核，方法与限制见 [`docs/venue-pag-nag-2026-09-15.md`](venue-pag-nag-2026-09-15.md)。PAG/NAG 需要具体的发言人、话筒、实际送声音箱、接收分区位置及 NOM；人数和几何覆盖统计不能代替这些条件，也不能把任何几何覆盖或 PAG/NAG 公式结果标为现场合格。Shure 资料第 19/20 页正文可作为研究入口：NAG 可写成 `20 log10(Df / Dn)`，PAG 可写成 `20 log10(D1 × D0 / (D2 × Ds)) - 10 log10(NOM) - 6`。其中 `Ds` 是发言人到话筒，`Df`/`D0` 是发言人到最远听众，`Dn` 是发言人到最近听众，`D1` 是话筒到实际送声的音箱，`D2` 是该音箱到最远听众，`NOM` 是同时开放的话筒数。在线计算器的全向基础、`-6 dB` 余量及自动混音 `NOM=1` 属于该工具的计算假设，不能默认套用于所有现场，也不应默认所有坐席都是话筒位置。

下一步应对一条实际送声链路做实测并与现场对照，核对位置、实际送声分区与 NOM；本轮进展已转入上述可选单链路复核，但单链路结果不能代表所有分区稳定，也不形成声学合格标签。

来源： [Shure PAG/NAG Calculator](https://www.shure.com/en-US/support/tools/pag-nag-calculator)；[Shure《Microphone Techniques for Live Sound Reinforcement》PDF（正文第 19/20 页）](https://www.shure.com/damfiles/default/global/documents/publications/en/performance-production/microphone_techniques_for_live_sound_reinforcement_english.pdf-3df433145fca686a736beeb5da588efa.pdf)。
