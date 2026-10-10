// Check client sources and existing release bundles without displaying secret values.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const envPath = path.join(root, '.env');
const env = fs.existsSync(envPath) ? require('../4-system-engine/api/node_modules/dotenv').parse(fs.readFileSync(envPath)) : {};
const secrets = ['GEMINI_API_KEY', 'GOOGLE_CLOUD_API_KEY'].map(name => env[name]).filter(value => value?.length >= 16 && !/your_|placeholder/i.test(value));
const sourceRoots = ['1-ui-ux/src', '3-prescription-reader/client', '5-patient/src', '6-caretaker/src'];
const releaseRoots = ['1-ui-ux/dist', '5-patient/dist', '6-caretaker/dist'];
const forbidden = /(?:import\.meta\.env|process\.env)\.(?:VITE|EXPO_PUBLIC)_(?:GEMINI_API_KEY|GOOGLE_CLOUD_API_KEY)/;
const issues = [];
let files = 0;
function inspect(directory, source) {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!['node_modules', '.git'].includes(entry.name)) inspect(file, source);
      continue;
    }
    if (!/\.(?:[cm]?js|jsx|tsx?|json|html|map)$/.test(entry.name)) continue;
    files++;
    const contents = fs.readFileSync(file, 'utf8');
    if ((source && forbidden.test(contents)) || secrets.some(value => contents.includes(value))) issues.push(path.relative(root, file));
  }
}
sourceRoots.forEach(directory => inspect(path.join(root, directory), true));
releaseRoots.forEach(directory => inspect(path.join(root, directory), false));
assert.equal(issues.length, 0, `Provider credentials must stay server-side. Rebuild affected releases: ${issues.join(', ')}`);
console.log(`PASS provider credential isolation across ${files} client source/release files; no secret values displayed.`);
