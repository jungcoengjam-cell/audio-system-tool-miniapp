'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { loadAssets, buildRequests, sha256, verifyFrozen, canonical, DATASET_SHA256, ROUTES } = require('./common.cjs')

const assets = loadAssets()
const requests = buildRequests(assets)
const sourceDir = path.resolve(__dirname, '..', 'v2.1')
const caseFiles = ['audio.cases.json', 'av-and-controls.cases.json', 'audio.additions.json', 'av.additions.json']
const sourceCases = caseFiles.flatMap((file) => JSON.parse(fs.readFileSync(path.join(sourceDir, file), 'utf8')))
const canonicalDataset = `${JSON.stringify(canonical([...sourceCases].sort((a, b) => String(a.id).localeCompare(String(b.id), 'en'))))}\n`
const counts = { cases: assets.stimuli.length, parameter_states: assets.scope.reduce((sum, item) => sum + item.parameters.length, 0), judgments: requests.reduce((sum, request) => sum + request.judgments.length, 0), request_batches: requests.length }
const errors = []
if (assets.protocol.dataset_sha256 !== DATASET_SHA256) errors.push('dataset hash mismatch')
if (assets.protocol.dataset_commit !== '1e843d63f7d3c94770be690af58f616382ed7f53') errors.push('dataset commit mismatch')
if (sha256(Buffer.from(canonicalDataset, 'utf8')) !== DATASET_SHA256) errors.push('V2.1 canonical dataset hash mismatch')
if (counts.cases !== 144 || counts.parameter_states !== 1142 || counts.judgments !== 3858 || counts.request_batches !== 1286) errors.push(`unexpected counts ${JSON.stringify(counts)}`)
if (JSON.stringify(assets.protocol.routing_choices) !== JSON.stringify(ROUTES)) errors.push('routing options differ from frozen 17-route contract')
if (assets.stimuli.some((item) => Object.keys(item).sort().join(',') !== 'id,user_utterance')) errors.push('stimuli may contain only id and user_utterance')
if (assets.scope.some((item) => Object.keys(item).sort().join(',') !== 'case_id,parameters' || item.parameters.some((p, i) => i && item.parameters[i - 1] >= p))) errors.push('scope entries must contain only case_id and sorted qualified parameter names')
if (new Set(assets.stimuli.map((item) => item.id)).size !== 144 || new Set(assets.scope.map((item) => item.case_id)).size !== 144) errors.push('case ids must be unique')
const expectedStimuli = sourceCases.map((item) => ({ id: item.id, user_utterance: item.user_utterance })).sort((a, b) => a.id.localeCompare(b.id))
const expectedScope = sourceCases.map((item) => ({ case_id: item.id, parameters: Object.keys(item.expected.parameters).sort() })).sort((a, b) => a.case_id.localeCompare(b.case_id))
if (JSON.stringify(assets.stimuli) !== JSON.stringify(expectedStimuli)) errors.push('static stimuli differ from the unchanged V2.1 utterances')
if (JSON.stringify(assets.scope) !== JSON.stringify(expectedScope)) errors.push('static parameter scope differs from V2.1 parameter names')
const forbiddenContextKey = (value) => Array.isArray(value) ? value.some(forbiddenContextKey) : value && typeof value === 'object' ? Object.entries(value).some(([key, child]) => ['case_id', 'case_type', 'tags', 'expected', 'rationale', 'review', 'gold'].includes(key) || forbiddenContextKey(child)) : false
if (forbiddenContextKey(assets.context)) errors.push('neutral context contains case metadata or annotation fields')
const allowedBody = new Set(['model', 'state', 'questions'])
for (const request of requests) {
  if (Object.keys(request.body).some((key) => !allowedBody.has(key)) || Object.keys(request.body).length !== 3) errors.push(`${request.request_id}: body key whitelist violation`)
  if (request.body.model !== 'jev-1.13.0' || request.body.questions === undefined) errors.push(`${request.request_id}: malformed request body`)
  if (request.judgments.some((j) => !assets.protocol.judgments.includes(j.id) || j.target !== j.id)) errors.push(`${request.request_id}: unknown judgment id or target mismatch`)
  if (JSON.stringify(canonical(request.body)).includes('case_id') || JSON.stringify(canonical(request.body)).includes('gold')) errors.push(`${request.request_id}: benchmark metadata leaked into body`)
}
if (errors.length) throw new Error(errors.join('\n'))
if (!process.argv.includes('--dry-run')) throw new Error('This validator is offline-only; run with --dry-run')
const requestDigest = sha256(Buffer.from(JSON.stringify(canonical(requests.map((r) => r.body)))))
let protocolHash = '(freeze not created; awaiting root review)'
try { protocolHash = verifyFrozen().protocolHash } catch (error) { if (!/freeze.json/.test(error.message)) throw error }
process.stdout.write(`${JSON.stringify({ mode: 'offline-dry-run', protocol_hash: protocolHash, dataset_sha256: DATASET_SHA256, request_digest: requestDigest, ...counts })}\n`)
