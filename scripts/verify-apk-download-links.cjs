// Verify complete download bytes and blocked routes; no sign-in or patient data.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
async function main() {
  const base = new URL(process.argv[2]);
  assert.equal(base.pathname, '/'); assert.equal(base.search, ''); assert.equal(base.hash, '');
  assert.ok(['http://127.0.0.1:8789/','http://127.0.0.1:8790/'].includes(base.href) || base.protocol === 'https:' && base.hostname.endsWith('.trycloudflare.com'));
  const output = path.resolve(root, process.argv[3]);
  assert.ok(output.startsWith(path.join(root, 'audit') + path.sep) || output.startsWith(path.join(root, '.cache', 'apk-downloads') + path.sep));
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'audit/latest-apk-downloads.json'), 'utf8'));
  const page = await fetch(base, { signal: AbortSignal.timeout(30000) });
  assert.equal(page.status, 200); const html = await page.text();
  assert.ok(!html.includes('C:\\Users\\') && !html.includes('EXPO_PUBLIC_'));
  const downloads = await Promise.all(manifest.artifacts.map(async artifact => {
    const name = path.basename(artifact.file);
    assert.ok(['CareConnect-Patient-Latest-1.0.8.apk','CareConnect-Caretaker-Latest-1.0.1.apk'].includes(name));
    assert.ok(html.includes('/' + name));
    const url = new URL(name, base), head = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(30000) });
    assert.equal(head.status, 200); assert.equal(Number(head.headers.get('content-length')), artifact.bytes);
    assert.equal(head.headers.get('content-type'), 'application/vnd.android.package-archive');
    const response = await fetch(url, { signal: AbortSignal.timeout(600000) });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-disposition'), 'attachment; filename="' + name + '"');
    let bytes = 0, lastProgress = 0; const hash = crypto.createHash('sha256');
    for await (const chunk of response.body) {
      bytes += chunk.length; assert.ok(bytes <= artifact.bytes); hash.update(chunk);
      if (bytes - lastProgress >= 16 * 1048576) { lastProgress = bytes; console.log(name + ': ' + Math.floor(bytes / 1048576) + ' MB checked'); }
    }
    const sha256 = hash.digest('hex'); assert.equal(bytes, artifact.bytes); assert.equal(sha256, artifact.sha256);
    console.log(name + ': full download SHA-256 matches');
    return { name, url: url.href, version: artifact.version, bytes, sha256, completeDownloadVerified: true };
  }));
  const blockedRoutes = await Promise.all(['/.env','/audit/latest-apk-downloads.json','/scripts/serve-apk-downloads.cjs','/api/emotions','/dist/apk/','/private-key.json'].map(async route => {
    const response = await fetch(new URL(route, base), { signal: AbortSignal.timeout(30000) });
    assert.equal(response.status, 404); await response.text();
    return { route, status: response.status };
  }));
  const info = { checkedAt: new Date().toISOString(), baseUrl: base.href, downloads, blockedRoutes, allPassed: true };
  fs.writeFileSync(output, JSON.stringify(info, null, 2) + '\n');
  console.log('Both exact APK downloads and all six restricted-route checks passed.');
}
main().catch(error => { console.error('Download verification failed: ' + error.message); process.exitCode = 1; });
