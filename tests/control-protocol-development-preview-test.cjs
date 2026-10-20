'use strict'

const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const {
  DRAFT_RESOURCES,
  ISOLATED_ROOT_PREFIX,
  MANIFEST_NAME,
  OWNER_MARKER,
  PRIVATE_CONFIG_NAME,
  PREVIEW_RELATIVE,
  buildPreview,
} = require('./build-control-protocol-development-preview.cjs')
const { evaluateDraftProtocolPackageGate } = require('./control-protocol-package-gate')

const rootDirectory = path.resolve(__dirname, '..')
const manualFixtureRoot = path.join(__dirname, 'fixtures', 'control-protocol')
const sourceConfig = JSON.parse(fs.readFileSync(path.join(rootDirectory, 'project.config.json'), 'utf8'))
let createdIsolatedRoot = null
let isolatedRoot = null
let previewDirectory = null
let manualOutputRoot = null
let previewConfigPath = null
const syntheticPrivateConfigBytes = Buffer.from('{"testOnlyPrivatePreview":true}\n', 'utf8')

function initializeIsolatedPreview() {
  createdIsolatedRoot = fs.mkdtempSync(path.join(os.tmpdir(), ISOLATED_ROOT_PREFIX))
  isolatedRoot = createdIsolatedRoot
  previewDirectory = path.join(isolatedRoot, ...PREVIEW_RELATIVE.split('/'))
  manualOutputRoot = path.join(previewDirectory, 'pages', 'control-protocol')
  previewConfigPath = path.join(previewDirectory, 'project.config.json')
}

function assertCurrentIsolatedRootSafe() {
  assert.equal(typeof isolatedRoot, 'string', 'the test owns an initialized isolated root')
  assert.equal(path.resolve(isolatedRoot), path.resolve(createdIsolatedRoot),
    'isolatedRoot is exactly the directory returned by mkdtemp')
  const target = path.resolve(createdIsolatedRoot)
  assert(path.basename(target).startsWith(ISOLATED_ROOT_PREFIX), 'isolated root uses the mkdtemp prefix')
  const stat = fs.lstatSync(target)
  assert.equal(stat.isSymbolicLink(), false, 'isolated root is not a symlink or junction')
  assert.equal(stat.isDirectory(), true, 'isolated root is an existing directory')
  const realTempDirectory = fs.realpathSync(os.tmpdir())
  const realParent = fs.realpathSync(path.dirname(target))
  assert.equal(path.relative(realTempDirectory, realParent), '',
    'isolated root parent is the real system temp directory')
  assert.equal(path.relative(realTempDirectory, fs.realpathSync(target)), path.basename(target),
    'isolated root is a direct child of the real os.tmpdir()')
}

function buildIsolatedPreview() {
  assertCurrentIsolatedRootSafe()
  return buildPreview({ isolatedRoot })
}

function assertPreviewDirectoryBoundary() {
  assert.equal(path.resolve(isolatedRoot), path.resolve(createdIsolatedRoot),
    'isolatedRoot remains the exact directory returned by mkdtemp')
  const resolvedRoot = path.resolve(createdIsolatedRoot)
  const expectedPreview = path.join(resolvedRoot, ...PREVIEW_RELATIVE.split('/'))
  assert.equal(path.resolve(previewDirectory), expectedPreview,
    'restore target is exactly the preview child inside this isolated root')
  assert.equal(path.relative(resolvedRoot, path.resolve(previewDirectory)),
    path.join(...PREVIEW_RELATIVE.split('/')), 'restore target remains within the isolated root')
  const realTempDirectory = fs.realpathSync(os.tmpdir())
  assert.equal(path.relative(realTempDirectory, fs.realpathSync(path.dirname(resolvedRoot))), '',
    'isolated root parent is the real system temp directory')
  for (const directory of [
    resolvedRoot,
    path.join(resolvedRoot, 'docs'),
    path.join(resolvedRoot, 'docs', 'preview'),
    path.resolve(previewDirectory),
  ]) {
    const stat = fs.lstatSync(directory)
    assert.equal(stat.isSymbolicLink(), false, 'restore path contains no link: ' + directory)
    assert.equal(stat.isDirectory(), true, 'restore path is a directory: ' + directory)
  }
}

function removeIsolatedRootSafely() {
  assert.equal(path.resolve(isolatedRoot), path.resolve(createdIsolatedRoot),
    'cleanup target is exactly the directory returned by mkdtemp')
  const target = path.resolve(createdIsolatedRoot)
  const realTempDirectory = fs.realpathSync(os.tmpdir())
  const realParent = fs.realpathSync(path.dirname(target))
  assert.equal(path.relative(realTempDirectory, realParent), '',
    'cleanup target parent is the real system temp directory')
  const stat = fs.lstatSync(target)
  assert.equal(stat.isSymbolicLink(), false, 'cleanup target is not a symlink or junction')
  assert.equal(stat.isDirectory(), true, 'cleanup target remains a directory')
  const relativeTarget = path.relative(realTempDirectory, fs.realpathSync(target))
  assert(relativeTarget && !path.isAbsolute(relativeTarget)
    && !relativeTarget.startsWith('..' + path.sep)
    && path.basename(relativeTarget).startsWith(ISOLATED_ROOT_PREFIX),
  'cleanup target remains a direct child of the real os.tmpdir()')
  fs.rmSync(target, { recursive: true, force: false })
}

function hash(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase()
}

function sortJsonKeys(value) {
  if (Array.isArray(value)) return value.map(sortJsonKeys)
  if (!value || typeof value !== 'object') return value
  const sorted = Object.create(null)
  Object.keys(value).sort().forEach((key) => { sorted[key] = sortJsonKeys(value[key]) })
  return sorted
}

function reverseJsonKeys(value) {
  if (Array.isArray(value)) return value.map(reverseJsonKeys)
  if (!value || typeof value !== 'object') return value
  const reversed = Object.create(null)
  Object.keys(value).sort().reverse().forEach((key) => { reversed[key] = reverseJsonKeys(value[key]) })
  return reversed
}

function canonicalJsonHash(bytes) {
  return hash(Buffer.from(JSON.stringify(sortJsonKeys(JSON.parse(bytes.toString('utf8')))), 'utf8'))
}

function generatedPreviewConfigBytes(sourceBytes) {
  const config = JSON.parse(sourceBytes.toString('utf8'))
  config.projectname = 'TuneBuddy Control Protocol Development Preview'
  const existingIncludes = new Set(config.packOptions.include.map((entry) => entry.value))
  DRAFT_RESOURCES.forEach((value) => {
    if (!existingIncludes.has(value)) config.packOptions.include.push({ type: 'file', value })
  })
  const existingIgnores = new Set(config.packOptions.ignore.map((entry) => entry.value))
  ;[OWNER_MARKER, MANIFEST_NAME].forEach((value) => {
    if (!existingIgnores.has(value)) config.packOptions.ignore.push({ type: 'file', value })
  })
  return Buffer.from(JSON.stringify(config, null, 2) + '\n', 'utf8')
}

function makeLegacyManifestBytes(manifestBytes, sourceConfigBytes) {
  const manifest = JSON.parse(manifestBytes.toString('utf8'))
  delete manifest.manifestSchemaVersion
  const generatedConfigBytes = generatedPreviewConfigBytes(sourceConfigBytes)
  manifest.files.forEach((file) => {
    delete file.hashMode
    if (file.outputPath === 'project.config.json') {
      file.sourceSha256 = hash(sourceConfigBytes)
      file.outputSha256 = hash(generatedConfigBytes)
    }
  })
  return Buffer.from(JSON.stringify(manifest, null, 2) + '\n', 'utf8')
}

function readPreview(relativePath) {
  return fs.readFileSync(path.join(previewDirectory, ...relativePath.split('/')))
}

function outputHashes(manifest) {
  return manifest.files.map((file) => [file.outputPath, file.outputSha256])
}

function outputSnapshot() {
  return [
    MANIFEST_NAME,
    'project.config.json',
    'pages/control-protocol/runtime-catalog.js',
    'pages/control-protocol/development-sample.js',
    'pages/control-protocol/development-manual.js',
  ].map((relativePath) => [relativePath, readPreview(relativePath)])
}

function snapshotPreviewTree() {
  assertPreviewDirectoryBoundary()
  const directories = []
  const files = []
  function visit(absoluteDirectory, relativeDirectory) {
    const entries = fs.readdirSync(absoluteDirectory).sort()
    entries.forEach((name) => {
      const relativePath = relativeDirectory ? relativeDirectory + '/' + name : name
      const absolutePath = path.join(absoluteDirectory, name)
      const stat = fs.lstatSync(absolutePath)
      assert.equal(stat.isSymbolicLink(), false, 'preview snapshot refuses links: ' + relativePath)
      if (stat.isDirectory()) {
        directories.push(relativePath)
        visit(absolutePath, relativePath)
      } else {
        assert.equal(stat.isFile(), true, 'preview snapshot accepts regular files only: ' + relativePath)
        files.push({ path: relativePath, bytes: fs.readFileSync(absolutePath) })
      }
    })
  }
  const rootStat = fs.lstatSync(previewDirectory)
  assert.equal(rootStat.isSymbolicLink(), false, 'preview root must not be a symlink')
  assert.equal(rootStat.isDirectory(), true, 'preview root must exist before the round-trip test')
  visit(previewDirectory, '')
  return { directories, files }
}

function restorePreviewTree(snapshot) {
  assertPreviewDirectoryBoundary()
  const rootStat = fs.lstatSync(previewDirectory)
  assert.equal(rootStat.isSymbolicLink(), false, 'refusing to restore over a preview symlink')
  assert.equal(rootStat.isDirectory(), true, 'preview root must remain a directory for restoration')
  fs.rmSync(previewDirectory, { recursive: true, force: false })
  fs.mkdirSync(previewDirectory, { recursive: true })
  snapshot.directories.slice().sort((left, right) => left.split('/').length - right.split('/').length)
    .forEach((relativePath) => fs.mkdirSync(path.join(previewDirectory, ...relativePath.split('/')), { recursive: true }))
  snapshot.files.forEach((file) => {
    const absolutePath = path.join(previewDirectory, ...file.path.split('/'))
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true })
    fs.writeFileSync(absolutePath, file.bytes)
  })
}

function verifyInvalidIsolationRootsRejected() {
  assert.throws(() => buildPreview({ isolatedRoot: rootDirectory }), /isolatedRoot/,
    'builder rejects an existing project directory as an isolated output root')
  assert.throws(() => buildPreview({ isolatedRoot: path.dirname(isolatedRoot) }), /isolatedRoot/,
    'builder rejects os.tmpdir itself instead of accepting a non-mkdtemp root')
}

function assertPreviewTreeMatches(expected, actual) {
  assert.deepEqual(actual.directories, expected.directories, 'preview directories restore exactly')
  assert.equal(actual.files.length, expected.files.length, 'preview file count restores exactly')
  expected.files.forEach((file, index) => {
    assert.equal(actual.files[index].path, file.path, 'preview file path restores exactly')
    assert.deepEqual(actual.files[index].bytes, file.bytes, 'preview file bytes restore exactly: ' + file.path)
  })
}

function withReadFileOverride(targetPath, replacement, action) {
  const originalReadFileSync = fs.readFileSync
  const resolvedTarget = path.resolve(targetPath)
  fs.readFileSync = function (file, ...args) {
    if (typeof file === 'string' && path.resolve(file) === resolvedTarget) {
      return replacement(originalReadFileSync, file, args)
    }
    return originalReadFileSync.apply(this, [file, ...args])
  }
  try {
    action()
  } finally {
    fs.readFileSync = originalReadFileSync
  }
}

function verifyManifestRecords(manifest) {
  assert.equal(manifest.profile, 'development-preview')
  assert.equal(manifest.builderId, 'tunebuddy-control-protocol-development-preview-v1')
  assert.deepEqual(manifest.explicitPackIncludes, DRAFT_RESOURCES)
  assert.equal(manifest.files.length > 0, true)
  const seen = new Set()
  manifest.files.forEach((file) => {
    assert.equal(seen.has(file.outputPath), false, 'manifest output paths must be unique')
    seen.add(file.outputPath)
    const bytes = readPreview(file.outputPath)
    const outputHash = file.hashMode === 'canonical-json' ? canonicalJsonHash(bytes) : hash(bytes)
    assert.equal(outputHash, file.outputSha256, file.outputPath + ' output SHA-256')
    const sourcePath = path.join(rootDirectory, ...file.sourcePath.split('/'))
    const sourceBytes = fs.readFileSync(sourcePath)
    const sourceHash = file.hashMode === 'canonical-json' ? canonicalJsonHash(sourceBytes) : hash(sourceBytes)
    assert.equal(sourceHash, file.sourceSha256, file.sourcePath + ' source SHA-256')
  })
  const projectConfigRecord = manifest.files.find((file) => file.outputPath === 'project.config.json')
  assert.equal(projectConfigRecord.hashMode, 'canonical-json', 'only public project.config uses canonical JSON hashing')
  assert(manifest.files.filter((file) => file.outputPath !== 'project.config.json')
    .every((file) => file.hashMode === 'raw-bytes'), 'all other preview outputs use byte hashes')
}

function verifyBytePreservingCopies(manifest) {
  const transformedOutputs = new Set([
    'pages/control-protocol/runtime-catalog.js',
    'pages/control-protocol/development-sample.js',
    'project.config.json',
  ])
  manifest.files.forEach((file) => {
    if (transformedOutputs.has(file.outputPath)) return
    const sourceBytes = fs.readFileSync(path.join(rootDirectory, ...file.sourcePath.split('/')))
    assert.deepEqual(readPreview(file.outputPath), sourceBytes, file.outputPath + ' must mirror the current workspace bytes')
  })

  ;[
    ['development-manual.js', 'development-manual.js'],
    ['development-k100r-manual.js', 'development-k100r-manual.js'],
    ['draft-assets/smartplc-f300-sample.jpg', 'draft-assets/smartplc-f300-sample.jpg'],
    ['draft-assets/kylin-k100r-card-sample.jpg', 'draft-assets/kylin-k100r-card-sample.jpg'],
  ].forEach(([source, output]) => {
    assert.deepEqual(
      readPreview('pages/control-protocol/' + output),
      fs.readFileSync(path.join(manualFixtureRoot, ...source.split('/'))),
      source + ' must be byte-identical in the preview project',
    )
  })

  const sourceSample = fs.readFileSync(path.join(manualFixtureRoot, 'development-sample.js'), 'utf8')
  const previewSample = readPreview('pages/control-protocol/development-sample.js').toString('utf8')
  const sourcePrefix = '/tests/fixtures/control-protocol/draft-assets/'
  const previewPrefix = '/pages/control-protocol/draft-assets/'
  assert.equal(previewSample.split(previewPrefix).length - 1, 2, 'both staging photo paths are relocated')
  assert.equal(previewSample.split(previewPrefix).join(sourcePrefix), sourceSample,
    'the staged sample data changes only the two photo paths')
}

function verifyProjectConfig(manifest) {
  const previewConfig = JSON.parse(fs.readFileSync(previewConfigPath, 'utf8'))
  assert.equal(previewConfig.projectname, 'TuneBuddy Control Protocol Development Preview')
  assert.equal(previewConfig.appid, sourceConfig.appid, 'preview retains the source AppID')
  assert.equal(previewConfig.libVersion, sourceConfig.libVersion, 'preview retains the source base library version')
  assert.deepEqual(previewConfig.setting, sourceConfig.setting, 'preview retains compiler settings')
  DRAFT_RESOURCES.forEach((resource) => {
    assert(previewConfig.packOptions.include.some((entry) => entry.type === 'file' && entry.value === resource),
      resource + ' must be explicitly included in the preview package configuration')
  })
  assert(previewConfig.packOptions.ignore.some((entry) => entry.value === MANIFEST_NAME),
    'preview manifest must not be included in the mini-program package')
  assert(previewConfig.packOptions.ignore.some((entry) => entry.value === '.control-protocol-development-preview-owner.json'),
    'builder ownership marker must not be included in the mini-program package')
  assert.equal(manifest.appId, sourceConfig.appid)
  assert.equal(manifest.libVersion, sourceConfig.libVersion)
  assert.equal(evaluateDraftProtocolPackageGate([]).allowed, true,
    'the empty production package remains allowed by the existing release gate')
  const previewGate = evaluateDraftProtocolPackageGate(previewConfig.packOptions.include.map((entry) => entry.value))
  assert.equal(previewGate.allowed, false, 'the production gate must reject preview draft resources')
  assert.deepEqual(new Set(previewGate.resources), new Set(DRAFT_RESOURCES))
  assert(sourceConfig.packOptions.ignore.some((entry) => entry.type === 'folder' && entry.value === 'tests'),
    'the production project continues to ignore tests')
  assert.equal(sourceConfig.packOptions.include.some((entry) => /development-sample|draft-assets/.test(entry.value)), false,
    'the production project does not explicitly include preview resources')
}

function loadCatalog(runtimePath, envVersion) {
  const previousWx = global.wx
  global.wx = {
    getAccountInfoSync: () => ({ miniProgram: { envVersion } }),
  }
  try {
    const resolved = require.resolve(runtimePath)
    delete require.cache[resolved]
    return require(resolved).catalog
  } finally {
    if (previousWx === undefined) delete global.wx
    else global.wx = previousWx
  }
}

function capturePage(pageRelativePath, envVersion, wxApi) {
  const absolutePage = path.join(previewDirectory, ...pageRelativePath.split('/'))
  const runtimePath = path.join(manualOutputRoot, 'runtime-catalog.js')
  const previousPage = global.Page
  const previousWx = global.wx
  let definition = null
  global.Page = (value) => { definition = value }
  global.wx = { ...wxApi, getAccountInfoSync: () => ({ miniProgram: { envVersion } }) }
  try {
    delete require.cache[require.resolve(runtimePath)]
    delete require.cache[require.resolve(absolutePage)]
    require(absolutePage)
  } finally {
    if (previousPage === undefined) delete global.Page
    else global.Page = previousPage
    if (previousWx === undefined) delete global.wx
    else global.wx = previousWx
  }
  assert(definition, pageRelativePath + ' must register a real generated Page definition')
  return definition
}

function pageState(definition) {
  return {
    ...definition,
    data: { ...definition.data },
    setData(patch, callback) {
      this.data = { ...this.data, ...patch }
      if (callback) callback()
    },
  }
}

function createWxHarness(envVersion) {
  const effects = { clipboard: [], navigation: [], photoPreview: [], photoCopies: [], networkCalls: 0, storageCalls: 0, storage: {} }
  const api = {
    env: { USER_DATA_PATH: '/user-data' },
    getFileSystemManager: () => ({ copyFile: (options) => { effects.photoCopies.push(options); options.success() } }),
    getAccountInfoSync: () => ({ miniProgram: { envVersion } }),
    navigateTo: (options) => effects.navigation.push(options),
    redirectTo: (options) => effects.navigation.push(options),
    setClipboardData: (options) => { effects.clipboard.push(options.data); if (options.success) options.success() },
    previewImage: (options) => effects.photoPreview.push(options),
    showToast: () => {},
    request: () => { effects.networkCalls += 1; throw new Error('protocol preview must not send network requests') },
    connectSocket: () => { effects.networkCalls += 1; throw new Error('protocol preview must not connect to devices') },
    sendSocketMessage: () => { effects.networkCalls += 1; throw new Error('protocol preview must not send socket data') },
    getStorageSync: (key) => effects.storage[key],
    setStorageSync: (key, value) => { effects.storageCalls += 1; effects.storage[key] = value },
  }
  return { api, effects }
}

function verifyGeneratedRuntimeAndPages() {
  const previousWx = global.wx
  const previousPage = global.Page
  try {
  const rootRuntime = require(path.join(rootDirectory, 'pages', 'control-protocol', 'runtime-catalog.js'))
  const rootCatalog = require(path.join(rootDirectory, 'pages', 'control-protocol', 'catalog.js')).catalog
  assert.deepEqual(rootRuntime.catalog, rootCatalog, 'root runtime catalog uses the production catalog')
  ;['appearanceGroups', 'deviceVariants', 'photos', 'controllerVariants', 'sources', 'protocols']
    .forEach((key) => assert.deepEqual(rootRuntime.catalog[key], [], key + ' remains empty for automatic admission'))
  assert.deepEqual(rootRuntime.catalog.referenceManuals.map((reference) => reference.id), [
    'reference-smartplc-f300-01', 'reference-kylin-k100r-01',
  ], 'root formal catalog exposes exactly two separate manual references')

  const stagedRuntimePath = path.join(manualOutputRoot, 'runtime-catalog.js')
  const developmentCatalog = loadCatalog(stagedRuntimePath, 'develop')
  assert.equal(developmentCatalog.developmentDraftOnly, true)
  assert.deepEqual(
    developmentCatalog.appearanceGroups.map((group) => group.id),
    ['draft-smartplc-f300-sample', 'draft-kylin-k100r-sample'],
  )
  ;['trial', 'release', 'unknown'].forEach((envVersion) => {
    assert.deepEqual(loadCatalog(stagedRuntimePath, envVersion), rootRuntime.catalog,
      envVersion + ' must select the formal manual-reference catalog')
  })

  ;['trial', 'release', 'unknown'].forEach((envVersion) => {
    const harness = createWxHarness(envVersion)
    const formalIndexPage = capturePage('pages/control-protocol/index.js', envVersion, harness.api)
    const formalIndex = pageState(formalIndexPage)
    global.wx = harness.api
    formalIndexPage.onLoad.call(formalIndex)
    assert.equal(formalIndex.data.items, undefined, envVersion + ' keeps only the detail reader as the protocol page')
    assert.equal(harness.effects.navigation.at(-1).url, '/pages/control-protocol/detail',
      envVersion + ' restores the sole reader from the tool entry')
    formalIndexPage.onLoad.call(formalIndex, { referenceId: 'reference-kylin-k100r-01' })
    assert.match(harness.effects.navigation.at(-1).url, /referenceId=reference-kylin-k100r-01/,
      envVersion + ' preserves explicit legacy referenceId routes')

    ;[
      { id: 'reference-smartplc-f300-01', model: 'SmartPLC-F300', transport: 'rtu', frame: rootRuntime.catalog.referenceManuals[0].manual.transports[1].commands[0].frame },
      { id: 'reference-kylin-k100r-01', model: 'K100R', transport: 'rs485', frame: rootRuntime.catalog.referenceManuals[1].manual.transports[0].commands[0].frame },
    ].forEach((expected) => {
      const detailHarness = createWxHarness(envVersion)
      const detailPage = capturePage('pages/control-protocol/detail.js', envVersion, detailHarness.api)
      global.wx = detailHarness.api
      const detail = pageState(detailPage)
      detailPage.onLoad.call(detail, { referenceId: expected.id })
      assert.equal(detail.data.reference.id, expected.id, envVersion + ' resolves the explicit ' + expected.model + ' reference')
      assert.equal(detail.data.manual.transports.find((transport) => transport.id === expected.transport).commands.length,
        expected.transport === 'rtu' ? 84 : 18, envVersion + ' loads the reference command list')
      assert.equal(detail.data.protocol, null, envVersion + ' reference details do not enter strict protocol data')
      assert.equal(detail.data.developmentManual, undefined, 'the Page exposes neutral manual state')
      assert.equal(detail.data.photos.length, 1)
      const photoPath = detail.data.photos[0].path
      assert(photoPath.startsWith('/pages/control-protocol/assets/'), 'formal references use production photo paths')
      assert(fs.statSync(path.join(previewDirectory, ...photoPath.slice(1).split('/'))).size > 0,
        envVersion + ' formal reference photo resolves in the staged project')
      const transportIndex = expected.transport === 'rtu' ? '1' : '0'
      detailPage.selectManualTransport.call(detail, { currentTarget: { dataset: { index: transportIndex } } })
      const command = detail.data.commonManualCommands[0]
      detailPage.copyManualCommand.call(detail, { currentTarget: { dataset: { commandId: command.id } } })
      assert.deepEqual(detailHarness.effects.clipboard, [expected.frame], envVersion + ' copies a formal reference command')
      detailPage.previewPhoto.call(detail, { currentTarget: { dataset: { path: photoPath } } })
      assert.equal(detailHarness.effects.photoPreview.length, 1, envVersion + ' can preview the selected reference photo')
      assert.equal(detailHarness.effects.photoCopies[0].srcPath, photoPath.replace(/^\/+/, ''),
        envVersion + ' copies source bytes from the package asset')
      assert.equal(detailHarness.effects.photoPreview[0].current, detailHarness.effects.photoCopies[0].destPath,
        envVersion + ' previews the local original path')
      assert(detailHarness.effects.photoPreview[0].current.startsWith('/user-data/'))
      assert.notEqual(detailHarness.effects.photoPreview[0].current, photoPath)
      assert.equal(detailHarness.effects.networkCalls, 0)
      const persisted = JSON.stringify(detailHarness.effects.storage['controlProtocolViewerState.v1'])
      assert(!persisted.includes('deviceMac') && !persisted.includes('66 88 31 F3 7F 1C'),
        envVersion + ' persists reader state without MAC or sample address bytes')
    })
  })

  const galleryHarness = createWxHarness('develop')
  const galleryPage = capturePage('pages/control-protocol/index.js', 'develop', galleryHarness.api)
  global.wx = galleryHarness.api
  galleryPage.onLoad.call(pageState(galleryPage), { appearanceGroupId: 'draft-kylin-k100r-sample' })
  assert.match(galleryHarness.effects.navigation[0].url, /appearanceGroupId=draft-kylin-k100r-sample/,
    'development tool entry preserves explicit appearance-group links')
  assert.equal(galleryHarness.effects.networkCalls, 0)

  const f300Harness = createWxHarness('develop')
  const f300Page = capturePage('pages/control-protocol/detail.js', 'develop', f300Harness.api)
  global.wx = f300Harness.api
  const f300 = pageState(f300Page)
  f300Page.onLoad.call(f300, { appearanceGroupId: 'draft-smartplc-f300-sample' })
  assert.equal(f300.data.manual.transports[0].id, 'tcp')
  assert.equal(f300.data.manual.transports[0].commands.length, 84)
  assert.equal(f300.data.manual.transports[1].id, 'rtu')
  assert.equal(f300.data.manual.transports[1].commands.length, 84)
  assert.equal(f300.data.photos.length, 1)
  assert.equal(f300.data.photos[0].path, '/pages/control-protocol/draft-assets/smartplc-f300-sample.jpg')
  f300Page.selectManualTransport.call(f300, { currentTarget: { dataset: { index: '0' } } })
  const f300Command = f300.data.commonManualCommands[0]
  f300Page.copyManualCommand.call(f300, { currentTarget: { dataset: { commandId: f300Command.id } } })
  assert.deepEqual(f300Harness.effects.clipboard, [f300Command.frame], 'F300 command remains copy-only')
  assert.equal(f300Harness.effects.networkCalls, 0)
  assert(!JSON.stringify(f300Harness.effects.storage['controlProtocolViewerState.v1']).includes('deviceMac'),
    'F300 reader state stores no MAC field')

  const k100rHarness = createWxHarness('develop')
  const k100rPage = capturePage('pages/control-protocol/detail.js', 'develop', k100rHarness.api)
  global.wx = k100rHarness.api
  const k100r = pageState(k100rPage)
  k100rPage.onLoad.call(k100r, { appearanceGroupId: 'draft-kylin-k100r-sample' })
  assert.equal(k100r.data.manual.transports[0].id, 'rs485')
  assert.equal(k100r.data.manual.transports[0].commands.length, 18)
  assert.equal(k100r.data.manual.transports[1].id, 'udp')
  assert.equal(k100r.data.manual.transports[1].commands.length, 18)
  assert.equal(k100r.data.photos[0].path, '/pages/control-protocol/draft-assets/kylin-k100r-card-sample.jpg')
  k100rPage.selectManualTransport.call(k100r, { currentTarget: { dataset: { index: '1' } } })
  const udpCommandId = 'udp-relay-01-close'
  const copyCountBeforeBlockedAttempts = k100rHarness.effects.clipboard.length
  k100rPage.copyManualCommand.call(k100r, { currentTarget: { dataset: { commandId: udpCommandId } } })
  assert.equal(k100rHarness.effects.clipboard.length, copyCountBeforeBlockedAttempts, 'empty MAC blocks UDP copy')
  k100rPage.onDeviceMacInput.call(k100r, { detail: { value: 'GG1122334455' } })
  assert.equal(k100r.data.deviceMacValid, false)
  k100rPage.copyManualCommand.call(k100r, { currentTarget: { dataset: { commandId: udpCommandId } } })
  assert.equal(k100rHarness.effects.clipboard.length, copyCountBeforeBlockedAttempts, 'invalid MAC blocks UDP copy')
  k100rPage.onDeviceMacInput.call(k100r, { detail: { value: 'A1B2C3D4E5F6' } })
  assert.equal(k100r.data.deviceMacValid, true)
  const selectedUdpCommand = k100r.data.selectedLoopCommands.find((command) => command.id === udpCommandId)
  assert(selectedUdpCommand)
  assert.equal(selectedUdpCommand.displayFrame, '43 53 52 59 A1 B2 C3 D4 E5 F6 31',
    'valid MAC replaces exactly the six example address bytes')
  k100rPage.copyManualCommand.call(k100r, { currentTarget: { dataset: { commandId: udpCommandId } } })
  assert.equal(k100rHarness.effects.clipboard.at(-1), '43 53 52 59 A1 B2 C3 D4 E5 F6 31')
  k100rPage.clearDeviceMac.call(k100r)
  assert.equal(k100r.data.deviceMacInput, '')
  assert.equal(k100r.data.deviceMacValid, false)
  k100rPage.copyManualCommand.call(k100r, { currentTarget: { dataset: { commandId: udpCommandId } } })
  assert.equal(k100rHarness.effects.clipboard.length, copyCountBeforeBlockedAttempts + 1,
    'cleared MAC blocks any further UDP copy')
  assert.equal(k100rHarness.effects.networkCalls, 0)
  const savedK100R = JSON.stringify(k100rHarness.effects.storage['controlProtocolViewerState.v1'])
  assert(!savedK100R.includes('deviceMac') && !savedK100R.includes('A1B2C3D4E5F6'),
    'K100R reader state stores no MAC field or address')
  } finally {
    if (previousWx === undefined) delete global.wx
    else global.wx = previousWx
    if (previousPage === undefined) delete global.Page
    else global.Page = previousPage
  }
}

function runPreviewChecks(originalSnapshot) {
  const manifestPath = path.join(previewDirectory, MANIFEST_NAME)
  const privateConfigPath = path.join(previewDirectory, PRIVATE_CONFIG_NAME)
  const snapshotManifestBytes = originalSnapshot.files.find((file) => file.path === MANIFEST_NAME).bytes
  const originalConfigBytes = originalSnapshot.files.find((file) => file.path === 'project.config.json').bytes
  const startingManifest = JSON.parse(snapshotManifestBytes.toString('utf8'))
  assert(startingManifest.files.length > 0, 'the captured preview manifest contains tracked files')
  const sourceConfigBytes = fs.readFileSync(path.join(rootDirectory, 'project.config.json'))
  const expectedLegacyConfigBytes = generatedPreviewConfigBytes(sourceConfigBytes)
  assert.equal(canonicalJsonHash(originalConfigBytes), canonicalJsonHash(expectedLegacyConfigBytes),
    'the captured preview config is semantically equal to the generated config')
  const syntheticLegacyManifestBytes = makeLegacyManifestBytes(snapshotManifestBytes, sourceConfigBytes)
  const originalManifest = JSON.parse(syntheticLegacyManifestBytes.toString('utf8'))
  assert.equal(originalManifest.manifestSchemaVersion, undefined,
    'the test creates a legacy manifest from the generated preview for migration coverage')
  assert.equal(originalManifest.files.length, startingManifest.files.length,
    'legacy migration retains the captured preview file count')
  const legacyConfigRecord = originalManifest.files.find((file) => file.outputPath === 'project.config.json')
  assert(legacyConfigRecord)
  assert.equal(legacyConfigRecord.sourceSha256, hash(sourceConfigBytes),
    'legacy migration fixture uses the current formal source config hash')
  fs.writeFileSync(manifestPath, syntheticLegacyManifestBytes)

  function rejectLegacyChange(changeManifest, changeConfig) {
    fs.writeFileSync(manifestPath, changeManifest(originalManifest))
    if (changeConfig) fs.writeFileSync(previewConfigPath, changeConfig(originalConfigBytes))
    const beforeConfig = fs.readFileSync(previewConfigPath)
    try {
      assert.throws(() => buildIsolatedPreview(), /legacy output/,
        'legacy output must be rejected when a required compatibility check fails')
      assert.deepEqual(fs.readFileSync(previewConfigPath), beforeConfig,
        'a rejected legacy migration preserves its public config')
    } finally {
      fs.writeFileSync(manifestPath, syntheticLegacyManifestBytes)
      fs.writeFileSync(previewConfigPath, originalConfigBytes)
    }
  }

  rejectLegacyChange((manifest) => {
    const changed = JSON.parse(JSON.stringify(manifest))
    changed.files.find((file) => file.outputPath === 'project.config.json').sourceSha256 = '0'.repeat(64)
    return JSON.stringify(changed, null, 2) + '\n'
  })
  rejectLegacyChange((manifest) => {
    const changed = JSON.parse(JSON.stringify(manifest))
    changed.files.find((file) => file.outputPath === 'project.config.json').outputSha256 = '0'.repeat(64)
    return JSON.stringify(changed, null, 2) + '\n'
  })
  rejectLegacyChange((manifest) => JSON.stringify(manifest, null, 2) + '\n', (bytes) => {
    const changed = JSON.parse(bytes.toString('utf8'))
    changed.appid = 'wx0000000000000000'
    return Buffer.from(JSON.stringify(changed, null, 2) + '\n', 'utf8')
  })

  const legacyReorderedConfig = Buffer.from(
    JSON.stringify(reverseJsonKeys(JSON.parse(originalConfigBytes.toString('utf8'))), null, 2) + '\n',
    'utf8',
  )
  assert.notDeepEqual(legacyReorderedConfig, originalConfigBytes, 'legacy compatibility exercises changed JSON key order')
  assert.equal(canonicalJsonHash(legacyReorderedConfig), canonicalJsonHash(originalConfigBytes),
    'recursive key ordering retains project config semantics')
  fs.writeFileSync(previewConfigPath, legacyReorderedConfig)

  const privateBeforeBuild = originalSnapshot.files.find((file) => file.path === PRIVATE_CONFIG_NAME)?.bytes ?? null
  assert.deepEqual(privateBeforeBuild, syntheticPrivateConfigBytes,
    'the isolated test starts with its fixed synthetic private config')
  const firstBuild = buildIsolatedPreview()
  assert.equal(firstBuild.manifest.manifestSchemaVersion, 2)
  verifyManifestRecords(firstBuild.manifest)
  verifyBytePreservingCopies(firstBuild.manifest)
  verifyProjectConfig(firstBuild.manifest)

  const firstGeneratedConfig = fs.readFileSync(previewConfigPath)
  const legalReorder = Buffer.from(
    JSON.stringify(reverseJsonKeys(JSON.parse(firstGeneratedConfig.toString('utf8'))), null, 2) + '\n',
    'utf8',
  )
  assert.notDeepEqual(legalReorder, firstGeneratedConfig, 'v2 compatibility exercises changed JSON key order')
  assert.equal(canonicalJsonHash(legalReorder), canonicalJsonHash(firstGeneratedConfig))
  fs.writeFileSync(previewConfigPath, legalReorder)
  const reorderedBuild = buildIsolatedPreview()
  assert.equal(reorderedBuild.manifest.manifestSchemaVersion, 2,
    'a semantically equivalent IDE-reordered config remains rebuildable')
  verifyManifestRecords(reorderedBuild.manifest)

  const expectedConfigBytes = fs.readFileSync(previewConfigPath)
  const semanticChanges = [
    ['AppID', (config) => { config.appid = 'wx0000000000000000' }],
    ['pack include', (config) => { config.packOptions.include.push({ type: 'file', value: 'pages/unapproved.js' }) }],
    ['compiler settings', (config) => { config.setting.es6 = !config.setting.es6 }],
    ['unknown field', (config) => { config.unknownPreviewMutation = { value: true } }],
  ]
  semanticChanges.forEach(([label, change]) => {
    const changedConfig = JSON.parse(expectedConfigBytes.toString('utf8'))
    change(changedConfig)
    fs.writeFileSync(previewConfigPath, JSON.stringify(changedConfig, null, 2) + '\n', 'utf8')
    const beforeRejectedBuild = outputSnapshot()
    try {
      assert.throws(() => buildIsolatedPreview(), /semantically changed project.config.json/,
        'v2 output rejects a semantic ' + label + ' change')
      assert.deepEqual(outputSnapshot(), beforeRejectedBuild,
        'semantic ' + label + ' change does not rewrite the existing preview')
    } finally {
      fs.writeFileSync(previewConfigPath, expectedConfigBytes)
    }
  })

  const updatedSourceConfig = JSON.parse(sourceConfigBytes.toString('utf8'))
  updatedSourceConfig.setting.es6 = !updatedSourceConfig.setting.es6
  const updatedSourceConfigBytes = Buffer.from(JSON.stringify(updatedSourceConfig, null, 2) + '\n', 'utf8')
  const sourceConfigPath = path.join(rootDirectory, 'project.config.json')
  let updatedSourceBuild
  withReadFileOverride(sourceConfigPath, () => updatedSourceConfigBytes, () => {
    updatedSourceBuild = buildIsolatedPreview()
  })
  assert.equal(updatedSourceBuild.manifest.files.find((file) => file.outputPath === 'project.config.json').sourceSha256,
    canonicalJsonHash(updatedSourceConfigBytes), 'new formal source config changes are captured in the v2 manifest')
  assert.equal(JSON.parse(fs.readFileSync(previewConfigPath, 'utf8')).setting.es6, updatedSourceConfig.setting.es6,
    'a valid formal source config update is reflected in the rebuilt preview')
  const firstHashesBuild = buildIsolatedPreview()
  verifyManifestRecords(firstHashesBuild.manifest)
  verifyBytePreservingCopies(firstHashesBuild.manifest)
  verifyProjectConfig(firstHashesBuild.manifest)
  const firstHashes = outputHashes(firstHashesBuild.manifest)

  const privateBytes = privateBeforeBuild
  const unexpectedFile = path.join(firstBuild.outputDirectory, '.unexpected-builder-safety-probe')
  try {
    const privateBuild = buildIsolatedPreview()
    assert.deepEqual(fs.readFileSync(privateConfigPath), privateBytes,
      'IDE-created project.private.config.json bytes survive a rebuild')
    assert.deepEqual(outputHashes(privateBuild.manifest), firstHashes,
      'preserving private IDE settings does not change generated source bytes')

    const beforePreflightFailures = outputSnapshot()
    const missingFixturePath = path.join(__dirname, 'fixtures', 'control-protocol', 'draft-assets', 'kylin-k100r-card-sample.jpg')
    withReadFileOverride(missingFixturePath, () => {
      const error = new Error('simulated missing preview fixture')
      error.code = 'ENOENT'
      throw error
    }, () => assert.throws(() => buildIsolatedPreview(), /simulated missing preview fixture/))
    assert.deepEqual(outputSnapshot(), beforePreflightFailures,
      'missing fixture preflight leaves the prior preview intact')

    const sampleFixturePath = path.join(__dirname, 'fixtures', 'control-protocol', 'development-sample.js')
    withReadFileOverride(sampleFixturePath, (readFileSync, file, args) => {
      const bytes = readFileSync.apply(fs, [file, ...args])
      const badSample = bytes.toString('utf8').replace(
        '/tests/fixtures/control-protocol/draft-assets/',
        '/invalid-preview-fixtures/',
      )
      return Buffer.from(badSample, 'utf8')
    }, () => assert.throws(() => buildIsolatedPreview(), /Expected exactly two fixture photo paths/))
    assert.deepEqual(outputSnapshot(), beforePreflightFailures,
      'invalid photo path preflight leaves the prior preview intact')

    fs.writeFileSync(unexpectedFile, 'test-owned unexpected content')
    try {
      assert.throws(() => buildIsolatedPreview(), /unknown files/,
        'builder must refuse to clean an output directory containing unowned files')
      assert.equal(fs.existsSync(unexpectedFile), true, 'refused cleanup must preserve unknown content')
      assert.deepEqual(outputSnapshot(), beforePreflightFailures,
        'unknown output content does not change the existing preview')
    } finally {
      if (fs.existsSync(unexpectedFile)) fs.unlinkSync(unexpectedFile)
    }

    const finalBuild = buildIsolatedPreview()
    assert.deepEqual(outputHashes(finalBuild.manifest), firstHashes,
      'repeated builds from the same workspace have identical tracked output bytes')
    assert.deepEqual(fs.readFileSync(privateConfigPath), privateBeforeBuild,
      'synthetic IDE project settings remain byte-identical after repeated builds')
    verifyGeneratedRuntimeAndPages()

    console.log('Control protocol development preview integration PASS')
    console.log('Profile: ' + finalBuild.manifest.profile)
    console.log('Files mirrored/tracked: ' + finalBuild.manifest.files.length)
    console.log('Config compatibility: legacy and IDE key reorder accepted; semantic edits rejected')
    console.log('Development records: F300 168 commands; K100R 36 commands; trial/release/unknown use two formal references')
  } finally {
    if (fs.existsSync(unexpectedFile)) fs.unlinkSync(unexpectedFile)
  }
}

function main() {
  initializeIsolatedPreview()
  console.log('Isolated temporary root: ' + createdIsolatedRoot)
  try {
    verifyInvalidIsolationRootsRejected()
    buildIsolatedPreview()
    fs.writeFileSync(path.join(previewDirectory, PRIVATE_CONFIG_NAME), syntheticPrivateConfigBytes, { flag: 'wx' })
    const originalSnapshot = snapshotPreviewTree()
    assert.deepEqual(
      originalSnapshot.files.find((file) => file.path === PRIVATE_CONFIG_NAME).bytes,
      syntheticPrivateConfigBytes,
      'only fixed synthetic private settings enter the isolated preview snapshot',
    )
    const startingManifest = JSON.parse(
      originalSnapshot.files.find((file) => file.path === MANIFEST_NAME).bytes.toString('utf8'),
    )
    const startingFileCount = startingManifest.files.length
    try {
      runPreviewChecks(originalSnapshot)
    } finally {
      restorePreviewTree(originalSnapshot)
      const restoredSnapshot = snapshotPreviewTree()
      assertPreviewTreeMatches(originalSnapshot, restoredSnapshot)
      const restoredManifestBytes = restoredSnapshot.files.find((file) => file.path === MANIFEST_NAME).bytes
      const restoredManifest = JSON.parse(restoredManifestBytes.toString('utf8'))
      assert.equal(restoredManifest.files.length, startingFileCount,
        'restored preview manifest retains the captured file count')
      console.log('Captured isolated preview restored byte-for-byte: ' + restoredManifest.files.length + ' manifest records')
    }
  } finally {
    removeIsolatedRootSafely()
  }
}

main()
