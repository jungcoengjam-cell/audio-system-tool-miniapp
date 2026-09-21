'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

const ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
const MODEL = 'jev-1.13.0';
const PROTOCOL_VERSION = '1.0.0';
const RETRYABLE_STATUS = new Set([408, 429]);

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function timestamp() { return new Date().toISOString(); }

function validateAnswer(answer) {
  if (!answer || typeof answer !== 'object' || Array.isArray(answer)) return false;
  if (answer.type === 'choice') {
    return typeof answer.choice === 'string' && answer.choice.length > 0 &&
      answer.probabilities && typeof answer.probabilities === 'object' && !Array.isArray(answer.probabilities) &&
      Object.values(answer.probabilities).every(value => Number.isFinite(value) && value >= 0 && value <= 1) &&
      Number.isFinite(answer.confidence) && answer.confidence >= 0 && answer.confidence <= 1;
  }
  if (answer.type === 'noul') return Number.isFinite(answer.noul) && answer.noul >= 0 && answer.noul <= 1;
  return false;
}

function validateResponse(parsed, request) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
      typeof parsed.model !== 'string' || !parsed.answers || typeof parsed.answers !== 'object' || Array.isArray(parsed.answers)) {
    return { kind: 'malformed_response', message: 'Response has invalid top-level fields.' };
  }
  const questions = request.body?.questions;
  if (!questions || typeof questions !== 'object' || Array.isArray(questions)) {
    return { kind: 'malformed_response', message: 'Request has no valid question map.' };
  }
  const expected = Object.keys(questions);
  const actual = Object.keys(parsed.answers);
  if (actual.length !== expected.length || expected.some(id => !Object.hasOwn(parsed.answers, id)) || actual.some(id => !expected.includes(id))) {
    return { kind: 'malformed_response', message: 'Response answer IDs do not match the request.' };
  }
  for (const id of expected) {
    const answer = parsed.answers[id];
    const question = questions[id];
    if (!question || !question.criteria || !validateAnswer(answer) || answer.type !== question.type) {
      return { kind: 'malformed_response', message: `Response answer for ${id} does not match its question.` };
    }
    if (answer.type === 'choice') {
      const criteriaOptions = Object.keys(question.criteria);
      const total = Object.values(answer.probabilities).reduce((sum, value) => sum + value, 0);
      const maxProbability = Math.max(...Object.values(answer.probabilities));
      if (!criteriaOptions.length || !criteriaOptions.includes(answer.choice) ||
          Object.keys(answer.probabilities).length !== criteriaOptions.length ||
          criteriaOptions.some(option => !Object.hasOwn(answer.probabilities, option)) ||
          Math.abs(total - 1) > 1e-6 || answer.probabilities[answer.choice] !== maxProbability) {
        return { kind: 'malformed_response', message: `Choice answer for ${id} does not match its criteria.` };
      }
    } else if (answer.type === 'noul' && (!Object.hasOwn(question.criteria, 'true') || !Object.hasOwn(question.criteria, 'false'))) {
      return { kind: 'malformed_response', message: `Noul question ${id} has invalid criteria.` };
    }
  }
  if (parsed.usage !== undefined && (!parsed.usage || typeof parsed.usage !== 'object' || Array.isArray(parsed.usage))) {
    return { kind: 'malformed_response', message: 'Response usage field is invalid.' };
  }
  if (parsed.model !== MODEL) return { kind: 'model_mismatch', message: 'Response model does not match the pinned model.' };
  return null;
}

function containsSecret(bytes, key) {
  if (!key) return false;
  const text = bytes.toString('utf8');
  let encoded;
  try { encoded = encodeURIComponent(key); } catch { encoded = ''; }
  return text.includes(key) || (encoded && encoded !== key && text.includes(encoded));
}

function redactRequestBody(body, key) {
  let serialized = JSON.stringify(body);
  let encoded = '';
  try { encoded = encodeURIComponent(key); } catch {}
  serialized = serialized.split(key).join('[REDACTED]');
  if (encoded && encoded !== key) serialized = serialized.split(encoded).join('[REDACTED]');
  return JSON.parse(serialized);
}

async function writeExclusive(file, bytes) {
  await fs.promises.writeFile(file, bytes, { flag: 'wx' });
}

async function runBenchmark({ requests, outputDir, protocolHash, datasetHash, fetchImpl = globalThis.fetch,
  sleepImpl = sleep, nowImpl = timestamp, key, onRequest, timeoutMs = 30000 } = {}) {
  if (!Array.isArray(requests) || !requests.length) throw new Error('requests must be a non-empty array');
  if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable');
  if (!outputDir || !protocolHash || !datasetHash) throw new Error('outputDir, protocolHash, and datasetHash are required');
  if (typeof key !== 'string' || !key) throw new Error('API key is required');

  const runDir = path.resolve(outputDir);
  await fs.promises.mkdir(path.dirname(runDir), { recursive: true });
  const seen = new Set();
  for (const request of requests) {
    if (typeof request.request_id !== 'string' || !/^[A-Za-z0-9_.-]+$/.test(request.request_id)) throw new Error('request_id must be a safe filename token');
    if (seen.has(request.request_id)) throw new Error('request_id values must be unique');
    seen.add(request.request_id);
    if (!request.body || request.body.model !== MODEL || !Array.isArray(request.judgments)) throw new Error('request has invalid body or judgments');
  }
  await fs.promises.mkdir(runDir, { recursive: false });
  await fs.promises.mkdir(path.join(runDir, 'records'));
  await fs.promises.mkdir(path.join(runDir, 'bodies'));
  const expectedJudgments = requests.reduce((n, request) => n + request.judgments.length, 0);
  await writeExclusive(path.join(runDir, 'run.json'), Buffer.from(JSON.stringify({
    run_id: path.basename(runDir), dataset_sha256: datasetHash, protocol_sha256: protocolHash,
    protocol_version: PROTOCOL_VERSION, requested_model: MODEL, started_at: nowImpl(),
    planned_cases: new Set(requests.map(request => request.case_id)).size, planned_requests: requests.length, planned_judgments: expectedJudgments,
  }, null, 2) + '\n'));

  let completed = 0, failed = 0, aborted = false;
  const retryCount = Object.create(null);
  for (const request of requests) {
    let final = false;
    let attempt = 0;
    while (!final) {
      if (onRequest) onRequest(request);
      attempt++;
      const started = performance.now();
      let status = null, model = null, apiError = null, raw = null, parsed = null;
      let retryable = false, authFailure = false;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const requestBytes = Buffer.from(JSON.stringify(request.body));
      if (containsSecret(requestBytes, key)) {
        apiError = { kind: 'secret_redaction', message: 'Request body withheld because it contains the configured secret.' };
      } else try {
        const response = await fetchImpl(ENDPOINT, {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: requestBytes.toString('utf8'), signal: controller.signal,
        });
        status = response.status;
        raw = Buffer.from(await response.arrayBuffer());
        if (containsSecret(raw, key)) {
          apiError = { kind: 'secret_redaction', message: 'Response body withheld because it contains the configured secret.' };
          raw = null;
        } else if (!response.ok) {
          apiError = { kind: 'http_error', message: `HTTP ${status}.` };
          retryable = RETRYABLE_STATUS.has(status) || (status >= 500 && status <= 599);
          authFailure = status === 401 || status === 403;
        } else {
          try { parsed = JSON.parse(raw.toString('utf8')); }
          catch { apiError = { kind: 'malformed_response', message: 'Successful response body is not valid JSON.' }; }
          if (!apiError) {
            model = typeof parsed?.model === 'string' ? parsed.model : null;
            apiError = validateResponse(parsed, request);
          }
        }
      } catch (error) {
        apiError = { kind: controller.signal.aborted ? 'timeout' : 'network_error',
          message: controller.signal.aborted ? 'Request timed out.' : 'Request failed before receiving a response.' };
        retryable = true;
      } finally { clearTimeout(timer); }
      if (apiError?.kind === 'secret_redaction') clearTimeout(timer);

      const latency = Math.max(0, Math.round(performance.now() - started));
      const canRetry = retryable && attempt < 3 && !(apiError?.kind === 'secret_redaction');
      final = !canRetry;
      if (raw !== null) {
        const bodyRel = `bodies/${request.request_id}.attempt-${attempt}.body`;
        await writeExclusive(path.join(runDir, bodyRel), raw);
        var bodyFile = bodyRel;
      } else var bodyFile = null;
      const record = {
        case_id: request.case_id, request_id: request.request_id, dataset_sha256: datasetHash,
        protocol_sha256: protocolHash, protocol_version: PROTOCOL_VERSION, requested_model: MODEL,
        model, timestamp: nowImpl(), latency_ms: latency, attempt, transport_retries: attempt - 1,
        http_status: status, api_error: apiError, judgments: request.judgments,
        request_body: redactRequestBody(request.body, key), response_body_file: bodyFile, final,
      };
      await writeExclusive(path.join(runDir, 'records', `${request.request_id}.attempt-${attempt}.json`),
        Buffer.from(JSON.stringify(record, null, 2) + '\n'));

      if (authFailure) { aborted = true; failed++; break; }
      if (canRetry) {
        retryCount[request.request_id] = attempt;
        await sleepImpl(attempt === 1 ? 1000 : 2000);
        continue;
      }
      if (apiError) failed++; else completed++;
      break;
    }
    if (aborted) break;
  }
  const summary = { run_id: path.basename(runDir), status: aborted ? 'aborted' : 'complete',
    planned_requests: requests.length, completed_requests: completed, failed_requests: failed,
    unattempted_requests: requests.length - completed - failed, transport_retries: Object.values(retryCount).reduce((a, b) => a + b, 0),
    finished_at: nowImpl() };
  await writeExclusive(path.join(runDir, 'summary.json'), Buffer.from(JSON.stringify(summary, null, 2) + '\n'));
  return summary;
}

function parseArgs(argv) {
  const args = { live: false, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--live') args.live = true;
    else if (arg === '--dry-run') args.dryRun = true;
    else if (['--run-id', '--protocol-hash'].includes(arg)) {
      const value = argv[++i];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
      args[arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
    }
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (args.live && args.dryRun) throw new Error('--live and --dry-run cannot be used together');
  return args;
}

function verifyCommittedFreeze(common) {
  const root = path.resolve(__dirname, '..', '..', '..');
  const frozenPaths = [...Object.keys(common.verifyFrozen().manifest.files), 'freeze.json']
    .map(file => `tests/p2-jev/benchmark-v1/${file}`);
  for (const relative of frozenPaths) {
    const committed = require('node:child_process').spawnSync('git', ['show', `HEAD:${relative}`], { cwd: root, encoding: null });
    if (committed.status !== 0) throw new Error('Frozen protocol files must be committed.');
    const current = fs.readFileSync(path.join(root, relative));
    if (!current.equals(committed.stdout)) throw new Error('Frozen protocol files must match the committed revision.');
  }
  const status = require('node:child_process').spawnSync('git', ['status', '--porcelain', '--', ...frozenPaths], { cwd: root, encoding: 'utf8' });
  if (status.status !== 0 || status.stdout.trim()) throw new Error('Frozen protocol files must be clean.');
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const common = require('./common.cjs');
  const assets = common.loadAssets();
  const requests = common.buildRequests(assets);
  if (!args.live || args.dryRun) {
    process.stdout.write(`${JSON.stringify({ mode: 'dry-run', requests: requests.length,
      judgments: requests.reduce((n, r) => n + r.judgments.length, 0) })}\n`);
    return;
  }
  if (!/^run-[1-9][0-9]*$/.test(args.runId || '')) throw new Error('--live requires a safe run ID such as run-1.');
  if (!args.protocolHash) throw new Error('--live requires --protocol-hash');
  const frozen = common.verifyFrozen();
  if (frozen.protocolHash !== args.protocolHash) throw new Error('Protocol hash does not match the frozen protocol.');
  verifyCommittedFreeze(common);
  const key = process.env.TYPESAFE_API_KEY;
  if (!key) throw new Error('TYPESAFE_API_KEY is required for live mode.');
  const outputDir = path.join(__dirname, 'runs', args.runId);
  const summary = await runBenchmark({ requests, outputDir, protocolHash: frozen.protocolHash,
    datasetHash: frozen.manifest.datasetHash || frozen.manifest.dataset_sha256, key });
  process.stdout.write(`${JSON.stringify(summary)}\n`);
}

if (require.main === module) main().catch(error => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});

module.exports = { ENDPOINT, MODEL, PROTOCOL_VERSION, runBenchmark, validateResponse, parseArgs, verifyCommittedFreeze, main };
