'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { createApkDownloadServer } = require('./serve-apk-downloads.cjs');

const patientFile = 'CareConnect-Patient-Latest-1.0.8.apk';
const caretakerFile = 'CareConnect-Caretaker-Latest-1.0.1.apk';

async function fixture(t, change, { patientSize = 0 } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'careconnect-apk-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const patient = patientSize ? Buffer.alloc(patientSize, 0x73) : Buffer.from('PATIENT\0\x01\x02latest face model');
  const caretaker = Buffer.from('CARETAKER\0\x03care updates');
  await fs.writeFile(path.join(directory, patientFile), patient);
  await fs.writeFile(path.join(directory, caretakerFile), caretaker);
  const artifacts = [
    { file: path.join(directory, patientFile), version: '1.0.8', versionCode: 9, package: 'com.careconnect.patient.preview', bytes: patient.length, sha256: crypto.createHash('sha256').update(patient).digest('hex') },
    { file: path.join(directory, caretakerFile), version: '1.0.1', versionCode: 2, package: 'com.careconnect.caretaker.preview', bytes: caretaker.length, sha256: crypto.createHash('sha256').update(caretaker).digest('hex') },
  ];
  if (change) await change(artifacts, directory);
  const manifestPath = path.join(directory, 'downloads.json');
  await fs.writeFile(manifestPath, JSON.stringify({ artifacts, privateKey: 'DO-NOT-EXPOSE' }));
  return { directory, patient, caretaker, manifestPath };
}

async function running(t, options) {
  const files = await fixture(t, undefined, options);
  const server = await createApkDownloadServer({ manifestPath: files.manifestPath, apkDirectory: files.directory });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { ...files, port: server.address().port };
}

function request(port, requestPath, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: requestPath, method, headers }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}

test('download GET serves the exact two APK bytes with attachment and safety headers', async (t) => {
  const files = await running(t);
  for (const [name, expected] of [[patientFile, files.patient], [caretakerFile, files.caretaker]]) {
    const result = await request(files.port, `/${name}`);
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, expected);
    assert.equal(Number(result.headers['content-length']), expected.length);
    assert.equal(result.headers['content-type'], 'application/vnd.android.package-archive');
    assert.equal(result.headers['content-disposition'], `attachment; filename="${name}"`);
    assert.equal(result.headers['cache-control'], 'no-store');
    assert.equal(result.headers['x-content-type-options'], 'nosniff');
    assert.equal(result.headers['accept-ranges'], 'bytes');
  }
});

test('HEAD reports APK sizes without sending a body', async (t) => {
  const files = await running(t);
  const result = await request(files.port, `/${patientFile}`, { method: 'HEAD' });
  assert.equal(result.status, 200);
  assert.equal(result.body.length, 0);
  assert.equal(Number(result.headers['content-length']), files.patient.length);
});

test('landing page contains both exact download routes and never reveals filesystem or manifest secrets', async (t) => {
  const files = await running(t);
  const result = await request(files.port, '/');
  const text = result.body.toString('utf8');
  assert.equal(result.status, 200);
  assert.match(text, new RegExp(`href="/${patientFile.replace(/\./g, '\\.')}"`));
  assert.match(text, new RegExp(`href="/${caretakerFile.replace(/\./g, '\\.')}"`));
  assert.match(text, /Preview apps for testing/);
  assert.ok(!text.includes(files.directory));
  assert.ok(!text.includes('DO-NOT-EXPOSE'));
  assert.ok(!text.includes('privateKey'));
  const head = await request(files.port, '/', { method: 'HEAD' });
  assert.equal(head.body.length, 0);
  assert.equal(Number(head.headers['content-length']), result.body.length);
});

test('private files, listings, older builds and encoded traversal remain inaccessible', async (t) => {
  const files = await running(t);
  const paths = ['/downloads.json', '/audit/latest-apk-downloads.json', '/.env', '/dist/apk/', '/CareConnect-Patient-Latest-1.0.1.apk', '/CareConnect-Patient-Latest-1.0.7.apk', `/../${patientFile}`, `/%2e%2e/${patientFile}`, `/%2e%2e%2f${patientFile}`, `/${patientFile}/`, '/server.cjs'];
  for (const route of paths) assert.equal((await request(files.port, route)).status, 404, route);
  assert.equal((await request(files.port, '/%ZZ')).status, 400);
  assert.equal((await request(files.port, '/%E0%A4%A')).status, 400);
});

test('only GET and HEAD are accepted', async (t) => {
  const files = await running(t);
  for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS']) {
    const result = await request(files.port, `/${patientFile}`, { method });
    assert.equal(result.status, 405);
    assert.equal(result.headers.allow, 'GET, HEAD');
  }
});

test('single closed, open-ended and suffix byte ranges resume exact bytes', async (t) => {
  const files = await running(t);
  const cases = [
    ['bytes=2-8', 2, 8],
    ['bytes=4-', 4, files.patient.length - 1],
    ['bytes=-7', files.patient.length - 7, files.patient.length - 1],
    ['bytes=1-999', 1, files.patient.length - 1],
    ['bytes=-999', 0, files.patient.length - 1],
  ];
  for (const [range, start, end] of cases) {
    const result = await request(files.port, `/${patientFile}`, { headers: { Range: range } });
    assert.equal(result.status, 206, range);
    assert.deepEqual(result.body, files.patient.subarray(start, end + 1), range);
    assert.equal(result.headers['content-range'], `bytes ${start}-${end}/${files.patient.length}`);
    assert.equal(Number(result.headers['content-length']), end - start + 1);
  }
  const head = await request(files.port, `/${patientFile}`, { method: 'HEAD', headers: { Range: 'bytes=2-8' } });
  assert.equal(head.status, 206);
  assert.equal(head.body.length, 0);
  assert.equal(head.headers['content-range'], `bytes 2-8/${files.patient.length}`);
});

test('unsatisfiable, malformed and multiple byte ranges return correct 416 metadata', async (t) => {
  const files = await running(t);
  for (const range of [`bytes=${files.patient.length}-`, 'bytes=8-2', 'bytes=-0', 'bytes=-', 'bytes=0-1,3-4', 'items=0-5', 'bytes=abc-5', 'bytes=9007199254740992-']) {
    const result = await request(files.port, `/${patientFile}`, { headers: { Range: range } });
    assert.equal(result.status, 416, range);
    assert.equal(result.headers['content-range'], `bytes */${files.patient.length}`);
    assert.equal(result.headers['accept-ranges'], 'bytes');
  }
});

test('wrong startup hash and size block server creation before any APK can be served', async (t) => {
  for (const mutation of [(apps) => { apps[0].sha256 = '0'.repeat(64); }, (apps) => { apps[0].bytes += 1; }]) {
    const files = await fixture(t, mutation);
    await assert.rejects(createApkDownloadServer({ manifestPath: files.manifestPath, apkDirectory: files.directory }), /verification failed/);
  }
});

test('unexpected, duplicate or outside-directory manifest files are rejected', async (t) => {
  for (const mutation of [
    (apps) => { apps.push({ ...apps[0] }); },
    (apps) => { apps[1] = { ...apps[0] }; },
    (apps) => { apps[0].file = path.join(path.dirname(apps[0].file), '.env'); },
    async (apps, directory) => { const outside = path.join(directory, 'private'); await fs.mkdir(outside); const destination = path.join(outside, patientFile); await fs.copyFile(apps[0].file, destination); apps[0].file = destination; },
    (apps) => { apps[0].package = 'com.example.other'; },
  ]) {
    const files = await fixture(t, mutation);
    await assert.rejects(createApkDownloadServer({ manifestPath: files.manifestPath, apkDirectory: files.directory }));
  }
});

test('modification after startup stops serving stale verified content', async (t) => {
  const files = await running(t);
  await fs.appendFile(path.join(files.directory, patientFile), 'tampered');
  const result = await request(files.port, `/${patientFile}`);
  assert.equal(result.status, 503);
  assert.ok(!result.body.includes(files.patient));
});

test('aborting a multi-chunk APK download does not break subsequent HEAD or resumed downloads', async (t) => {
  const files = await running(t, { patientSize: 8 * 1024 * 1024 });
  for (let attempt = 0; attempt < 3; attempt++) {
    const received = await new Promise((resolve, reject) => {
      let bytes = 0;
      const req = http.get({ hostname: '127.0.0.1', port: files.port, path: `/${patientFile}` }, (res) => {
        assert.equal(res.statusCode, 200);
        res.once('data', (chunk) => {
          bytes = chunk.length;
          res.destroy();
          req.destroy();
        });
        res.once('close', () => resolve(bytes));
        res.on('error', (error) => { if (!bytes) reject(error); });
      });
      req.on('error', (error) => { if (!bytes) reject(error); });
    });
    assert.ok(received > 0 && received < files.patient.length, 'The client deliberately interrupted an incomplete stream.');
    const head = await request(files.port, `/${patientFile}`, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(Number(head.headers['content-length']), files.patient.length);
    const resumed = await request(files.port, `/${patientFile}`, { headers: { Range: 'bytes=1048576-1049600' } });
    assert.equal(resumed.status, 206);
    assert.deepEqual(resumed.body, files.patient.subarray(1048576, 1049601));
  }
  const caretaker = await request(files.port, `/${caretakerFile}`);
  assert.equal(caretaker.status, 200);
  assert.deepEqual(caretaker.body, files.caretaker);
});
