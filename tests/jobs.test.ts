import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLux3dClient } from '@manycore/aholo-sdk-lux3d';
import { Jobs } from '../scripts/lib/jobs.js';
import { Store } from '../scripts/lib/store.js';
import { download } from '../scripts/lib/download.js';
import { parseRequest } from '../scripts/lib/request.js';
import { redact, safeError } from '../scripts/lib/config.js';

const input = { prompt: 'A ceramic robot' };
async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await mkdtemp(join(tmpdir(), 'aholo-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const calls: { method: string; url: URL; body?: unknown }[] = [];
  let result = { taskId: 42, status: 1, outputs: [] as { content: string }[] };
  let failCreate = false;
  let failQuery = false;
  const api = createLux3dClient({ apiKey: 'test-only', region: 'cn', fetch: async (url, options) => {
    const target = new URL(String(url));
    assert.equal(target.origin, 'https://api.aholo3d.cn');
    assert.equal((options?.headers as Record<string, string>).Authorization, 'test-only');
    calls.push({ method: options!.method!, url: target, body: options?.body ? JSON.parse(String(options.body)) : undefined });
    if (options?.method === 'POST') {
      assert.equal(target.pathname, '/lux3d/v1/generate/text-to-3d/task/create');
      if (failCreate) throw new Error('connection lost after remote accepted request');
      return Response.json({ c: '0', d: 42, m: '', f: null });
    }
    assert.equal(target.pathname, '/lux3d/v1/generate/task/get');
    assert.equal(target.searchParams.get('taskid'), '42');
    if (failQuery) return Response.json({ status: 'RESOURCE_EXHAUSTED', message: 'quota limit' }, { status: 429 });
    return Response.json({ c: '0', d: result, m: '', f: null });
  } });
  const store = new Store(root);
  const jobs = new Jobs(store, () => api);
  return {
    root, calls, store, jobs, api,
    setResult: (next: typeof result) => { result = next; },
    failCreate: () => { failCreate = true; }, failQuery: () => { failQuery = true; },
    creates: () => calls.filter((call) => call.method === 'POST').length,
  };
}

test('installed SDK submits once, persists normalized parameters, reuses across process/service restart and aliases', async (t) => {
  const f = await fixture(t);
  const first = await f.jobs.submit('robot', input);
  assert.equal(first.reused, false);
  assert.equal(first.job.taskId, 42);
  assert.deepEqual(f.calls[0].body, parseRequest(input));
  const restarted = new Jobs(new Store(f.root), () => { throw new Error('No API should be needed to reuse'); });
  assert.equal((await restarted.submit('robot', input)).reused, true);
  assert.equal((await restarted.submit('other-name', input)).job.name, 'robot');
  assert.equal(f.creates(), 1);
  await assert.rejects(restarted.submit('robot', { prompt: 'Different' }), /different parameters/);
  assert.equal(f.creates(), 1);
});
test('unknown fields and invalid generation parameters fail before any external call', async (t) => {
  const f = await fixture(t);
  for (const bad of [{ prompt: '' }, { ...input, faceCount: 9999 }, { ...input, version: 'imaginary' }, { ...input, apiKey: 'no' }]) {
    await assert.rejects(f.jobs.submit('bad', bad));
  }
  await assert.rejects(f.jobs.submit('../escape', input));
  assert.equal(f.calls.length, 0);
});
test('ambiguous network failure is journaled and never automatically retried', async (t) => {
  const f = await fixture(t);
  f.failCreate();
  await assert.rejects(f.jobs.submit('robot', input), /uncertain/);
  assert.equal((await f.store.require('robot')).phase, 'uncertain');
  const retry = await f.jobs.submit('robot', input, true);
  assert.equal(retry.reused, true);
  assert.equal(f.creates(), 1);
  await assert.rejects(f.jobs.refresh('robot'), /No task ID/);
  const attached = await f.jobs.attach('robot', 42);
  assert.equal(attached.taskId, 42);
  assert.equal(attached.phase, 'running');
  assert.equal(f.creates(), 1);
});
test('a journal left in submitting by process death blocks another create', async (t) => {
  const f = await fixture(t);
  const { job } = await f.jobs.submit('robot', input);
  delete job.taskId;
  job.phase = 'submitting';
  await f.store.save(job, 'simulated process death before ID persistence');
  const restarted = new Jobs(new Store(f.root), () => f.api);
  assert.equal((await restarted.submit('robot', input)).job.phase, 'submitting');
  assert.equal(f.creates(), 1);
});
test('concurrent submissions have one external effect', async (t) => {
  const f = await fixture(t);
  const other = new Jobs(new Store(f.root), () => f.api);
  const results = await Promise.allSettled([f.jobs.submit('robot', input), other.submit('robot', input)]);
  assert.ok(results.some((result) => result.status === 'fulfilled'));
  assert.equal(f.creates(), 1);
  assert.equal((await f.store.require('robot')).taskId, 42);
});
test('query errors preserve previous truth, and terminal failures do not regenerate', async (t) => {
  const f = await fixture(t);
  await f.jobs.submit('robot', input);
  f.setResult({ taskId: 42, status: 4, outputs: [] });
  assert.equal((await f.jobs.refresh('robot')).phase, 'failed');
  f.failQuery();
  await assert.rejects(f.jobs.refresh('robot'), /quota limit/);
  const saved = await f.store.require('robot');
  assert.equal(saved.phase, 'failed');
  assert.equal(saved.result?.status, 4);
  assert.match(saved.lastError!, /RateLimitError/);
  assert.equal((await f.jobs.submit('robot', input)).reused, true);
  assert.equal(f.creates(), 1);
});
test('unknown or mismatched upstream responses cannot overwrite last known state', async (t) => {
  const f = await fixture(t);
  await f.jobs.submit('robot', input);
  await f.jobs.refresh('robot');
  for (const result of [{ taskId: 42, status: 2, outputs: [] }, { taskId: 99, status: 3, outputs: [] }]) {
    f.setResult(result);
    await assert.rejects(f.jobs.refresh('robot'), /Unexpected SDK/);
    assert.equal((await f.store.require('robot')).result?.status, 1);
  }
});
test('paid repeat requires a new name plus explicit flag', async (t) => {
  const f = await fixture(t);
  await f.jobs.submit('robot', input);
  await f.jobs.submit('robot', input, true);
  assert.equal(f.creates(), 1);
  await f.jobs.submit('repeat', input, true);
  assert.equal(f.creates(), 2);
});
test('download persists a real GLB, skips completed bytes and repairs corruption/partial files', async (t) => {
  const f = await fixture(t);
  await f.jobs.submit('robot', input);
  f.setResult({ taskId: 42, status: 3, outputs: [{ content: 'https://cdn.example.test/model?temporary=token' }, { content: 'NOT_REQUESTED' }] });
  const glb = await readFile(new URL('../public/models/offline-robot.glb', import.meta.url));
  let downloads = 0;
  const fetcher: typeof fetch = async (_url, options) => {
    assert.equal(options?.headers, undefined, 'API credentials must not be forwarded to CDN');
    downloads++; return new Response(glb);
  };
  const first = await download(f.jobs, 'robot', fetcher);
  assert.equal(first.assets[0].format, 'glb');
  assert.equal(first.assets[0].bytes, glb.length);
  assert.equal(first.assets[0].sha256.length, 64);
  const manifest = await readFile(join(f.root, 'public/generated/manifest.json'), 'utf8');
  assert.ok(!manifest.includes('temporary') && !manifest.includes('prompt'));
  assert.equal(JSON.parse(manifest).models[0].url, '/generated/robot/0.glb');
  await download(f.jobs, 'robot', fetcher);
  assert.equal(downloads, 1);
  await writeFile(join(f.root, first.assets[0].path), 'broken');
  await writeFile(join(f.root, 'public/generated/robot/0.part'), 'interrupted');
  await download(f.jobs, 'robot', fetcher);
  assert.equal(downloads, 2);
  assert.deepEqual(await readFile(join(f.root, first.assets[0].path)), glb);
  assert.equal(f.creates(), 1);
});
test('download failure cleans temporary bytes and resumes without paying again', async (t) => {
  const f = await fixture(t);
  await f.jobs.submit('robot', input);
  f.setResult({ taskId: 42, status: 3, outputs: [{ content: 'https://cdn.example.test/model.glb' }] });
  await assert.rejects(download(f.jobs, 'robot', async () => new Response('expired', { status: 403 })), /HTTP 403/);
  await assert.rejects(download(f.jobs, 'robot', async () => new Response('not a GLB')), /not GLB/);
  await assert.rejects(readFile(join(f.root, 'public/generated/robot/0.part')), { code: 'ENOENT' });
  const job = await f.store.require('robot');
  assert.equal(job.phase, 'succeeded');
  assert.equal(job.assets.length, 0);
  const glb = await readFile(new URL('../public/models/offline-robot.glb', import.meta.url));
  await download(f.jobs, 'robot', async () => new Response(glb));
  assert.equal(f.creates(), 1);
});
test('damaged journals fail closed instead of becoming missing jobs', async (t) => {
  const f = await fixture(t);
  await mkdir(f.store.directory, { recursive: true });
  await writeFile(join(f.store.directory, 'robot.json'), '{');
  await assert.rejects(f.jobs.submit('robot', input));
  assert.equal(f.creates(), 0);
});
test('error and console serialization redact the configured key', () => {
  const original = process.env.AHOLO_API_KEY;
  process.env.AHOLO_API_KEY = 'synthetic-test-secret';
  try {
    assert.equal(redact('synthetic-test-secret repeated synthetic-test-secret'), '[REDACTED] repeated [REDACTED]');
    assert.ok(!safeError(new Error('synthetic-test-secret https://example.test/?signature=x')).includes('synthetic-test-secret'));
    assert.ok(!safeError(new Error('https://example.test/?signature=x')).includes('signature'));
  } finally { if (original === undefined) delete process.env.AHOLO_API_KEY; else process.env.AHOLO_API_KEY = original; }
});
