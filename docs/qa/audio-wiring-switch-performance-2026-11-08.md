# 接线助手切换响应优化 · 2026-11-08

切换接头时，页面原先在选择框关闭前分别为屏幕图和分享图同步求解防交叉路径，复杂组合会占住界面。本次改为离线生成 63 种固定接法的标准图形路径，正常切换、测高、主题切换和导出直接复用。接法身份、照片针位、标签和障碍区域均匹配后才命中，实际几何或连接变化仍回退原求解器。

现有接线图、线芯点击加粗、四个按钮右侧竖排、业务算法与接法数据保持原样。页面入口 index.js、WXML、WXSS、模型、照片清单均与用户已确认的基线哈希一致。

| 检查 | 结果 |
| --- | --- |
| 浏览器实际指针切换 | 同一 320px 场景、CPU 2 倍降速、4 次首次切换：最慢处理从 7979.0ms 降至 41.1ms；优化后无运行时寻路，无长任务，零延时定时器最大等待 46.8ms。此为电脑浏览器模拟，不是真机耗时。 |
| 全部固定模型 | 新性能回归覆盖 63 模型 × 5 冷尺寸，含亮暗主题、选中、照片就绪和紧凑导出，heavy solver 调用为 0；模型/针位变化回退、微小浮点差异、语言排序和返回路径隔离均通过。用例已加入完整 release-check。 |
| 图形保持 | 315 组连线、焊点、照片和标签几何与用户确认版严格一致；24 张接线图及导出 PNG 字节完全相同。独立原图焊点、全段交叉、完整触摸路径检查通过。 |
| 页面交互 | 12 场景、51 次逐线点选/再次取消、正确焊点高亮、竖排按钮和图片导出通过。 |
| 业务保护 | 41 个业务文件、7 个照片/焊点清单文件及 63 模型/复制内容保持不变。release-check 仅新增一行性能用例注册，移除该行即恢复原文件哈希，门限和其他内容不变。 |
| 包体与编译 | 预计算数据 77,746B，接线分包 JS 总计 353,953B，满足既有 352KiB 分包及 160KiB 单文件门限。WXML/WXSS 40/35 编译证据与未变源码匹配。 |
| 完整回归 | node tests/release-check.js 退出 0；包括最终版本的新性能回归和既有页面、绘图、存储、异步生命周期与触觉反馈检查。 |

数据按重复 JSON 片段存储，运行时恢复后的对象与原始完整坐标表深度相同，未减少签名保护或坐标精度。原生成脚本可重新生成该资产，未增加依赖。

## 修改文件

- `pages/audio-wiring/wiring-renderer.js`
- `pages/audio-wiring/solder-route-table.js`
- `pages/audio-wiring/solder-route-table-data.js`
- `tests/generate-audio-wiring-solder-route-table.cjs`
- `tests/audio-wiring-solder-route-table-regression.cjs`
- `tests/release-check.js`

## 证据与真机验收

[最终独立复审快照](../../tmp/wiring-switch-performance-2026-11-08/final-review.json)、[切换耗时](../../tmp/wiring-switch-performance-2026-11-08/after-browser/result.json)、[图形一致性](../../tmp/wiring-switch-performance-2026-11-08/accepted-geometry-comparison.json)、[完整回归](../../tmp/wiring-switch-performance-2026-11-08/release-check.log)。

本次微信 preview 上传连续 3 次返回网络错误 code 10：TLS 连接建立前中断。新二维码尚未生成。CLI 进程虽然返回 0，但远端结果失败，未将它记录为成功。诊断中 Node/curl 对微信公开服务的 TLS GET 可以连接，预览上传仍失败。

原接线图和按钮位置已由用户确认；本次优化后的实际手机响应、渲染和系统分享界面尚未真机复测，未把浏览器结果记为真机通过。
