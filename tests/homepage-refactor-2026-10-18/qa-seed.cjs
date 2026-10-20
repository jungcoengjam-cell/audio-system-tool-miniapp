'use strict'

// Isolated visual and behavior fixture. It contains synthetic values only.
const mainProjectId = 'qa-project-hall'
const secondProjectId = 'qa-project-studio'
const now = 1792281600000

const projects = [
  {
    id: mainProjectId,
    name: 'QA 多功能厅',
    venueName: '一号馆',
    engineer: '测试工程师',
    projectDate: '2026-10-18',
    notes: '仅用于隔离验收的合成项目。',
    roomLengthText: '18', roomWidthText: '12', roomHeightText: '5',
    standardClassKey: 'conference', gradeKey: 'II', createdAt: now - 86400000,
    updatedAt: now,
    wiringSchedule: {
      version: 1, revision: 2, nextNumber: 3,
      devices: [
        { id: 'qa-device-mixer', type: 'mixer', name: 'QA 调音台', autoName: false },
        { id: 'qa-device-amp', type: 'amplifier', name: 'QA 功放', autoName: false },
      ],
      lines: [
        {
          id: 'qa-line-main-l', code: 'A001', purpose: '主扩左声道',
          fromDevice: 'QA 调音台', fromDeviceId: 'qa-device-mixer', fromPort: 'OUT 1',
          toDevice: 'QA 功放', toDeviceId: 'qa-device-amp', toPort: 'IN L',
          cableType: 'balanced', buildType: 'finished', spec: '2 × 0.5 mm²',
          connectorA: 'xlrMale', connectorB: 'xlrFemale', lengthText: '18', status: 'checked', notes: '合成 QA 线路',
        },
        {
          id: 'qa-line-main-r', code: 'A002', purpose: '主扩右声道',
          fromDevice: 'QA 调音台', fromDeviceId: 'qa-device-mixer', fromPort: 'OUT 2',
          toDevice: 'QA 功放', toDeviceId: 'qa-device-amp', toPort: 'IN R',
          cableType: 'balanced', buildType: 'bulk', spec: '2 × 0.5 mm²',
          connectorA: 'xlrMale', connectorB: 'xlrFemale', lengthText: '19.5', status: 'connected', notes: '',
        },
      ],
    },
  },
  {
    id: secondProjectId,
    name: 'QA 录音室', venueName: '二号楼', engineer: '', projectDate: '2026-10-17',
    notes: '第二个合成项目，用于项目筛选验证。', createdAt: now - 172800000, updatedAt: now - 3600000,
  },
]

function record(id, module, title, summary, preferences, resultText, projectId, offset = 0) {
  return {
    id, module, title, summary, preferences, resultText,
    signature: JSON.stringify([module, preferences]),
    projectIds: [projectId], favorite: false, archived: false,
    createdAt: now - offset, updatedAt: now - offset,
    projectMetadata: { [projectId]: { name: title, note: '合成 QA 参数方案。' } },
  }
}

const records = [
  record('qa-record-limiter', 'limiter', 'QA 主扩限幅', '峰值阈值 −3 dBFS', {
    amplifierModel: 'KT-P21000', speakerModel: 'KF-D12F', count: '2', wiring: 'parallel', mode: 'voltage', sensitivityVoltage: '1.4', highPassFrequency: '35',
  }, '合成结果：阈值 −3 dBFS；请勿用于实际施工。', mainProjectId),
  record('qa-record-spl', 'spl', 'QA 前场声压估算', '目标距离 8 m', {
    speakerModel: 'KF-D12F', speakerCount: '2', distanceText: '8', summationMode: 'coherent',
  }, '合成结果：理论声压级 103 dB。', mainProjectId, 1000),
  record('qa-record-cable', 'cable', 'QA 主扩线材', '单程距离 18 m', {
    mode: 'professional', environment: 'indoor', professionalPowerText: '800', professionalDistanceText: '18',
  }, '合成结果：建议规格仅用于界面验收。', mainProjectId, 2000),
  record('qa-record-camera', 'camera', 'QA 摄像机覆盖', '拍摄区域 8 × 5 m', {
    cameraCalculationVersion: 1, sourceMode: 'manual', definitionMode: 'fov', customHorizontalFovText: '72', customVerticalFovText: '42', sceneMode: 'general', groundWidthText: '8', groundDepthText: '5',
  }, '合成结果：覆盖范围示例。', secondProjectId, 3000),
  record('qa-record-led', 'ledScreen', 'QA LED 屏尺寸', '墙体 6 × 3 m', {
    wallWidthText: '6', wallHeightText: '3', frameWidthText: '5', viewingDistanceText: '4', aspectRatio: '16:9', unitKey: 'module', pitch: 'recommended',
  }, '合成结果：四周包边 5 cm；拼装单元 320 × 160 mm。', secondProjectId, 4000),
]

const favorites = [
  { ...records[0], id: 'qa-favorite-limiter-valid', originProjectIds: [mainProjectId], projectIds: [], favorite: true, title: '收藏 · QA 主扩限幅' },
  { ...records[2], id: 'qa-favorite-cable', originProjectIds: [mainProjectId], projectIds: [], favorite: true, title: '收藏 · QA 主扩线材' },
  { ...records[3], id: 'qa-favorite-camera', originProjectIds: [secondProjectId], projectIds: [], favorite: true, title: '收藏 · QA 摄像机覆盖' },
  {
    ...records[0], id: 'qa-favorite-legacy-amplifier', title: '收藏 · QA 历史功放型号',
    preferences: { ...records[0].preferences, amplifierModel: 'QA 功放2x2' },
    signature: JSON.stringify(['limiter', { ...records[0].preferences, amplifierModel: 'QA 功放2x2' }]),
    originProjectIds: [], projectIds: [], favorite: true,
  },
]

const groupId = 'qa-light-group-1'
const fixtureIds = ['qa-light-fixture-1', 'qa-light-fixture-2']
const lightingScheme = {
  version: 2,
  preferences: {
    startAddressText: '1', allocationMode: 'auto', groupSummary: 'QA 前区灯具 × 2',
    groups: [{ name: 'QA 前区灯具', fixtureModel: '', fixtureSource: 'custom', fixtureCount: 2, channelCount: 6, targetUniverse: 'A' }],
  },
  groupIds: [groupId], fixtureIdsByGroup: { [groupId]: fixtureIds }, checksById: {},
  layout: { positionsById: {
    [fixtureIds[0]]: { x: 0.3, y: 0.65, zone: 'front', row: 1, column: 1 },
    [fixtureIds[1]]: { x: 0.7, y: 0.65, zone: 'front', row: 1, column: 2 },
  } },
}

module.exports = {
  'audioTool.storageSchemaVersion': 4,
  'audioTool.projects.v1': projects,
  'audioTool.records.v1': records,
  'audioTool.favorites.v1': favorites,
  'audioTool.recovery.v1': [],
  'audioTool.activeProject.v1': mainProjectId,
  'audioTool.dmxLightingWorkspace.v2': {
    version: 1,
    globalRevision: 1,
    lastContextId: mainProjectId,
    contexts: {
      [mainProjectId]: { revision: 1, scheme: lightingScheme },
      temporary: { revision: 0, scheme: { ...lightingScheme, preferences: { startAddressText: '1', allocationMode: 'auto', groups: [], groupSummary: '' }, groupIds: [], fixtureIdsByGroup: {}, checksById: {}, layout: null } },
    },
    backups: [], legacyMirrorSignature: 'qa-fixture-no-legacy',
    legacyMirrorSnapshot: { preferences: undefined, progress: undefined, layout: undefined },
  },
}
