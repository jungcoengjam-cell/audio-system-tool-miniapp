'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { canonical, sha256, sourceFiles, DATASET_SHA256 } = require('./common.cjs')

const manifestPath = path.join(__dirname, 'freeze.json')
if (fs.existsSync(manifestPath)) throw new Error('freeze.json already exists; refusing to rewrite the frozen manifest')
if (!process.argv.includes('--write')) throw new Error('Pass --write only after benchmark source review to create the initial freeze')
const files = Object.fromEntries(sourceFiles().map((file) => [file, sha256(fs.readFileSync(path.join(__dirname, file)))]))
const manifest = { version: '1.0.0', dataset_sha256: DATASET_SHA256, files }
manifest.protocol_sha256 = sha256(Buffer.from(JSON.stringify(canonical(manifest))))
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' })
process.stdout.write(`Created initial freeze for ${Object.keys(files).length} files: ${manifest.protocol_sha256}\n`)
