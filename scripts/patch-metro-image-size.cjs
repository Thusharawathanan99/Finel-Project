// Metro 0.83 passes a filename to image-size. The patched image-size 2 API accepts bytes.
// Keep this narrow compatibility change reproducible after npm ci, without changing Metro's asset output.
const fs = require('node:fs');
const path = require('node:path');
const moduleRoot = path.resolve(process.argv[2] || process.cwd());
const projectRoot = path.resolve(__dirname, '..');
if (!['5-patient', '6-caretaker'].some(name => moduleRoot === path.join(projectRoot, name))) throw new Error('Expected a CareConnect mobile module.');
const packageFile = path.join(moduleRoot, 'node_modules', 'image-size', 'package.json');
const version = JSON.parse(fs.readFileSync(packageFile, 'utf8')).version;
if (version !== '2.0.4') throw new Error('Review the Metro asset compatibility patch before changing image-size.');
const target = path.join(moduleRoot, 'node_modules', 'metro', 'src', 'Assets.js');
const oldCall = '(0, _imageSize.default)(isImageInput)';
const adaptedCall = '(0, _imageSize.default)(typeof isImageInput === "string" ? _fs.default.readFileSync(isImageInput) : isImageInput)';
const source = fs.readFileSync(target, 'utf8');
if (source.includes(adaptedCall)) { console.log('Metro asset compatibility is current.'); process.exit(0); }
if (source.split(oldCall).length !== 2 || !source.includes('var _fs = _interopRequireDefault(require("fs"))')) throw new Error('Metro changed; review its asset API before applying compatibility.');
fs.writeFileSync(target, source.replace(oldCall, adaptedCall));
console.log('Metro now supplies image bytes to the patched image-size API.');
