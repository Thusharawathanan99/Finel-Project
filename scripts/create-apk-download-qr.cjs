// Generate a real QR code from the verified phone-download URL, without image AI.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const QRCode = require(path.join(root, '5-patient/node_modules/qrcode-terminal/vendor/QRCode'));
const levels = require(path.join(root, '5-patient/node_modules/qrcode-terminal/vendor/QRCode/QRErrorCorrectLevel'));
const info = JSON.parse(fs.readFileSync(path.join(root, 'audit/phone-apk-downloads.json'), 'utf8'));
const url = new URL(info.pageUrl);
if (url.protocol !== 'https:' || !url.hostname.endsWith('.trycloudflare.com') || url.pathname !== '/' || url.search || url.hash) {
  throw new Error('Expected the verified HTTPS download page');
}
const qr = new QRCode(-1, levels.M);
qr.addData(url.href); qr.make();
const count = qr.getModuleCount();
const matrix = Array.from({length: count}, (_, row) => Array.from({length: count}, (_, col) => qr.isDark(row, col)));
fs.writeFileSync(path.join(root, 'audit/phone-apk-qr-matrix.json'), JSON.stringify({url: url.href, quietZone: 4, scale: 8, matrix}));
console.log(`Phone download QR encoded: ${count} × ${count} modules`);
