'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const BUILDER_ID = 'tunebuddy-control-protocol-development-preview-v1'
const OWNER_MARKER = '.control-protocol-development-preview-owner.json'
const MANIFEST_NAME = 'development-preview-manifest.json'
const PRIVATE_CONFIG_NAME = 'project.private.config.json'
const ISOLATED_ROOT_PREFIX = 'tunebuddy-preview-isolated-'
const PREVIEW_RELATIVE = 'docs/preview/control-protocol-development'
const PROJECT_NAME = 'TuneBuddy Control Protocol Development Preview'
const FIXTURE_ROOT = 'tests/fixtures/control-protocol'
const DRAFT_ROOT = 'pages/control-protocol'
const DRAFT_ASSET_ROOT = DRAFT_ROOT + '/draft-assets'
const DRAFT_RESOURCES = [
  DRAFT_ROOT + '/development-sample.js',
  DRAFT_ROOT + '/development-manual.js',
  DRAFT_ROOT + '/development-k100r-manual.js',
  DRAFT_ASSET_ROOT + '/smartplc-f300-sample.jpg',
  DRAFT_ASSET_ROOT + '/kylin-k100r-card-sample.jpg',
]
const ROOT_FILES = [
  'app.js',
  'app.json',
  'app.wxss',
  'theme.json',
  'sitemap.json',
  'project.config.json',
]
const SOURCE_DIRECTORIES = ['assets', 'data', 'pages', 'styles', 'templates', 'utils']
const rootDirectory = path.resolve(__dirname, '..')
const defaultOutputDirectory = path.resolve(rootDirectory, ...PREVIEW_RELATIVE.split('/'))
const markerContents = JSON.stringify({
  builderId: BUILDER_ID,
  profile: 'development-preview',
  output: PREVIEW_RELATIVE,
}, null, 2) + '\n'
const generatedRuntimeSource = [
  '// Generated only in the isolated development-preview project.',
  "const { CATEGORIES, catalog: formalCatalog } = require('./catalog')",
  "const { developmentSampleCatalog } = require('./development-sample')",
  '',
  'function selectedCatalog() {',
  '  try {',
  "    if (wx.getAccountInfoSync().miniProgram.envVersion === 'develop') return developmentSampleCatalog",
  '  } catch (error) {',
  '    // Missing environment information remains on the formal reference catalog.',
  '  }',
  '  return formalCatalog',
  '}',
  '',
  'module.exports = { CATEGORIES, catalog: selectedCatalog() }',
  '',
].join('\n')

function fail(message) {
  throw new Error(message)
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex').toUpperCase()
}

function sortJsonKeys(value) {
  if (Array.isArray(value)) return value.map(sortJsonKeys)
  if (!value || typeof value !== 'object') return value
  const sorted = Object.create(null)
  Object.keys(value).sort().forEach((key) => { sorted[key] = sortJsonKeys(value[key]) })
  return sorted
}

function canonicalJsonBytes(bytes) {
  return Buffer.from(JSON.stringify(sortJsonKeys(JSON.parse(bytes.toString('utf8')))), 'utf8')
}

function canonicalJsonSha256(bytes) {
  return sha256(canonicalJsonBytes(bytes))
}

function toPosix(value) {
  return String(value).replace(/\\/g, '/')
}

function safeRelativePath(value, label) {
  const normalized = toPosix(value)
  const parts = normalized.split('/')
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)
    || parts.some((part) => !part || part === '.' || part === '..' || part.includes(':'))
    || normalized.includes('\0')) {
    fail('Unsafe relative path for ' + label + ': ' + value)
  }
  return parts.join('/')
}

function resolveInside(base, relative, label) {
  const normalized = safeRelativePath(relative, label)
  const resolved = path.resolve(base, ...normalized.split('/'))
  const relativeResult = path.relative(base, resolved)
  if (!relativeResult || relativeResult === '..'
    || relativeResult.startsWith('..' + path.sep) || path.isAbsolute(relativeResult)) {
    fail('Path escaped its fixed root for ' + label + ': ' + relative)
  }
  return resolved
}

function statIfExists(target) {
  try {
    return fs.lstatSync(target)
  } catch (error) {
    if (error && error.code === 'ENOENT') return null
    throw error
  }
}

function ensureSafeOutputParents(outputDirectory, outputRoot) {
  const docsDirectory = path.join(outputRoot, 'docs')
  const previewParent = path.join(docsDirectory, 'preview')
  for (const directory of [docsDirectory, previewParent]) {
    const stat = statIfExists(directory)
    if (stat) {
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        fail('Refusing preview output under a symlink or non-directory: ' + directory)
      }
    } else {
      fs.mkdirSync(directory)
    }
  }
  const outputStat = statIfExists(outputDirectory)
  if (outputStat && (outputStat.isSymbolicLink() || !outputStat.isDirectory())) {
    fail('Refusing a symlink, junction, or non-directory output target: ' + outputDirectory)
  }
}

function samePath(left, right) {
  return path.relative(path.resolve(left), path.resolve(right)) === ''
    && path.relative(path.resolve(right), path.resolve(left)) === ''
}

function validateIsolatedRoot(isolatedRoot) {
  if (typeof isolatedRoot !== 'string' || !isolatedRoot) {
    fail('isolatedRoot must be an existing mkdtemp directory directly under os.tmpdir()')
  }
  const absoluteRoot = path.resolve(isolatedRoot)
  if (!path.basename(absoluteRoot).startsWith(ISOLATED_ROOT_PREFIX)) {
    fail('isolatedRoot must use the approved os.tmpdir() mkdtemp prefix')
  }
  const rootStat = statIfExists(absoluteRoot)
  if (!rootStat || rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    fail('isolatedRoot must be an existing non-symlink directory')
  }
  const realTempDirectory = fs.realpathSync(os.tmpdir())
  const realParent = fs.realpathSync(path.dirname(absoluteRoot))
  const realRoot = fs.realpathSync(absoluteRoot)
  if (!samePath(realParent, realTempDirectory) || !samePath(path.dirname(realRoot), realTempDirectory)
    || !path.basename(realRoot).startsWith(ISOLATED_ROOT_PREFIX)) {
    fail('isolatedRoot must be a direct child of the real os.tmpdir()')
  }
  return realRoot
}

function ensureOutputParentDirectories(outputDirectory, relativeOutput) {
  const normalized = safeRelativePath(relativeOutput, 'output file')
  const parts = normalized.split('/')
  parts.pop()
  let current = outputDirectory
  for (const part of parts) {
    current = path.join(current, part)
    const stat = statIfExists(current)
    if (stat) {
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        fail('Refusing output under a symlink, junction, or non-directory parent: ' + current)
      }
    } else {
      fs.mkdirSync(current)
    }
  }
}

function isIgnoredByPackOptions(relativePath, ignoreRules) {
  const normalized = safeRelativePath(relativePath, 'packOptions path')
  for (const rule of ignoreRules) {
    const ignoredPath = safeRelativePath(rule.value, 'packOptions.ignore')
    if (rule.type === 'file' && normalized === ignoredPath) return true
    if (rule.type === 'folder'
      && (normalized === ignoredPath || normalized.startsWith(ignoredPath + '/'))) return true
  }
  return false
}

function collectFiles(directoryRelative, ignoreRules) {
  const absoluteRoot = resolveInside(rootDirectory, directoryRelative, 'source directory')
  const rootStat = fs.lstatSync(absoluteRoot)
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    fail('Expected a regular source directory: ' + directoryRelative)
  }
  const files = []
  function visit(absoluteDirectory, relativeDirectory) {
    const entries = fs.readdirSync(absoluteDirectory, { withFileTypes: true })
      .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)
    for (const entry of entries) {
      const relative = relativeDirectory + '/' + entry.name
      if (isIgnoredByPackOptions(relative, ignoreRules)) continue
      const absolute = path.join(absoluteDirectory, entry.name)
      const stat = fs.lstatSync(absolute)
      if (stat.isSymbolicLink()) fail('Refusing source symlink: ' + relative)
      if (stat.isDirectory()) visit(absolute, relative)
      else if (stat.isFile()) files.push(relative)
      else fail('Unsupported source entry: ' + relative)
    }
  }
  visit(absoluteRoot, directoryRelative)
  return files
}

function makeDevelopmentProjectConfig(sourceBytes) {
  const config = JSON.parse(sourceBytes.toString('utf8'))
  if (!config.packOptions || !Array.isArray(config.packOptions.include)
    || !Array.isArray(config.packOptions.ignore)) {
    fail('project.config.json packOptions must define include and ignore arrays')
  }
  config.projectname = PROJECT_NAME
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

function generatedSampleBytes(sourceBytes) {
  const source = sourceBytes.toString('utf8')
  const oldPrefix = '/tests/fixtures/control-protocol/draft-assets/'
  const newPrefix = '/' + DRAFT_ASSET_ROOT + '/'
  const occurrences = source.split(oldPrefix).length - 1
  if (occurrences !== 2) {
    fail('Expected exactly two fixture photo paths, found ' + occurrences)
  }
  return Buffer.from(source.split(oldPrefix).join(newPrefix), 'utf8')
}

function createOutputFile(outputDirectory, relativeOutput, bytes) {
  const target = resolveInside(outputDirectory, relativeOutput, 'output file')
  ensureOutputParentDirectories(outputDirectory, relativeOutput)
  fs.writeFileSync(target, bytes)
}

function readSourceBytes(relativeSource) {
  return fs.readFileSync(resolveInside(rootDirectory, relativeSource, 'source file'))
}

function prepareFiles() {
  const sourceProjectConfig = readSourceBytes('project.config.json')
  const projectConfig = JSON.parse(sourceProjectConfig.toString('utf8'))
  const ignoreRules = projectConfig.packOptions && projectConfig.packOptions.ignore
  if (!Array.isArray(ignoreRules)) fail('project.config.json has no packOptions.ignore array')

  const allowlistedSources = ROOT_FILES.slice()
  SOURCE_DIRECTORIES.forEach((directory) => {
    allowlistedSources.push.apply(allowlistedSources, collectFiles(directory, ignoreRules))
  })
  allowlistedSources.sort()

  const prepared = []
  let projectConfigOutputBytes = null
  for (const relativeSource of allowlistedSources) {
    const sourceBytes = relativeSource === 'project.config.json'
      ? sourceProjectConfig
      : readSourceBytes(relativeSource)
    let outputBytes = sourceBytes
    if (relativeSource === 'project.config.json') outputBytes = makeDevelopmentProjectConfig(sourceBytes)
    else if (relativeSource === 'pages/control-protocol/runtime-catalog.js') {
      outputBytes = Buffer.from(generatedRuntimeSource, 'utf8')
    }
    const hashMode = relativeSource === 'project.config.json' ? 'canonical-json' : 'raw-bytes'
    if (relativeSource === 'project.config.json') projectConfigOutputBytes = outputBytes
    prepared.push({
      record: {
        sourcePath: relativeSource,
        outputPath: relativeSource,
        hashMode,
        sourceSha256: hashMode === 'canonical-json' ? canonicalJsonSha256(sourceBytes) : sha256(sourceBytes),
        outputSha256: hashMode === 'canonical-json' ? canonicalJsonSha256(outputBytes) : sha256(outputBytes),
      },
      outputBytes,
    })
  }

  const fixtureMap = [
    {
      sourcePath: FIXTURE_ROOT + '/development-sample.js',
      outputPath: DRAFT_ROOT + '/development-sample.js',
      transform: generatedSampleBytes,
    },
    {
      sourcePath: FIXTURE_ROOT + '/development-manual.js',
      outputPath: DRAFT_ROOT + '/development-manual.js',
    },
    {
      sourcePath: FIXTURE_ROOT + '/development-k100r-manual.js',
      outputPath: DRAFT_ROOT + '/development-k100r-manual.js',
    },
    {
      sourcePath: FIXTURE_ROOT + '/draft-assets/smartplc-f300-sample.jpg',
      outputPath: DRAFT_ASSET_ROOT + '/smartplc-f300-sample.jpg',
    },
    {
      sourcePath: FIXTURE_ROOT + '/draft-assets/kylin-k100r-card-sample.jpg',
      outputPath: DRAFT_ASSET_ROOT + '/kylin-k100r-card-sample.jpg',
    },
  ]
  for (const file of fixtureMap) {
    const sourceBytes = readSourceBytes(file.sourcePath)
    const outputBytes = file.transform ? file.transform(sourceBytes) : sourceBytes
    prepared.push({
      record: {
        sourcePath: file.sourcePath,
        outputPath: file.outputPath,
        hashMode: 'raw-bytes',
        sourceSha256: sha256(sourceBytes),
        outputSha256: sha256(outputBytes),
      },
      outputBytes,
    })
  }

  prepared.sort((left, right) => left.record.outputPath < right.record.outputPath
    ? -1 : left.record.outputPath > right.record.outputPath ? 1 : 0)
  if (!projectConfigOutputBytes) fail('project.config.json was not prepared')
  return {
    prepared,
    sourceProjectConfig: JSON.parse(sourceProjectConfig.toString('utf8')),
    sourceProjectConfigBytes: sourceProjectConfig,
    projectConfigOutputBytes,
  }
}

function expectedTree(records) {
  const files = new Set([OWNER_MARKER, MANIFEST_NAME])
  const directories = new Set([''])
  for (const record of records) {
    const relative = safeRelativePath(record.outputPath, 'manifest output')
    files.add(relative)
    const parts = relative.split('/')
    parts.pop()
    let current = ''
    for (const part of parts) {
      current = current ? current + '/' + part : part
      directories.add(current)
    }
  }
  return { files, directories }
}

function inspectExistingOutput(preflight, outputDirectory) {
  const outputStat = statIfExists(outputDirectory)
  if (!outputStat) return { exists: false, privateConfigBytes: null }
  if (outputStat.isSymbolicLink() || !outputStat.isDirectory()) {
    fail('Refusing to clean a symlink, junction, or non-directory output target')
  }
  const markerPath = path.join(outputDirectory, OWNER_MARKER)
  const manifestPath = path.join(outputDirectory, MANIFEST_NAME)
  const markerStat = statIfExists(markerPath)
  const manifestStat = statIfExists(manifestPath)
  if (!markerStat || markerStat.isSymbolicLink() || !markerStat.isFile()
    || !manifestStat || manifestStat.isSymbolicLink() || !manifestStat.isFile()) {
    fail('Refusing to clean output without the matching builder marker and manifest')
  }
  let marker
  let manifest
  try {
    marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'))
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  } catch (error) {
    fail('Refusing to clean output with an unreadable builder marker or manifest: ' + error.message)
  }
  if (JSON.stringify(marker) !== JSON.stringify(JSON.parse(markerContents))
    || !manifest || manifest.builderId !== BUILDER_ID
    || manifest.profile !== 'development-preview'
    || (manifest.manifestSchemaVersion !== undefined && manifest.manifestSchemaVersion !== 2)
    || !Array.isArray(manifest.files) || manifest.files.length === 0) {
    fail('Refusing to clean output with an unknown builder marker or manifest')
  }

  const privateConfigPath = path.join(outputDirectory, PRIVATE_CONFIG_NAME)
  const privateConfigStat = statIfExists(privateConfigPath)
  if (privateConfigStat && (privateConfigStat.isSymbolicLink() || !privateConfigStat.isFile())) {
    fail('Refusing to preserve a symlink or non-file project.private.config.json')
  }
  const privateConfigBytes = privateConfigStat ? fs.readFileSync(privateConfigPath) : null
  const tree = expectedTree(manifest.files)
  const actualFiles = new Set()
  const actualDirectories = new Set([''])
  function inspectDirectory(absoluteDirectory, relativeDirectory) {
    const entries = fs.readdirSync(absoluteDirectory, { withFileTypes: true })
    for (const entry of entries) {
      const relative = relativeDirectory ? relativeDirectory + '/' + entry.name : entry.name
      const absolute = path.join(absoluteDirectory, entry.name)
      const stat = fs.lstatSync(absolute)
      if (stat.isSymbolicLink()) fail('Refusing to clean output containing a symlink: ' + relative)
      if (stat.isDirectory()) {
        actualDirectories.add(relative)
        inspectDirectory(absolute, relative)
      } else if (stat.isFile()) actualFiles.add(relative)
      else fail('Refusing to clean output containing an unsupported entry: ' + relative)
    }
  }
  inspectDirectory(outputDirectory, '')
  const requiredFilesPresent = [...tree.files].every((relative) => actualFiles.has(relative))
  const allowedActualFiles = new Set(tree.files)
  if (privateConfigBytes !== null) allowedActualFiles.add(PRIVATE_CONFIG_NAME)
  if (!requiredFilesPresent || [...actualFiles].some((relative) => !allowedActualFiles.has(relative))) {
    fail('Refusing to clean output containing missing or unknown files')
  }
  if (actualDirectories.size !== tree.directories.size
    || [...actualDirectories].some((relative) => !tree.directories.has(relative))) {
    fail('Refusing to clean output containing missing or unknown directories')
  }
  const projectConfigRecords = manifest.files.filter((record) => record.outputPath === 'project.config.json')
  if (projectConfigRecords.length !== 1) fail('Refusing to clean output without one project.config.json manifest record')
  const projectConfigRecord = projectConfigRecords[0]
  const expectedConfigSha = canonicalJsonSha256(preflight.projectConfigOutputBytes)
  const actualConfigBytes = fs.readFileSync(path.join(outputDirectory, 'project.config.json'))
  if (manifest.manifestSchemaVersion === 2) {
    if (projectConfigRecord.hashMode !== 'canonical-json'
      || canonicalJsonSha256(actualConfigBytes) !== projectConfigRecord.outputSha256) {
      fail('Refusing to clean output with a semantically changed project.config.json')
    }
  } else {
    const hasLegacyConfigHashes = manifest.manifestSchemaVersion === undefined
      && projectConfigRecord.hashMode === undefined
      && projectConfigRecord.sourceSha256 === sha256(preflight.sourceProjectConfigBytes)
      && projectConfigRecord.outputSha256 === sha256(preflight.projectConfigOutputBytes)
      && canonicalJsonSha256(actualConfigBytes) === expectedConfigSha
    if (!hasLegacyConfigHashes) {
      fail('Refusing legacy output without matching source, generated config hashes, and equivalent public config')
    }
  }

  for (const record of manifest.files) {
    if (record.outputPath === 'project.config.json') continue
    const target = resolveInside(outputDirectory, record.outputPath, 'existing output file')
    const expectedHashMode = manifest.manifestSchemaVersion === 2 ? 'raw-bytes' : undefined
    if (record.hashMode !== expectedHashMode || sha256(fs.readFileSync(target)) !== record.outputSha256) {
      fail('Refusing to clean output with a modified generated file: ' + record.outputPath)
    }
  }
  return { exists: true, privateConfigBytes }
}

function buildPreview({ isolatedRoot } = {}) {
  const outputRoot = isolatedRoot === undefined ? rootDirectory : validateIsolatedRoot(isolatedRoot)
  const outputDirectory = isolatedRoot === undefined
    ? defaultOutputDirectory
    : resolveInside(outputRoot, PREVIEW_RELATIVE, 'isolated output directory')
  ensureSafeOutputParents(outputDirectory, outputRoot)
  const preflight = prepareFiles()
  const existing = inspectExistingOutput(preflight, outputDirectory)
  if (existing.exists) fs.rmSync(outputDirectory, { recursive: true, force: false })
  fs.mkdirSync(outputDirectory)

  preflight.prepared.forEach((file) => createOutputFile(outputDirectory, file.record.outputPath, file.outputBytes))
  const files = preflight.prepared.map((file) => file.record)
  const previewConfig = JSON.parse(fs.readFileSync(path.join(outputDirectory, 'project.config.json'), 'utf8'))
  const manifest = {
    builderId: BUILDER_ID,
    manifestSchemaVersion: 2,
    profile: 'development-preview',
    generatedAtUtc: new Date().toISOString(),
    projectName: previewConfig.projectname,
    appId: previewConfig.appid,
    libVersion: previewConfig.libVersion,
    sourcePackOptionsIgnore: preflight.sourceProjectConfig.packOptions.ignore,
    explicitPackIncludes: DRAFT_RESOURCES.slice(),
    runtimeCatalogPolicy: {
      develop: 'development sample catalog',
      trial: 'formal manual-reference catalog',
      release: 'formal manual-reference catalog',
      unknown: 'formal manual-reference catalog',
    },
    files,
  }
  fs.writeFileSync(
    path.join(outputDirectory, MANIFEST_NAME),
    JSON.stringify(manifest, null, 2) + '\n',
    { encoding: 'utf8', flag: 'wx' },
  )
  fs.writeFileSync(path.join(outputDirectory, OWNER_MARKER), markerContents, { encoding: 'utf8', flag: 'wx' })
  if (existing.privateConfigBytes !== null) {
    fs.writeFileSync(path.join(outputDirectory, PRIVATE_CONFIG_NAME), existing.privateConfigBytes, { flag: 'wx' })
  }
  return { outputDirectory, outputRelative: PREVIEW_RELATIVE, manifest }
}

if (require.main === module) {
  if (process.argv.length > 2) {
    fail('This builder uses a fixed output path and does not accept input or output path arguments.')
  }
  const result = buildPreview()
  console.log('Development preview generated: ' + result.outputRelative)
  console.log('Tracked source/output files: ' + result.manifest.files.length)
  console.log('Explicit draft package includes: ' + result.manifest.explicitPackIncludes.length)
  console.log('Manifest: ' + result.outputRelative + '/' + MANIFEST_NAME)
}

module.exports = {
  BUILDER_ID,
  DRAFT_RESOURCES,
  ISOLATED_ROOT_PREFIX,
  MANIFEST_NAME,
  OWNER_MARKER,
  PRIVATE_CONFIG_NAME,
  PREVIEW_RELATIVE,
  buildPreview,
}
