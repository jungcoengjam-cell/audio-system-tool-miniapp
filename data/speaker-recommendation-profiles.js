// 仅收录已从公司说明书复核过角色、覆盖角和最大声压级的型号。
// 线阵列、音柱和覆盖角可变的产品不进入本版自动推荐。

const mainSpeakers = [
  {
    model: 'KF-D10F',
    role: '主扩',
    type: '定覆盖全频',
    horizontalCoverageDeg: 100,
    verticalCoverageDeg: 90,
    maximumSplDb: 129,
    source: 'KF-D10F 产品说明书',
  },
  {
    model: 'KF-D12F',
    role: '主扩',
    type: '定覆盖全频',
    horizontalCoverageDeg: 100,
    verticalCoverageDeg: 90,
    maximumSplDb: 132,
    source: 'KF-D12F 产品说明书',
  },
  {
    model: 'KF-D15F',
    role: '主扩',
    type: '定覆盖全频',
    horizontalCoverageDeg: 100,
    verticalCoverageDeg: 90,
    maximumSplDb: 133,
    source: 'KF-D15F 产品说明书',
  },
  {
    model: 'KF-D12H',
    role: '主扩',
    type: '定覆盖全频',
    horizontalCoverageDeg: 70,
    verticalCoverageDeg: 60,
    maximumSplDb: 135,
    source: 'KF-D12H 产品说明书',
  },
  {
    model: 'KF-D15H',
    role: '主扩',
    type: '定覆盖全频',
    horizontalCoverageDeg: 70,
    verticalCoverageDeg: 60,
    maximumSplDb: 136,
    source: 'KF-D15H 产品说明书',
  },
]

const fillSpeakers = [
  {
    model: 'KS-08AT',
    role: '补声/延时',
    type: '定覆盖全频',
    horizontalCoverageDeg: 80,
    verticalCoverageDeg: 60,
    maximumSplDb: 119,
    source: 'KS-08AT 产品说明书（额定最大声压级）',
  },
  {
    model: 'KF-D10F',
    role: '补声/延时',
    type: '定覆盖全频',
    horizontalCoverageDeg: 100,
    verticalCoverageDeg: 90,
    maximumSplDb: 129,
    source: 'KF-D10F 产品说明书',
  },
  {
    model: 'KF-D12F',
    role: '补声/延时',
    type: '定覆盖全频',
    horizontalCoverageDeg: 100,
    verticalCoverageDeg: 90,
    maximumSplDb: 132,
    source: 'KF-D12F 产品说明书',
  },
]

module.exports = {
  mainSpeakers,
  fillSpeakers,
}
