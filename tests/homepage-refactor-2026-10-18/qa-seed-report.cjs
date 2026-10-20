const projectId = 'project-report-a'
const otherProjectId = 'project-report-b'
const projectNote = '用于报告分页截图的项目备注：逐页核对项目资料、计算结果、完整设备端口、线材规格和灯具地址。'.repeat(2)
const lineNote = '施工前按设备面板再次核对端口标签，并确认线材两端的接头方向。'.repeat(2)
const longResult = `完整计算结果与参数说明需在分页图片中全部出现。${'逐项记录限幅输入、输出峰值、音箱数量和高通条件。\n'.repeat(180)}`
const longRecordName = `报告分页核对方案-${'南区主扩声'.repeat(4)}`

function makeRecord(index) {
  const module = index === 15 ? 'ledScreen' : 'limiter'
  const preferences = module === 'ledScreen'
    ? {
      wallWidthText: '6', wallHeightText: '3.2', topReserveText: '0.2', bottomReserveText: '0.2',
      frameWidthText: '5', viewingDistanceText: '4', aspectRatio: '16:9', unitKey: 'module', pitch: 'recommended',
    }
    : {
      amplifierModel: `报告功放 ${index}`,
      speakerModel: '全频音箱 A',
      count: 4,
      wiring: 'parallel',
      mode: 'stereo',
      sensitivityVoltage: 1.4,
      highPassFrequency: 40,
    }
  const title = index === 1 ? longRecordName : `${module === 'ledScreen' ? 'LED 拼装' : '限幅方案'} ${String(index).padStart(2, '0')}`
  const record = {
    id: `record-report-a-${String(index).padStart(2, '0')}`,
    module,
    title,
    summary: module === 'ledScreen' ? '墙体 6 × 3.2 m · P1.86' : `阈值 ${-3 - index} dBFS · Attack 10 ms`,
    preferences,
    resultText: index === 1
      ? `${longResult}\n记录编号：record-report-a-01\n完整数据结束。`
      : module === 'ledScreen'
        ? '墙体尺寸：6 × 3.2 m\n四周包边：5 cm\n拼装单元：模组 320 × 160 mm\n计算结果：建议复核画面比例与实际安装结构。'
        : `输入参数核对完成。\n限幅结果：输出峰值 ${-3 - index} dBFS。\n结果编号：${String(index).padStart(2, '0')}`,
    signature: JSON.stringify([module, preferences]),
    favorite: false,
    archived: false,
    projectIds: [projectId],
    projectMetadata: {
      [projectId]: {
        name: index === 1 ? longRecordName : `${module === 'ledScreen' ? 'LED 拼装' : '限幅方案'} ${String(index).padStart(2, '0')}`,
        note: index === 1 ? '用于测试长名称和报告分页的项目方案备注。'.repeat(3) : '',
        savedAt: 1792300000000 + index,
      },
    },
    createdAt: 1792300000000 + index,
    updatedAt: 1792300000000 + index,
  }
  return record
}

const devices = [
  { id: 'device-report-a-mixer', type: 'mixer', name: '调音台 A', autoName: false },
  { id: 'device-report-a-processor', type: 'processor', name: '处理器 A', autoName: false },
]

const wiringSchedule = {
  version: 1,
  revision: 3,
  nextNumber: 3,
  devices,
  lines: [
    {
      id: 'line-report-a-001', code: 'A001', purpose: '主扩左声道',
      fromDevice: '调音台 A', fromDeviceId: 'device-report-a-mixer', fromPort: 'OUT 1',
      toDevice: '处理器 A', toDeviceId: 'device-report-a-processor', toPort: 'IN L',
      buildType: 'finished', cableType: 'balanced', spec: '双芯屏蔽线 2 × 0.5 mm²',
      connectorA: 'xlrMale', connectorB: 'xlrFemale', lengthText: '18.5', status: 'checked', notes: lineNote,
    },
    {
      id: 'line-report-a-002', code: 'A002', purpose: '主扩右声道',
      fromDevice: '调音台 A', fromDeviceId: 'device-report-a-mixer', fromPort: 'OUT 2',
      toDevice: '处理器 A', toDeviceId: 'device-report-a-processor', toPort: 'IN R',
      buildType: 'bulk', cableType: 'balanced', spec: '双芯屏蔽线 2 × 0.5 mm²',
      connectorA: 'xlrMale', connectorB: 'xlrFemale', lengthText: '20', status: 'connected', notes: '',
    },
  ],
}

const project = {
  id: projectId,
  name: '报告截图测试项目',
  createdAt: 1792300000000,
  updatedAt: 1792300000000,
  venueName: '主厅',
  engineer: '项目工程师',
  projectDate: '2026-10-18',
  notes: projectNote,
  roomLengthText: '18',
  roomWidthText: '12',
  roomHeightText: '5',
  standardClassKey: 'conference',
  gradeKey: 'II',
  wiringSchedule,
}

const otherProject = {
  id: otherProjectId,
  name: '隔离测试的另一项目',
  createdAt: 1792200000000,
  updatedAt: 1792200000000,
  venueName: '',
  engineer: '',
  projectDate: '2026-10-17',
  notes: '',
  roomLengthText: '',
  roomWidthText: '',
  roomHeightText: '',
  standardClassKey: 'conference',
  gradeKey: 'II',
  wiringSchedule: { version: 1, revision: 0, nextNumber: 1, devices: [], lines: [] },
}

const fixtureIds = ['fixture-report-a-01', 'fixture-report-a-02']
const groupId = 'group-report-a-main'
const lightingEnvelope = {
  version: 1,
  contexts: {
    [projectId]: {
      projectId,
      revision: 7,
      scheme: {
        version: 2,
        preferences: {
          startAddressText: '1',
          allocationMode: 'auto',
          groupSummary: '舞台染色灯 × 2（6CH）',
          groups: [{
            name: '舞台染色灯组', fixtureSource: 'custom', fixtureModel: '',
            customName: '舞台染色灯', customChannelCount: '6',
            libraryChannelCount: '', channelCount: '6', fixtureCount: '2', targetUniverse: 'A',
          }],
        },
        groupIds: [groupId],
        fixtureIdsByGroup: { [groupId]: fixtureIds },
        checksById: {},
        layout: {
          positionsById: {
            [fixtureIds[0]]: { x: 0.28, y: 0.32, zone: 'stage-left', row: 1, column: 1 },
            [fixtureIds[1]]: { x: 0.72, y: 0.32, zone: 'stage-right', row: 1, column: 2 },
          },
        },
      },
    },
    [otherProjectId]: {
      projectId: otherProjectId,
      revision: 1,
      scheme: {
        version: 2,
        preferences: { startAddressText: '1', allocationMode: 'auto', groupSummary: '', groups: [] },
        groupIds: [], fixtureIdsByGroup: {}, checksById: {}, layout: null,
      },
    },
  },
}

const records = Array.from({ length: 15 }, (_, index) => makeRecord(index + 1))
records.push({
  id: 'record-report-b-only',
  module: 'limiter',
  title: '另一项目的记录，不应进入报告',
  summary: 'cross-project fixture',
  preferences: { amplifierModel: '隔离功放', count: 1 },
  resultText: '此记录属于另一个项目。',
  signature: JSON.stringify(['limiter', { amplifierModel: '隔离功放', count: 1 }]),
  favorite: false,
  archived: false,
  projectIds: [otherProjectId],
  createdAt: 1792200000000,
  updatedAt: 1792200000000,
})

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function createReportQaStorage(schemaVersion = 4) {
  if (![3, 4].includes(schemaVersion)) throw new RangeError('Report QA seed supports storage schema 3 or 4.')
  return {
    'audioTool.storageSchemaVersion': schemaVersion,
    'audioTool.projects.v1': clone([project, otherProject]),
    'audioTool.records.v1': clone(records),
    'audioTool.favorites.v1': [],
    'audioTool.recovery.v1': [],
    'audioTool.activeProject.v1': projectId,
    'audioTool.dmxLightingWorkspace.v2': clone(lightingEnvelope),
  }
}

module.exports = {
  projectId,
  otherProjectId,
  storage: createReportQaStorage(4),
  schema3: createReportQaStorage(3),
  schema4: createReportQaStorage(4),
  createReportQaStorage,
}
