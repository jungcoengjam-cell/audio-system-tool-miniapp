const assert = require('assert/strict');

const RECORDS_KEY = 'audioTool.records.v1';
const PROJECTS_KEY = 'audioTool.projects.v1';
const FAVORITES_KEY = 'audioTool.favorites.v1';
const RECOVERY_KEY = 'audioTool.recovery.v1';
const ACTIVE_KEY = 'audioTool.activeProject.v1';
const SCHEMA_KEY = 'audioTool.storageSchemaVersion';
const SCHEMA_VERSION = 4;
const GAIN_PREFERENCES_KEY = 'audioTool.gainStructure.preferences';

const storage = new Map([
  [RECORDS_KEY, []],
  [PROJECTS_KEY, []],
  [FAVORITES_KEY, []],
  [RECOVERY_KEY, []],
  [ACTIVE_KEY, ''],
  [SCHEMA_KEY, SCHEMA_VERSION],
]);
const writeCounts = new Map();
let failedWriteKey = '';

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

global.wx = {
  getStorageSync(key) {
    return clone(storage.get(key));
  },
  setStorageSync(key, value) {
    writeCounts.set(key, (writeCounts.get(key) || 0) + 1);
    if (key === failedWriteKey) throw new Error('simulated write failure');
    storage.set(key, clone(value));
  },
  getStorageInfoSync() { return { currentSize: 1, limitSize: 100 }; },
};

delete require.cache[require.resolve('../utils/records')];
const records = require('../utils/records');

const projectA = records.createProject('Gain 项目 A');
const projectB = records.createProject('Gain 项目 B');
const projectC = records.createProject('Gain 项目 C');
const projectD = records.createProject('Gain 项目 D');
assert(projectA && projectB && projectC && projectD);

const preferences = {
  amplifierModel: 'TC-2350B',
  inputLevelType: 'sensitivity',
  sensitivityVoltage: 1.4,
  sensitivityUnit: 'Vrms',
  dspReferenceDbfs: 0,
  dspReferenceDbm: 18,
  eqBoostDb: 0,
};
const payload = {
  module: 'gainStructure',
  title: 'Gain 全局标题',
  summary: '增益结构结果摘要',
  resultText: '输入电压：1.4 Vrms\nDSP 参考：+18 dBm',
  preferences,
};
const signature = JSON.stringify(['gainStructure', preferences]);

const defaultSaved = records.addRecordToProject(payload, projectA.id);
assert(defaultSaved, 'Gain 两参数调用仍可保存');
assert.equal(defaultSaved.projectMetadata, undefined, '默认不添加项目元数据');
assert.equal(defaultSaved.signature, signature);
assert.equal(storage.get(SCHEMA_KEY), SCHEMA_VERSION, '存储 schema 使用独立收藏版本');

const firstMetadata = { name: 'A 项目配置', note: 'A 项目备注' };
const recordA = records.addRecordToProject(payload, projectA.id, firstMetadata);
assert.equal(recordA.id, defaultSaved.id, '同参数增加元数据复用原记录');
assert.equal(recordA.signature, signature, '元数据不进入签名');
assert.equal(recordA.title, payload.title, '项目配置名不覆盖全局标题');
assert.deepEqual(recordA.preferences, preferences);
assert.deepEqual(Object.keys(recordA.preferences), Object.keys(preferences));
assert.equal(recordA.projectMetadata[projectA.id].name, firstMetadata.name);
assert.equal(recordA.projectMetadata[projectA.id].note, firstMetadata.note);
assert(Number.isFinite(recordA.projectMetadata[projectA.id].savedAt));

const recordB = records.addRecordToProject(payload, projectB.id, {
  name: 'B 项目配置',
  note: 'B 项目备注',
});
assert.equal(recordB.id, recordA.id, '跨项目同参数复用同一记录');
assert.deepEqual(recordB.projectIds, [projectA.id, projectB.id]);
assert.equal(recordB.projectMetadata[projectA.id].name, 'A 项目配置');
assert.equal(recordB.projectMetadata[projectB.id].name, 'B 项目配置');
assert.equal(recordB.projectMetadata[projectA.id].note, 'A 项目备注');
assert.equal(recordB.projectMetadata[projectB.id].note, 'B 项目备注');
assert.equal(recordB.title, payload.title);
assert.equal(recordB.signature, signature);

const updatedA = records.addRecordToProject(payload, projectA.id, {
  name: 'A 项目更新名',
  note: 'A 项目更新备注',
});
assert.equal(updatedA.id, recordA.id, '同项目同参数的元数据更新复用记录');
assert.equal(updatedA.projectMetadata[projectA.id].name, 'A 项目更新名');
assert.equal(updatedA.projectMetadata[projectA.id].note, 'A 项目更新备注');
assert.equal(updatedA.projectMetadata[projectB.id].name, 'B 项目配置', '只更新当前项目元数据');
assert.equal(updatedA.projectMetadata[projectB.id].note, 'B 项目备注');
assert.equal(updatedA.title, payload.title, '共享标题保持原值');
assert.equal(updatedA.signature, signature, '项目元数据不改变身份签名');
assert(!Object.keys(updatedA.preferences).includes('name'));
assert(!Object.keys(updatedA.preferences).includes('note'));
assert(!updatedA.signature.includes('项目配置'));

const maxLengthRecord = records.addRecordToProject({
  ...payload,
  title: 'Gain 边界长度测试',
  preferences: { ...preferences, eqBoostDb: 1 },
}, projectC.id, {
  name: '名'.repeat(60),
  note: '注'.repeat(200),
});
assert(maxLengthRecord);
assert.equal(maxLengthRecord.projectMetadata[projectC.id].name.length, 60);
assert.equal(maxLengthRecord.projectMetadata[projectC.id].note.length, 200);

const sameNameOne = records.addRecordToProject({
  ...payload,
  title: 'Gain 同名记录一',
  preferences: { ...preferences, eqBoostDb: 2 },
}, projectA.id, { name: '同名配置', note: '第一条参数' });
const sameNameTwo = records.addRecordToProject({
  ...payload,
  title: 'Gain 同名记录二',
  preferences: { ...preferences, eqBoostDb: 3 },
}, projectA.id, { name: '同名配置', note: '第二条参数' });
assert(sameNameOne && sameNameTwo);
assert.notEqual(sameNameOne.id, sameNameTwo.id, '同名不同参数保存为不同记录');
assert.equal(records.getProjectRecords(projectA.id)
  .filter((item) => item.projectMetadata?.[projectA.id]?.name === '同名配置').length, 2);

function totalWrites() {
  return [...writeCounts.values()].reduce((sum, count) => sum + count, 0);
}
const writesBeforeInvalidMetadata = totalWrites();
[
  null,
  [],
  {},
  { name: '' },
  { name: ' \t ' },
  { name: 5 },
  { name: [] },
  { name: 'x'.repeat(61) },
  { name: '有效名称', note: 5 },
  { name: '有效名称', note: null },
  { name: '有效名称', note: 'x'.repeat(201) },
  { name: '有效名称', extra: true },
].forEach((metadata) => {
  assert.equal(records.addRecordToProject(payload, projectA.id, metadata), null);
});
assert.equal(totalWrites(), writesBeforeInvalidMetadata, '非法 metadata 被拒绝且不产生写入');

const canonicalBeforeProjection = records.getRecordByPayload(payload);
assert.equal(canonicalBeforeProjection.id, recordA.id);
const canonicalSnapshot = clone(canonicalBeforeProjection);
const projectView = records.getProjectRecordView(canonicalBeforeProjection, projectA.id);
assert.equal(projectView.title, 'A 项目更新名');
assert.equal(projectView.projectNote, 'A 项目更新备注');
assert.equal(projectView.hasProjectMetadata, true);
assert.equal(projectView.updatedAt, canonicalBeforeProjection.projectMetadata[projectA.id].savedAt);
assert.notEqual(projectView, canonicalBeforeProjection);
assert.notEqual(projectView.projectMetadata, canonicalBeforeProjection.projectMetadata);
assert.notEqual(projectView.projectMetadata[projectA.id], canonicalBeforeProjection.projectMetadata[projectA.id]);
projectView.projectMetadata[projectA.id].name = '只改投影视图';
projectView.preferences.amplifierModel = '只改投影视图';
assert.deepEqual(canonicalBeforeProjection, canonicalSnapshot, '投影视图修改不污染共享记录');
assert.equal(records.getProjectRecordView(canonicalBeforeProjection, projectB.id).title, 'B 项目配置');

const unrelatedProjectView = records.getProjectRecordView(canonicalBeforeProjection, projectC.id);
assert.equal(unrelatedProjectView.title, payload.title, '无关联项目元数据时显示共享标题');
assert.equal(unrelatedProjectView.hasProjectMetadata, undefined);
assert.equal(unrelatedProjectView.projectNote, undefined);

const inheritedMetadataRecord = {
  ...canonicalBeforeProjection,
  projectMetadata: {},
};
Object.defineProperty(Object.prototype, projectA.id, {
  configurable: true,
  value: { name: '不应投影的继承值', note: '不应投影的继承备注' },
});
let inheritedMetadataView;
try {
  inheritedMetadataView = records.getProjectRecordView(inheritedMetadataRecord, projectA.id);
} finally {
  delete Object.prototype[projectA.id];
}
assert.equal(inheritedMetadataView.title, payload.title, '继承的项目键不会覆盖共享标题');
assert.equal(inheritedMetadataView.hasProjectMetadata, undefined);
assert.equal(inheritedMetadataView.projectNote, undefined);
assert.deepEqual(inheritedMetadataRecord.projectMetadata, {}, '检查原型键不修改输入记录');

const legacyRecord = {
  id: 'gain-legacy-record',
  module: 'gainStructure',
  title: '旧版 Gain 记录标题',
  summary: '旧摘要',
  resultText: '旧结果',
  preferences: { legacyPreference: true },
  projectIds: [projectA.id],
  updatedAt: 123,
};
const legacyView = records.getProjectRecordView(legacyRecord, projectA.id);
assert.equal(legacyView.title, legacyRecord.title, '旧记录没有 metadata 时回退到全局标题');
assert.equal(legacyView.hasProjectMetadata, undefined);
assert.equal(legacyView.projectNote, undefined);

const splPayload = {
  module: 'spl',
  title: 'SPL 兼容记录',
  summary: '声压结果',
  resultText: '声压级结果文本',
  preferences: { distance: 10, power: 100 },
};
const writesBeforeOtherModuleValidation = totalWrites();
assert.equal(records.addRecordToProject({ ...splPayload, module: 'dmxAddress' }, projectC.id, {
  name: 'DMX 项目配置',
  note: '必须拒绝',
}), null, '第三参数元数据继续只对白名单模块开放');
assert.equal(totalWrites(), writesBeforeOtherModuleValidation, '拒绝其他模块元数据时不写存储');
const splRecordC = records.addRecordToProject(splPayload, projectC.id, {
  name: 'SPL C 项目配置', note: 'C 项目备注',
});
const splRecordD = records.addRecordToProject(splPayload, projectD.id, {
  name: 'SPL D 项目配置', note: 'D 项目备注',
});
assert(splRecordC && splRecordD, 'SPL 项目配置名和备注可按项目保存');
assert.equal(splRecordC.id, splRecordD.id);
assert.equal(splRecordC.title, splPayload.title, '项目配置名不覆盖 SPL 共享标题');
const splCanonicalRecord = records.getRecordByPayload(splPayload)
assert.deepEqual(splCanonicalRecord.projectMetadata[projectC.id].name, 'SPL C 项目配置');
assert.deepEqual(splCanonicalRecord.projectMetadata[projectC.id].note, 'C 项目备注');
assert.deepEqual(splCanonicalRecord.projectMetadata[projectD.id].name, 'SPL D 项目配置');
assert.deepEqual(splCanonicalRecord.projectMetadata[projectD.id].note, 'D 项目备注');
assert(Number.isFinite(splCanonicalRecord.projectMetadata[projectC.id].savedAt));
assert(Number.isFinite(splCanonicalRecord.projectMetadata[projectD.id].savedAt));
const splViewC = records.getProjectRecordView(splCanonicalRecord, projectC.id);
const splViewD = records.getProjectRecordView(splCanonicalRecord, projectD.id);
assert.equal(splViewC.title, 'SPL C 项目配置');
assert.equal(splViewC.projectNote, 'C 项目备注');
assert.equal(splViewC.hasProjectMetadata, true);
assert.equal(splViewD.title, 'SPL D 项目配置');
assert.equal(splViewD.projectNote, 'D 项目备注');
assert.equal(splViewD.hasProjectMetadata, true);
const splRecordBeforeFailedWrite = clone(records.getRecordByPayload(splPayload));
const splStorageBeforeFailedWrite = storageSnapshot();
failedWriteKey = RECORDS_KEY;
assert.equal(records.addRecordToProject(splPayload, projectC.id, {
  name: 'SPL 写入失败', note: '不应保留',
}), null);
failedWriteKey = '';
assert.deepEqual(storageSnapshot(), splStorageBeforeFailedWrite,
  'SPL records 存储失败时记录与项目保持原状');
assert.deepEqual(records.getRecordByPayload(splPayload), splRecordBeforeFailedWrite,
  'SPL records 存储失败时缓存保持原状');
failedWriteKey = PROJECTS_KEY;
assert.equal(records.addRecordToProject(splPayload, projectC.id, {
  name: 'SPL 项目写入失败', note: '不应保留',
}), null);
failedWriteKey = '';
assert.deepEqual(storageSnapshot(), splStorageBeforeFailedWrite,
  'SPL 项目存储失败时 records 与 projects 均回滚');
assert.deepEqual(records.getRecordByPayload(splPayload), splRecordBeforeFailedWrite,
  'SPL 项目存储失败时缓存保持原状');

const savedBeforeFavorite = records.getRecordByPayload(payload);
const favoriteOn = records.toggleFavorite(payload);
assert.equal(favoriteOn.favorite, true);
assert.notEqual(favoriteOn.id, savedBeforeFavorite.id, '收藏拥有独立快照编号');
assert.equal(favoriteOn.title, payload.title, '收藏保留原计算标题');
assert.deepEqual(favoriteOn.preferences, preferences);
assert.equal(favoriteOn.signature, signature);
assert.deepEqual(favoriteOn.projectIds, []);
assert.deepEqual(favoriteOn.originProjectIds, [projectA.id, projectB.id]);
assert.equal(favoriteOn.projectMetadata, undefined, '收藏不继承项目内名称和备注');
assert.equal(records.getRecordById(savedBeforeFavorite.id).favorite, false, '收藏不修改项目计算记录');
assert.equal(records.restoreRecord(favoriteOn), '/pages/gain-structure/gain-structure');
assert.deepEqual(storage.get(GAIN_PREFERENCES_KEY), undefined, '路由解析不覆盖临时 Gain 偏好');

const favoriteOff = records.toggleFavoriteById(favoriteOn.id);
assert.equal(favoriteOff, null, '取消收藏成功后返回空值');
assert.equal(records.getFavorites().some((item) => item.id === favoriteOn.id), false);
const favoriteRecovery = records.getRecoveryEntries().find((entry) => entry.kind === 'favorite'
  && entry.targetId === favoriteOn.id);
assert(favoriteRecovery, '取消收藏可从恢复区找回独立快照');
assert.deepEqual(favoriteRecovery.snapshot.preferences, preferences);

const favoriteSpl = records.toggleFavorite(splPayload);
assert.equal(favoriteSpl.favorite, true, 'SPL 收藏使用独立快照');
assert.notEqual(favoriteSpl.id, splCanonicalRecord.id);

function storageSnapshot() {
  return {
    records: clone(storage.get(RECORDS_KEY)),
    projects: clone(storage.get(PROJECTS_KEY)),
  };
}
const rollbackRecordBefore = clone(records.getRecordByPayload(payload));
const rollbackStorageBefore = storageSnapshot();
failedWriteKey = RECORDS_KEY;
assert.equal(records.addRecordToProject(payload, projectA.id, {
  name: '记录写入失败',
  note: '不应保留',
}), null);
failedWriteKey = '';
assert.deepEqual(storageSnapshot(), rollbackStorageBefore, 'records 写入失败时存储保持原状');
assert.deepEqual(records.getRecordByPayload(payload), rollbackRecordBefore, 'records 写入失败时缓存保持原状');

const rollbackProjectUpdatedAt = records.getProjects().find((item) => item.id === projectA.id).updatedAt;
failedWriteKey = PROJECTS_KEY;
assert.equal(records.addRecordToProject(payload, projectA.id, {
  name: 'projects 写入失败',
  note: '不应保留',
}), null);
failedWriteKey = '';
assert.deepEqual(storageSnapshot(), rollbackStorageBefore, 'projects 写入失败时 records 与 projects 均回滚');
assert.deepEqual(records.getRecordByPayload(payload), rollbackRecordBefore, 'projects 写入失败后记录缓存恢复');
assert.equal(records.getProjects().find((item) => item.id === projectA.id).updatedAt, rollbackProjectUpdatedAt,
  'projects 写入失败后项目缓存保持原值');

const retainedPayloadFavorite = records.toggleFavorite(payload);
assert(retainedPayloadFavorite, '可重新创建计算收藏快照');
assert.equal(records.getFavoriteByPayload(payload).id, retainedPayloadFavorite.id);
assert.equal(records.getRecordByPayload(payload).favorite, false, '收藏开关不改项目计算记录');

assert.equal(records.removeRecordFromProject(recordA.id, projectA.id), true);
let afterRemoval = records.getRecordByPayload(payload);
assert.deepEqual(afterRemoval.projectIds, [projectB.id]);
assert.equal(afterRemoval.projectMetadata[projectA.id], undefined, '移除关联时清理 Gain 项目元数据');
assert.equal(afterRemoval.projectMetadata[projectB.id].name, 'B 项目配置');

const reattached = records.addRecordToProject(payload, projectA.id, {
  name: 'A 项目重新关联',
  note: '重关联备注',
});
assert.equal(reattached.id, recordA.id);
assert(records.deleteProject(projectA.id));
let afterProjectADeleted = records.getRecordByPayload(payload);
assert.deepEqual(new Set(afterProjectADeleted.projectIds), new Set([projectA.id, projectB.id]),
  '删除项目暂存原记录关联');
assert.equal(records.getProjects().some((item) => item.id === projectA.id), false, '已删除项目从正常列表移除');
assert.equal(afterProjectADeleted.projectMetadata[projectA.id].name, 'A 项目重新关联', '删除时保留可恢复项目元数据');
assert.equal(afterProjectADeleted.projectMetadata[projectB.id].name, 'B 项目配置');
const projectARecovery = records.getRecoveryEntries().find((entry) => entry.kind === 'project'
  && entry.targetId === projectA.id);
assert(projectARecovery && projectARecovery.snapshot.id === projectA.id, '项目删除保存真实恢复快照');
assert.equal(records.restoreRecoveryEntry(projectARecovery.id), true, '删除的项目可恢复');
assert(records.getProjects().some((item) => item.id === projectA.id));
assert.equal(records.getRecordById(recordA.id).projectMetadata[projectA.id].name,
  'A 项目重新关联', '恢复后记录 ID 和配置元数据保持原值');
assert.equal(records.removeRecordFromProject(recordA.id, projectA.id), true);
assert.deepEqual(records.getRecordById(recordA.id).projectIds, [projectB.id]);

assert(records.deleteProject(projectB.id));
const retainedFavorite = records.getRecordByPayload(payload);
assert(retainedFavorite, '最后一个项目移除后计算记录仍保留');
assert.deepEqual(retainedFavorite.projectIds, [projectB.id], '删除的项目关联保留在恢复快照关系中');
assert.equal(records.getProjects().some((item) => item.id === projectB.id), false);
const projectBRecovery = records.getRecoveryEntries().find((entry) => entry.kind === 'project'
  && entry.targetId === projectB.id);
assert(projectBRecovery && records.restoreRecoveryEntry(projectBRecovery.id));
assert.equal(records.getRecordById(recordA.id).projectMetadata[projectB.id].name, 'B 项目配置');
assert.equal(records.removeRecordFromProject(recordA.id, projectB.id), true);
assert.equal(records.getRecordById(recordA.id), null, '移除最后一个关联后当前记录退出活动列表');
assert(records.getRecoveryEntries().some((entry) => entry.kind === 'record-project-link'
  && entry.snapshot.id === recordA.id), '最后一个关联的记录内容进入可恢复区');
assert.equal(records.getFavoriteByPayload(payload).id, retainedPayloadFavorite.id,
  '项目删除不影响独立收藏快照');

assert.equal(records.removeRecordFromProject(splRecordC.id, projectC.id), true);
const afterSplRemoval = records.getRecordByPayload(splPayload);
assert.deepEqual(afterSplRemoval.projectIds, [projectD.id]);
assert.equal(afterSplRemoval.projectMetadata[projectC.id], undefined,
  '移除 SPL 项目关联时清理该项目的配置名和备注');
assert.equal(afterSplRemoval.projectMetadata[projectD.id].name, 'SPL D 项目配置');
assert.equal(afterSplRemoval.projectMetadata[projectD.id].note, 'D 项目备注');
assert(records.deleteProject(projectD.id));
const afterSplProjectDeletion = records.getRecordByPayload(splPayload);
assert.deepEqual(afterSplProjectDeletion.projectIds, [projectD.id], '删项目时保留恢复用关系');
assert.equal(afterSplProjectDeletion.projectMetadata[projectD.id].name, 'SPL D 项目配置');
assert.equal(records.getProjects().some((item) => item.id === projectD.id), false);
const projectDRecovery = records.getRecoveryEntries().find((entry) => entry.kind === 'project'
  && entry.targetId === projectD.id);
assert(projectDRecovery && records.restoreRecoveryEntry(projectDRecovery.id));
assert.equal(records.getProjectRecords(projectD.id).find((item) => item.id === splRecordC.id).projectMetadata[projectD.id].name,
  'SPL D 项目配置', '项目恢复后 SPL 记录关联和 metadata 恢复');

assert.equal(storage.get(SCHEMA_KEY), SCHEMA_VERSION, '完整流程后 schema 仍为 4');
console.log('gain-project-metadata-test: PASS');
