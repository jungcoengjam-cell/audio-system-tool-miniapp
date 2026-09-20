'use strict'

const fs = require('fs')
const path = require('path')

module.exports = function register({ test, assert }) {
  const root = path.resolve(__dirname, '../..')
  const relative = (file) => path.relative(root, file).replace(/\\/g, '/')
  const ignored = (name, rules) => rules.some((rule) => {
    const target = String(rule.value).replace(/\\/g, '/').replace(/^\.\//, '')
    const candidate = relative(name)
    return rule.type === 'folder' ? candidate === target || candidate.startsWith(target + '/') : rule.type === 'file' && candidate === target
  })
  const walk = (directory, out = []) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === '.git') continue
      const full = path.join(directory, entry.name)
      if (entry.isDirectory()) walk(full, out)
      else out.push(full)
    }
    return out
  }

  test('effective production package excludes developer tests and documentation', () => {
    const config = JSON.parse(fs.readFileSync(path.join(root, 'project.config.json'), 'utf8'))
    const rules = config.packOptions?.ignore || []
    const includeRules = config.packOptions?.include || []
    for (const dir of ['tests', 'docs']) {
      assert(rules.some((rule) => rule.type === 'folder' && String(rule.value).replace(/\\/g, '/') === dir), 'packOptions.ignore must exclude ' + dir + '/')
      assert(!includeRules.some((rule) => String(rule.value).replace(/\\/g, '/').split('/')[0] === dir), 'packOptions.include must not re-add ' + dir + '/')
    }
    for (const file of ['AGENTS.md', 'README.md', 'CHANGELOG.md', 'DESIGN.md', 'TuneBuddy-交接说明.md']) {
      assert(rules.some((rule) => rule.type === 'file' && String(rule.value).replace(/\\/g, '/') === file), 'packOptions.ignore must exclude ' + file)
    }
    const effective = walk(root).filter((file) => !ignored(file, rules))
    assert(!effective.some((file) => /^(tests|docs)\//.test(relative(file))), 'effective package still contains tests/ or docs/')
    assert(!effective.includes(path.join(root, 'AGENTS.md')), 'effective package still contains AGENTS.md')
  }, { classification: 'implementation bug', basis: 'The resolved mini-program package must exclude development-only folders and root instructions after applying configured ignore rules.' })

  test('all effective shipped JavaScript and JSON sources avoid development and network client imports', () => {
    const config = JSON.parse(fs.readFileSync(path.join(root, 'project.config.json'), 'utf8'))
    const files = walk(root).filter((file) => !ignored(file, config.packOptions?.ignore || []))
    const sourceFiles = files.filter((file) => /\.(?:js|json)$/i.test(file))
    const importPattern = /\b(?:require\s*\(\s*|import\s*\(\s*|from\s*)['"]([^'"]+)['"]/g
    const forbiddenModules = /(?:^|[/@-])(?:tests|docs)(?:[/@.-]|$)|(?:openai|anthropic|typesafe|jev|ai-client|llm-client|axios|node-fetch)/i
    for (const file of sourceFiles) {
      const source = fs.readFileSync(file, 'utf8')
      for (const match of source.matchAll(importPattern)) {
        assert(!forbiddenModules.test(match[1]), relative(file) + ' imports prohibited module ' + match[1])
      }
      assert(!/\b(?:fetch\s*\(|new\s+WebSocket\s*\(|wx\.(?:request|uploadFile|downloadFile|connectSocket)\s*\(|wx\.cloud\.(?:callFunction|uploadFile|downloadFile)\s*\()/.test(source), relative(file) + ' performs an executable network call')
    }
    const manifestPath = path.join(root, 'package.json')
    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
      for (const group of ['dependencies', 'optionalDependencies', 'peerDependencies', 'devDependencies']) {
        for (const name of Object.keys(manifest[group] || {})) {
          assert(!/(?:openai|anthropic|typesafe|jev|ai-client|llm-client|axios|node-fetch)/i.test(name), 'package.json ' + group + ' contains prohibited client ' + name)
        }
      }
    }
  }, { classification: 'implementation bug', basis: 'Every effective shipped JS and JSON file is scanned for prohibited imports and executable runtime network calls; source URLs used as metadata are allowed.' })

  test('existing release checks include audio and project wiring coverage', () => {
    const source = fs.readFileSync(path.join(root, 'tests/release-check.js'), 'utf8')
    for (const filename of [
      'audio-wiring-model-test.js', 'audio-wiring-page-test.js', 'audio-wiring-renderer-test.js',
      'project-wiring-model-test.js', 'project-wiring-storage-test.js', 'project-wiring-page-test.js',
      'project-wiring-report-test.js', 'project-wiring-entry-test.js',
    ]) assert(source.includes(filename), 'release-check.js is missing ' + filename)
  }, { classification: 'implementation bug', basis: 'The legacy release run must retain established audio-wiring and project-wiring coverage.' })
}
