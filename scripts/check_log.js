const { execSync } = require('child_process');
const https = require('https');
const zlib = require('zlib');
const fs = require('fs');

const info = JSON.parse(execSync('npx eas-cli build:view 3d0d2c21-dc61-414c-9b28-8d78ed22c3bd --json', { cwd: '6-caretaker' }).toString());
const url = info.logFiles[0];

function fetch(u) {
  https.get(u, (res) => {
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      return fetch(res.headers.location);
    }
    const chunks = [];
    res.on('data', chunk => chunks.push(chunk));
    res.on('end', () => {
      const buffer = Buffer.concat(chunks);
      zlib.gunzip(buffer, (err, decompressed) => {
        const text = err ? buffer.toString('utf8') : decompressed.toString('utf8');
        console.log("=== LOG END ===");
        console.log(text.slice(-4000));
        fs.writeFileSync('caretaker_build_error.log', text);
      });
    });
  });
}
fetch(url);
