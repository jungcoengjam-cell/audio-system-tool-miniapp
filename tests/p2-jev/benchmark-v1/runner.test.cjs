'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { runBenchmark, ENDPOINT, MODEL, validateResponse, parseArgs } = require('./runner.cjs');

const request = { case_id: 'case-a', request_id: 'req-a', judgments: [{ id: 'q1', target: 'choice', parameter: null }],
  body: { model: MODEL, state: 'fixture', questions: { q1: { type: 'choice', criteria: { yes: 'yes', no: 'no' } } } } };
const key = 'test-secret-abc';
function response(status, bytes) {
  const content = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  return { status, ok: status >= 200 && status < 300, arrayBuffer: async () => content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength) };
}
function success(choice = 'yes') { return Buffer.from(JSON.stringify({ model: MODEL,
  answers: { q1: { type: 'choice', choice, probabilities: { yes: 0.9, no: 0.1 }, confidence: 0.9 } }, usage: { input_tokens: 2 } })); }

async function fixture(t, replies, options = {}) {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'jev-runner-test-'));
  t.after(async () => { await fs.promises.rm(root, { recursive: true, force: true }); });
  let calls = 0;
  const waits = [];
  const summary = await runBenchmark({ requests: options.requests || [request], outputDir: path.join(root, 'run-1'),
    protocolHash: 'p'.repeat(64), datasetHash: 'd'.repeat(64), key,
    fetchImpl: async (url, init) => { calls++; assert.equal(url, ENDPOINT); assert.equal(init.headers.Authorization, `Bearer ${key}`); return replies[calls - 1]; },
    sleepImpl: async ms => waits.push(ms), nowImpl: () => '2026-01-02T03:04:05.000Z', onRequest: options.onRequest,
  });
  return { root, run: path.join(root, 'run-1'), summary, calls, waits };
}

test('retries 429 and 529 twice at fixed delays, recording each exact response body', async t => {
  const bodies = [Buffer.from('{"error":"slow down"}'), Buffer.from('{"error":"busy"}'), success()];
  const result = await fixture(t, bodies.map((b, i) => response([429, 529, 200][i], b)));
  assert.equal(result.calls, 3);
  assert.deepEqual(result.waits, [1000, 2000]);
  for (let i = 1; i <= 3; i++) {
    const rec = JSON.parse(await fs.promises.readFile(path.join(result.run, 'records', `req-a.attempt-${i}.json`), 'utf8'));
    assert.equal(rec.attempt, i);
    assert.equal(rec.transport_retries, i - 1);
    assert.equal(rec.final, i === 3);
    assert.deepEqual(await fs.promises.readFile(path.join(result.run, rec.response_body_file)), bodies[i - 1]);
  }
  assert.equal(result.summary.completed_requests, 1);
  assert.equal(result.summary.transport_retries, 2);
});

test('network failures retry at most twice and preserve the last attempt', async t => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'jev-net-test-'));
  t.after(async () => fs.promises.rm(root, { recursive: true, force: true }));
  let calls = 0;
  const summary = await runBenchmark({ requests: [request], outputDir: path.join(root, 'run'), protocolHash: 'p', datasetHash: 'd', key,
    fetchImpl: async () => { calls++; throw new Error(`socket failed with ${key}`); }, sleepImpl: async () => {}, nowImpl: () => 't' });
  assert.equal(calls, 3);
  assert.equal(summary.failed_requests, 1);
  const rec = JSON.parse(await fs.promises.readFile(path.join(root, 'run', 'records', 'req-a.attempt-3.json'), 'utf8'));
  assert.equal(rec.api_error.kind, 'network_error');
  assert.equal(JSON.stringify(rec).includes(key), false);
  assert.equal(rec.final, true);
});

test('abort-listening timeout retries exactly twice after the first attempt', async t => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'jev-timeout-test-'));
  t.after(async () => fs.promises.rm(root, { recursive: true, force: true }));
  let calls = 0;
  const waits = [];
  const summary = await runBenchmark({ requests: [request], outputDir: path.join(root, 'run'), protocolHash: 'p', datasetHash: 'd', key,
    timeoutMs: 5, nowImpl: () => 't', sleepImpl: async ms => waits.push(ms),
    fetchImpl: (_url, init) => new Promise((resolve, reject) => {
      calls++;
      init.signal.addEventListener('abort', () => { const error = new Error('aborted'); error.name = 'AbortError'; reject(error); }, { once: true });
    }),
  });
  assert.equal(calls, 3);
  assert.deepEqual(waits, [1000, 2000]);
  assert.equal(summary.failed_requests, 1);
  const record = JSON.parse(await fs.promises.readFile(path.join(root, 'run', 'records', 'req-a.attempt-3.json'), 'utf8'));
  assert.equal(record.api_error.kind, 'timeout');
  assert.equal(record.final, true);
});

test('401 and 403 abort remaining requests without fabricating records', async t => {
  for (const status of [401, 403]) {
    const result = await fixture(t, [response(status, '{"error":"denied"}')], { requests: [request, { ...request, request_id: 'req-b', case_id: 'case-b' }] });
    assert.equal(result.calls, 1);
    assert.equal(result.summary.status, 'aborted');
    assert.equal(result.summary.unattempted_requests, 1);
    assert.equal((await fs.promises.readdir(path.join(result.run, 'records'))).length, 1);
  }
});

test('422, malformed 2xx and model mismatch are recorded without retries', async t => {
  const cases = [
    [response(422, '{"error":"invalid"}'), 'http_error'],
    [response(200, '{bad json'), 'malformed_response'],
    [response(200, JSON.stringify({ ...JSON.parse(success().toString()), model: 'jev-other' })), 'model_mismatch'],
  ];
  for (const [reply, kind] of cases) {
    const result = await fixture(t, [reply]);
    assert.equal(result.calls, 1);
    const rec = JSON.parse(await fs.promises.readFile(path.join(result.run, 'records', 'req-a.attempt-1.json'), 'utf8'));
    assert.equal(rec.api_error.kind, kind);
    assert.equal(rec.final, true);
  }
});

test('secret in response bytes is withheld and never included in metadata', async t => {
  const payload = Buffer.from(`prefix ${key} or ${encodeURIComponent(key)} suffix`);
  const result = await fixture(t, [response(200, payload)]);
  const records = path.join(result.run, 'records');
  const rec = JSON.parse(await fs.promises.readFile(path.join(records, 'req-a.attempt-1.json'), 'utf8'));
  assert.equal(rec.api_error.kind, 'secret_redaction');
  assert.equal(rec.response_body_file, null);
  assert.equal(JSON.stringify(rec).includes(key), false);
  assert.deepEqual(await fs.promises.readdir(path.join(result.run, 'bodies')), []);
});

test('secret in candidate request context is redacted and never sent', async t => {
  let calls = 0;
  const unsafe = { ...request, body: { ...request.body, state: { candidate: key } } };
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'jev-request-secret-test-'));
  t.after(async () => fs.promises.rm(root, { recursive: true, force: true }));
  await runBenchmark({ requests: [unsafe], outputDir: path.join(root, 'run'), protocolHash: 'p', datasetHash: 'd', key,
    fetchImpl: async () => { calls++; return response(200, success()); }, sleepImpl: async () => {}, nowImpl: () => 't' });
  assert.equal(calls, 0);
  const record = JSON.parse(await fs.promises.readFile(path.join(root, 'run', 'records', 'req-a.attempt-1.json'), 'utf8'));
  assert.equal(record.api_error.kind, 'secret_redaction');
  assert.equal(JSON.stringify(record).includes(key), false);
});

test('exclusive run directory prevents overwrite', async t => {
  const result = await fixture(t, [response(200, success())]);
  await assert.rejects(runBenchmark({ requests: [request], outputDir: result.run, protocolHash: 'p', datasetHash: 'd', key,
    fetchImpl: async () => response(200, success()) }), { code: 'EEXIST' });
});

test('answer validation covers choice confidence and numeric noul shape', () => {
  const req = { body: { questions: { q: { type: 'choice', criteria: { x: 'criterion' } } } } };
  assert.equal(validateResponse({ model: MODEL, answers: { q: { type: 'choice', choice: 'x', probabilities: { x: 1 }, confidence: 0.5 } } }, req), null);
  assert.equal(validateResponse({ model: MODEL, answers: { q: { type: 'choice', choice: 'x', probabilities: { x: 1 } } } }, req).kind, 'malformed_response');
  const noulReq = { body: { questions: { q: { type: 'noul', criteria: { true: 'positive', false: 'negative' } } } } };
  assert.equal(validateResponse({ model: MODEL, answers: { q: { type: 'noul', noul: 0.75 } } }, noulReq), null);
  assert.equal(validateResponse({ model: MODEL, answers: { q: { type: 'noul', noul: '0.75' } } }, noulReq).kind, 'malformed_response');
});

test('accepts mock answers built from real common requests without network access', async t => {
  const common = require('./common.cjs');
  const requests = common.buildRequests().slice(0, 2);
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'jev-common-test-'));
  t.after(async () => fs.promises.rm(root, { recursive: true, force: true }));
  let calls = 0;
  const summary = await runBenchmark({ requests, outputDir: path.join(root, 'run-1'), protocolHash: 'p', datasetHash: 'd', key,
    sleepImpl: async () => {}, nowImpl: () => 't',
    fetchImpl: async (_url, init) => {
      calls++;
      const sent = JSON.parse(init.body);
      const answers = Object.fromEntries(Object.entries(sent.questions).map(([id, question]) => [id,
        question.type === 'choice'
          ? { type: 'choice', choice: Object.keys(question.criteria)[0], probabilities: Object.fromEntries(Object.keys(question.criteria).map((option, index) => [option, index === 0 ? 1 : 0])), confidence: 1 }
          : { type: 'noul', noul: 1 },
      ]));
      return response(200, JSON.stringify({ model: MODEL, answers, usage: { input_tokens: 1 } }));
    },
  });
  assert.equal(calls, 2);
  assert.equal(summary.completed_requests, 2);
});

test('response validator accepts a synthetic response for every frozen common request', () => {
  const common = require('./common.cjs');
  const requests = common.buildRequests();
  assert.equal(new Set(requests.map(item => item.case_id)).size, 144);
  assert.equal(requests.length, 1286);
  assert.equal(requests.reduce((sum, item) => sum + item.judgments.length, 0), 3858);
  for (const item of requests) {
    const answers = Object.fromEntries(Object.entries(item.body.questions).map(([id, question]) => [id,
      question.type === 'choice'
        ? { type: 'choice', choice: Object.keys(question.criteria)[0], probabilities: Object.fromEntries(Object.keys(question.criteria).map((option, index) => [option, index === 0 ? 1 : 0])), confidence: 1 }
        : { type: 'noul', noul: 1 },
    ]));
    assert.equal(validateResponse({ model: MODEL, answers }, item), null, `${item.request_id} response should validate`);
  }
});

test('default and explicit dry-run do not read credentials or call fetch in a child CLI process', () => {
  const runnerPath = path.resolve(__dirname, 'runner.cjs');
  const guardPath = path.resolve(__dirname, '..', '..', 'helpers', 'offline-guard.js');
  for (const args of [[], ['--dry-run']]) {
    const script = `process.env = new Proxy(process.env, { get(target, key) { if (key === 'TYPESAFE_API_KEY') throw new Error('dry-run read API key'); return Reflect.get(target, key); } }); globalThis.fetch = () => { throw new Error('dry-run called fetch'); }; const runner = process.argv[1]; process.argv = [process.execPath, runner, ...JSON.parse(process.argv[2])]; require(runner).main().catch(error => { console.error(error.message); process.exitCode = 1; });`;
    const output = execFileSync(process.execPath, ['--require', guardPath, '-e', script, runnerPath, JSON.stringify(args)], { encoding: 'utf8' });
    assert.match(output, /"mode":"dry-run"/);
    assert.match(output, /"requests":1286/);
    assert.match(output, /"judgments":3858/);
  }
  assert.deepEqual(parseArgs([]), { live: false, dryRun: false });
  assert.deepEqual(parseArgs(['--dry-run']), { live: false, dryRun: true });
  assert.deepEqual(parseArgs(['--live', '--run-id', 'run-1', '--protocol-hash', 'abc']), { live: true, dryRun: false, runId: 'run-1', protocolHash: 'abc' });
  assert.throws(() => parseArgs(['--live', '--dry-run']), /cannot be used together/);
  assert.throws(() => parseArgs(['--live', '--run-id']), /Unknown argument|requires/);
});
