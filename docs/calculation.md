# 限幅器计算公式说明

本文档记录当前版本采用的计算逻辑，方便后续核对、修改和交付说明。

## 1. 已确认基准

DSP 输出限幅器阈值单位为 dBFS。

2026-09-19 用户确认采用本次设备校准：内部 1 kHz 正弦波、0 dBFS、输出 Gain 0 dB，平衡 OUT+ 对 OUT−，万用表交流档读数 6.45 Vrms。按 0.775 V 参考换算为 18.40516 dBu，按用户选定的一位小数采用 `18.4 dBu`。设备和仪表型号未提供；本记录不宣称已独立验证仪表 1 kHz 精度、失真或限幅起控，其他设备需另行校准。

```text
0 dBFS = +18.4 dBu
```

dBu 电压参考值：

```text
0 dBu = 0.775 V RMS
```

## 2. 总阻抗

每通道连接 1 只音箱时：

```text
Z_total = Z_speaker
```

多只音箱并联时：

```text
Z_total = Z_speaker / N
```

多只音箱串联时：

```text
Z_total = Z_speaker × N
```

其中：

- `Z_total`：每通道总阻抗
- `Z_speaker`：单只音箱标称阻抗
- `N`：每通道音箱数量

## 3. 音箱总额定功率

```text
P_speaker_total = P_speaker_rated × N
```

其中：

- `P_speaker_total`：每通道音箱总额定功率
- `P_speaker_rated`：单只音箱额定功率

## 4. 音箱允许输出电压

```text
V_speaker = √(P_speaker_total × Z_total)
```

## 5. 功放额定输出电压

根据当前功放型号、功放模式和总阻抗，从说明书功率表中查找功放额定功率。

```text
V_amp = √(P_amp_rated × Z_total)
```

当前版本只使用说明书中明确给出的阻抗功率点，不做插值。

## 6. 目标输出电压

```text
V_target = min(V_speaker, V_amp)
```

含义：

- 如果音箱额定承受能力低于功放额定输出，按音箱额定功率限制。
- 如果功放额定输出低于音箱额定承受能力，按功放满功率输入限制。

## 7. 限幅器输入电压

```text
V_limiter_input = V_sensitivity × V_target / V_amp
```

其中：

- `V_sensitivity`：功放输入灵敏度挡位，当前为 1 V 或 2 V

## 8. 换算为 dBu

```text
dBu = 20 × log10(V_limiter_input / 0.775)
```

## 9. 换算为 dBFS

因为：

```text
0 dBFS = +18.4 dBu
```

所以：

```text
Threshold_dBFS = dBu - 18.4
```

## 10. 示例

默认组合：

- 功放：TC-2350B
- 音箱：TS-803C
- 每通道数量：1 只
- 连接方式：并联，1 只时等同单只
- 功放模式：立体声/单通道
- 输入灵敏度：1 V
- 通道高通频率（HPF）：80 Hz

计算结果：

```text
总阻抗 = 4 Ω
音箱总额定功率 = 300 W
目标输出电压 = 34.64 V
DSP 模拟输出 = -0.8 dBu
限幅器阈值 = -19.2 dBFS
Attack 建立时间 = 8 ms
Release 释放时间 = 128 ms
```

## 11. 建立时间和释放时间推荐规则

Attack 建立时间和 Release 释放时间没有全行业统一固定值，不同 DSP 或动态处理器厂商对时间常数的定义也可能不同。

限幅阈值不依赖 HPF，可直接按功放、音箱和连接参数计算。只有 Attack/Release 推荐需要用户选择 **DSP 输出通道实际设置的高通频率（HPF）**；未选择时仅不输出时间参数，不影响限幅阈值。HPF 越低，时间常数越长。

| 通道 HPF | Attack | Release |
| --- | ---: | ---: |
| ≤31 Hz | 45 ms | 720 ms |
| 31–63 Hz | 16 ms | 256 ms |
| 63–125 Hz | 8 ms | 128 ms |
| 125–250 Hz | 4 ms | 64 ms |
| 250–500 Hz | 2 ms | 32 ms |
| 500 Hz–1 kHz | 1 ms | 16 ms |
| 1–2 kHz | 0.5 ms | 8 ms |
| ≥2 kHz | 0.3 ms | 4.8 ms |

Release 固定为 Attack 的 16 倍。

采用该规则的原因：

- 时间依据当前输出通道的 HPF 设置，因此能随分频设置变化；音箱型号本身不能代替该参数。
- Attack 太快，容易在低频波形内部产生突兀增益变化，增加失真风险。
- Release 太快，容易出现喘振、抽吸，低频更明显。
- Release 太慢，限幅后恢复过慢，听感容易发闷。

参考资料：

- Martin Audio《DX1 User Guide》提供了按输出通道高通频率自动设置 Attack/Release 的分档表；本项目采用该分档逻辑。
- Rane《Dynamics Processors -- Technology & Applications》说明 Attack/Release 没有严格行业统一定义，不同厂商定义可能不同。

因此，小程序中的 Attack/Release 显示为“推荐值”，不是国家标准、AES 固定标准或公司最终实测预设。后续如果公司有实测保护参数，应优先使用公司实测值。
