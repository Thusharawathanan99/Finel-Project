'use strict';

const http = require('node:http');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { pipeline } = require('node:stream');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const APPS = Object.freeze([
  Object.freeze({ file: 'CareConnect-Patient-Latest-1.0.8.apk', name: 'Patient', version: '1.0.8', versionCode: 9, package: 'com.careconnect.patient.preview', description: 'Live expressions, experimental movement observations and patient-reported symptom assistance', symbol: 'P' }),
  Object.freeze({ file: 'CareConnect-Caretaker-Latest-1.0.1.apk', name: 'Caretaker', version: '1.0.1', versionCode: 2, package: 'com.careconnect.caretaker.preview', description: 'Caregiver dashboard and patient updates', symbol: 'C' }),
]);

function samePath(a, b) {
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

async function digestHandle(handle) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of handle.createReadStream({ start: 0, autoClose: false })) hash.update(chunk);
  return hash.digest('hex');
}

function rangeFor(header, size) {
  if (!header) return null;
  if (typeof header !== 'string' || !/^bytes=\d*-\d*$/.test(header)) return false;
  const [left, right] = header.slice(6).split('-');
  if (!left && !right) return false;
  const a = left ? Number(left) : null;
  const b = right ? Number(right) : null;
  if ((a !== null && !Number.isSafeInteger(a)) || (b !== null && !Number.isSafeInteger(b))) return false;
  if (a === null) {
    if (b <= 0) return false;
    return { start: Math.max(0, size - b), end: size - 1 };
  }
  if (a >= size || (b !== null && b < a)) return false;
  return { start: a, end: b === null ? size - 1 : Math.min(b, size - 1) };
}

function landingPage(downloads) {
  const cards = downloads.map(({ app, bytes }) => `<article class="app"><div class="icon">${app.symbol}</div><div><h2>CareConnect ${app.name} Latest</h2><p>${app.description}</p><div class="meta">Version ${app.version} &middot; ${(bytes / 1048576).toFixed(1)} MB &middot; Android APK</div></div><a class="download" href="/${app.file}" download>Download ${app.name} ${app.version} <span aria-hidden="true">&darr;</span></a></article>`).join('');
  const patientVersion = downloads.find(({ app }) => app.name === 'Patient').app.version;
  return Buffer.from(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CareConnect app downloads</title><style>
html{color-scheme:dark}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(ellipse at top left,#172e47 0,transparent 60%),#080f1c;color:#eef4fb;font:16px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;padding:36px 20px}main{max-width:850px;margin:auto}.brand{color:#6be4d7;letter-spacing:.14em;font-size:12px;font-weight:800}h1{font-size:clamp(32px,7vw,48px);line-height:1.12;margin:16px 0}header p{color:#aabbd0;max-width:550px}.apps{display:grid;gap:18px;margin:30px 0}.app{display:grid;grid-template-columns:60px 1fr;gap:16px;border:1px solid #2b4059;border-radius:22px;padding:25px;background:#111e30}.icon{width:60px;height:60px;display:grid;place-items:center;border-radius:18px;background:#204251;color:#81f0df;font-size:28px;font-weight:750}h2{font-size:22px;margin:0 0 6px}.app p{color:#b9c8db;margin:0}.meta{font-size:13px;color:#8aa1bd;margin-top:10px}.download{grid-column:1/-1;display:flex;justify-content:space-between;border-radius:13px;background:#68dfce;color:#06221e;text-decoration:none;padding:15px 18px;font-weight:750}.download:hover{background:#94eddf}.identify{border:2px solid #68dfce;border-radius:22px;padding:24px;background:#102c2d;margin-top:28px}.identify h2{color:#9af3e5}.identify p{color:#c8dedc;margin:12px 0}.screen-check{border-radius:12px;background:#071c20;padding:16px;margin:18px 0}.screen-check strong{display:block;font-size:20px;color:#f0fffc}.screen-check span{display:block;color:#9af3e5;margin-top:5px}.identify details{border-top:1px solid #355b5a;padding-top:14px;margin-top:14px}.identify summary{cursor:pointer;font-weight:750;color:#baf7e9}.identify li{margin:5px 0;overflow-wrap:anywhere}.note{color:#aabbd0;font-size:14px;border-left:3px solid #405773;padding-left:16px}.note strong{color:#dae7f5}ol{padding-left:24px}li{padding:3px 0}footer{color:#7d93b0;font-size:12px;margin-top:24px}@media(min-width:700px){.apps{grid-template-columns:1fr 1fr}.app{grid-template-columns:1fr}.download{margin-top:8px}}
</style></head><body><main><header><div class="brand">CARECONNECT</div><h1>Your care. Connected.</h1><p>Download the latest Patient and Caretaker apps directly to your Android phone.</p></header>
<section class="identify" aria-labelledby="latest-face-title"><h2 id="latest-face-title">Open the updated patient app</h2><p>After installation, open <strong>CareConnect Patient Latest</strong>. It is a separate app from the original <strong>CareConnect Patient</strong>; both can remain on your phone.</p><div class="screen-check"><strong>Face analysis studio</strong><span>App version: ${patientVersion}</span></div><ol><li>Download Patient ${patientVersion} below, open the downloaded APK and tap <strong>Install</strong>.</li><li>When installation finishes, tap <strong>Open</strong>, or choose <strong>CareConnect Patient Latest</strong> from your phone's app list.</li><li>Sign in, then select <strong>Wellness → Live Face Detection</strong>.</li><li>Check the face screen's title and version shown above. If it says <strong>Live Emotion Radar</strong>, you have opened an earlier app or build; open <strong>CareConnect Patient Latest</strong>.</li></ol>
<details lang="ta"><summary>தமிழ் · புதிய முக ஆய்வுத் திரையைத் திறக்க</summary><ol><li>கீழே உள்ள Patient ${patientVersion} APK-ஐப் பதிவிறக்கி, அதைத் திறந்து <strong>Install</strong> என்பதைத் தட்டுங்கள்.</li><li>நிறுவியதும் <strong>Open</strong> என்பதைத் தட்டுங்கள். அல்லது உங்கள் கைப்பேசியின் செயலிப் பட்டியலில் <strong>CareConnect Patient Latest</strong> என்பதைத் திறக்கவும். பழைய <strong>CareConnect Patient</strong> தனியாக இருக்கும்.</li><li>உள்நுழைந்து, <strong>Wellness → Live Face Detection</strong> என்பதைத் திறக்கவும்.</li><li>தலைப்பு <strong>முக ஆய்வு மையம்</strong> என்றும், <strong>செயலி பதிப்பு: ${patientVersion}</strong> என்றும் இருக்க வேண்டும். மொழி English என்றால் <strong>Face analysis studio</strong> என்று தெரியும்.</li><li><strong>Live Emotion Radar</strong> என்று தெரிந்தால் பழைய செயலி அல்லது பழைய பதிப்பைத் திறந்துள்ளீர்கள். <strong>CareConnect Patient Latest</strong> என்பதைத் திறக்கவும்.</li></ol></details>
<details lang="si"><summary>සිංහල · නව මුහුණු විශ්ලේෂණ තිරය විවෘත කරන්න</summary><ol><li>පහත Patient ${patientVersion} APK ගොනුව බාගත කර, එය විවෘත කර <strong>Install</strong> තට්ටු කරන්න.</li><li>ස්ථාපනය අවසන් වූ විට <strong>Open</strong> තට්ටු කරන්න. නැතහොත් දුරකථනයේ යෙදුම් ලැයිස්තුවෙන් <strong>CareConnect Patient Latest</strong> විවෘත කරන්න. පැරණි <strong>CareConnect Patient</strong> වෙනම යෙදුමක් ලෙස පවතී.</li><li>පිවිසී, <strong>Wellness → Live Face Detection</strong> තෝරන්න.</li><li>තිරයේ නම <strong>මුහුණු විශ්ලේෂණ මධ්‍යස්ථානය</strong> සහ <strong>යෙදුම් අනුවාදය: ${patientVersion}</strong> පෙන්විය යුතුය. English භාෂාව තෝරා ඇත්නම් <strong>Face analysis studio</strong> පෙන්වයි.</li><li><strong>Live Emotion Radar</strong> පෙන්වන්නේ නම් ඔබ විවෘත කර ඇත්තේ පැරණි යෙදුමක් හෝ අනුවාදයකි. <strong>CareConnect Patient Latest</strong> විවෘත කරන්න.</li></ol></details></section>
<section class="apps" aria-label="Android app downloads">${cards}</section><div class="note"><strong>Preview apps for testing</strong><p>These apps use local test signing and install separately from previous CareConnect apps.</p><ol><li>Choose your app above and download the APK.</li><li>Open it from your phone's Downloads folder.</li><li>If Android asks, allow this browser to install this APK, then tap <strong>Install</strong>.</li><li>After installation, tap <strong>Open</strong>. For the patient app, choose <strong>CareConnect Patient Latest</strong> and check the face screen using the instructions above.</li></ol><p>This temporary download link works while the laptop connection stays active.</p></div><footer>Android phones only &middot; Verified download files</footer></main></body></html>`, 'utf8');
}

/** Verify both APKs first; returned server exposes no arbitrary files or directories. */
async function createApkDownloadServer({
  manifestPath = path.join(PROJECT_ROOT, 'audit', 'latest-apk-downloads.json'),
  apkDirectory = path.join(PROJECT_ROOT, 'dist', 'apk'),
} = {}) {
  const manifestStat = await fsp.stat(manifestPath);
  if (!manifestStat.isFile() || manifestStat.size > 65536) throw new Error('Invalid APK manifest.');
  const manifest = JSON.parse(await fsp.readFile(manifestPath, 'utf8'));
  if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length !== APPS.length) throw new Error('Manifest must contain exactly the two approved APKs.');
  const apkRoot = await fsp.realpath(apkDirectory);
  const downloads = [];
  try {
    const seen = new Set();
    for (const artifact of manifest.artifacts) {
      if (!artifact || typeof artifact.file !== 'string' || !path.isAbsolute(artifact.file)) throw new Error('Invalid APK path.');
      const basename = path.basename(artifact.file);
      const app = APPS.find((candidate) => candidate.file === basename);
      if (!app || seen.has(basename)) throw new Error('Unapproved or duplicate APK.');
      seen.add(basename);
      if (artifact.version !== app.version || artifact.versionCode !== app.versionCode || artifact.package !== app.package) throw new Error('APK identity does not match the approved release.');
      if (!Number.isSafeInteger(artifact.bytes) || artifact.bytes <= 0 || !/^[a-f0-9]{64}$/.test(artifact.sha256 || '')) throw new Error('Invalid APK verification metadata.');
      const expectedFile = path.join(apkRoot, app.file);
      const resolvedFile = await fsp.realpath(artifact.file);
      if (!samePath(resolvedFile, expectedFile)) throw new Error('APK must be a direct file in the approved download directory.');
      const handle = await fsp.open(resolvedFile, 'r');
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size !== artifact.bytes) throw new Error('APK size verification failed.');
        if (await digestHandle(handle) !== artifact.sha256) throw new Error('APK SHA-256 verification failed.');
        downloads.push({ app, path: resolvedFile, bytes: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs, sha256: artifact.sha256 });
      } finally {
        await handle.close();
      }
    }
  } catch (error) {
    throw error;
  }

  downloads.sort((a, b) => APPS.indexOf(a.app) - APPS.indexOf(b.app));
  const page = landingPage(downloads);
  const routes = new Map(downloads.map((item) => [`/${item.app.file}`, item]));
  const commonHeaders = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow' };

  function reply(req, res, status, message, headers = {}) {
    const body = Buffer.from(message, 'utf8');
    res.writeHead(status, { ...commonHeaders, 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': body.length, ...headers });
    res.end(req.method === 'HEAD' ? undefined : body);
  }

  const server = http.createServer(async (req, res) => {
    let requestHandle;
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') return reply(req, res, 405, 'Method not allowed.\n', { Allow: 'GET, HEAD' });
      let requestPath;
      try {
        if (typeof req.url !== 'string' || !req.url.startsWith('/') || req.url.startsWith('//')) throw new Error();
        // Decode without URL path normalization: encoded traversal never becomes an allowed APK route.
        requestPath = decodeURIComponent(req.url.split('?')[0]);
      } catch { return reply(req, res, 400, 'Invalid request URL.\n'); }

      if (requestPath === '/') {
        res.writeHead(200, { ...commonHeaders, 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': page.length, 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" });
        return res.end(req.method === 'HEAD' ? undefined : page);
      }
      const download = routes.get(requestPath);
      if (!download) return reply(req, res, 404, 'Download not found.\n');
      // Recheck the fixed approved file path; each request owns its own descriptor.
      const resolvedFile = await fsp.realpath(download.path);
      if (!samePath(resolvedFile, download.path)) return reply(req, res, 503, 'This download changed. Please restart the verified download server.\n');
      requestHandle = await fsp.open(resolvedFile, 'r');
      const stat = await requestHandle.stat();
      if (stat.size !== download.bytes || stat.mtimeMs !== download.mtimeMs || stat.ctimeMs !== download.ctimeMs) return reply(req, res, 503, 'This download changed. Please restart the verified download server.\n');
      const range = rangeFor(req.headers.range, download.bytes);
      if (range === false) return reply(req, res, 416, 'Requested range is not available.\n', { 'Content-Range': `bytes */${download.bytes}`, 'Accept-Ranges': 'bytes' });
      const start = range ? range.start : 0;
      const end = range ? range.end : download.bytes - 1;
      const headers = { ...commonHeaders, 'Content-Type': 'application/vnd.android.package-archive', 'Content-Disposition': `attachment; filename="${download.app.file}"`, 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes', ETag: `"sha256-${download.sha256}"` };
      if (range) headers['Content-Range'] = `bytes ${start}-${end}/${download.bytes}`;
      if (res.destroyed) return;
      res.writeHead(range ? 206 : 200, headers);
      if (req.method === 'HEAD') return res.end();
      const stream = requestHandle.createReadStream({ autoClose: true, start, end });
      requestHandle = undefined;
      // An aborted download closes only this request's descriptor, never a later download's descriptor.
      pipeline(stream, res, (error) => { if (error && !res.destroyed) res.destroy(); });
    } catch {
      if (res.headersSent) res.destroy();
      else reply(req, res, 503, 'The download is temporarily unavailable.\n');
    } finally {
      if (requestHandle) await requestHandle.close().catch(() => {});
    }
  });
  server.on('clientError', (_error, socket) => { if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); });
  return server;
}

module.exports = { createApkDownloadServer };

if (require.main === module) {
  (async () => {
    const args = process.argv.slice(2);
    let port = 8789;
    if (args.length) {
      if (args.length !== 2 || args[0] !== '--port' || !/^\d+$/.test(args[1])) throw new Error('Usage: node scripts/serve-apk-downloads.cjs [--port 8789]');
      port = Number(args[1]);
    }
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid localhost port.');
    const server = await createApkDownloadServer();
    server.listen(port, '127.0.0.1', () => console.log(`Verified CareConnect APK downloads: http://127.0.0.1:${port}`));
    server.on('error', (error) => { console.error(`Download server could not start (${error.code || 'error'}).`); process.exitCode = 1; server.close(); });
    const stop = () => server.close(() => process.exit(0));
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  })().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
