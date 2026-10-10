// Read bounded PNG/JPEG structure without decoding an untrusted raster in Node.
export const MAX_FACE_IMAGE_BYTES = 6 * 1024 * 1024;
export const MAX_FACE_IMAGE_PIXELS = 16_000_000;
const MAX_DIMENSION = 10_000;
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const invalid = () => { throw new Error('INVALID_IMAGE'); };
const dimensions = (width, height) => {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
      width > MAX_DIMENSION || height > MAX_DIMENSION || width * height > MAX_FACE_IMAGE_PIXELS) invalid();
  return { width, height };
};
const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ value >>> 1 : value >>> 1;
  return value >>> 0;
});
export function pngCRC(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 255] ^ value >>> 8;
  return (value ^ 0xffffffff) >>> 0;
}
function checkOrientation(tiff) {
  if (tiff.length < 8) invalid();
  const endian = tiff.toString('ascii', 0, 2);
  if (!['II', 'MM'].includes(endian)) invalid();
  const short = offset => { if (offset < 0 || offset + 2 > tiff.length) invalid(); return endian === 'II' ? tiff.readUInt16LE(offset) : tiff.readUInt16BE(offset); };
  const integer = offset => { if (offset < 0 || offset + 4 > tiff.length) invalid(); return endian === 'II' ? tiff.readUInt32LE(offset) : tiff.readUInt32BE(offset); };
  if (short(2) !== 42) invalid();
  const offset = integer(4), count = short(offset);
  if (count > 512 || offset + 2 + count * 12 + 4 > tiff.length) invalid();
  for (let index = 0; index < count; index++) {
    const entry = offset + 2 + index * 12;
    if (short(entry) === 0x0112 && (short(entry + 2) !== 3 || integer(entry + 4) !== 1 || short(entry + 8) !== 1)) invalid();
  }
}
function pngDimensions(bytes) {
  let position = 8, size, chunks = 0, hasData = false, dataEnded = false;
  while (position + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(position), type = bytes.toString('ascii', position + 4, position + 8);
    if (++chunks > 4096 || !/^[A-Za-z]{4}$/.test(type) || length > bytes.length - position - 12) invalid();
    const start = position + 8, end = start + length;
    if (pngCRC(bytes.subarray(position + 4, end)) !== bytes.readUInt32BE(end)) invalid();
    if (chunks === 1) {
      if (type !== 'IHDR' || length !== 13) invalid();
      size = dimensions(bytes.readUInt32BE(start), bytes.readUInt32BE(start + 4));
      const depths = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
      if (!depths[bytes[start + 9]]?.includes(bytes[start + 8]) || bytes[start + 10] !== 0 || bytes[start + 11] !== 0 || bytes[start + 12] > 1) invalid();
    } else if (type === 'IHDR' || ['acTL', 'fcTL', 'fdAT'].includes(type)) invalid();
    else if (type === 'IDAT') { if (dataEnded) invalid(); hasData ||= length > 0; }
    else {
      if (hasData) dataEnded = true;
      if (type === 'eXIf') checkOrientation(bytes.subarray(start, end));
      if (type === 'IEND') { if (length || !hasData || end + 4 !== bytes.length) invalid(); return size; }
      if (type[0] === type[0].toUpperCase() && type !== 'PLTE') invalid();
    }
    position = end + 4;
  }
  invalid();
}
function jpegDimensions(bytes) {
  let position = 2, size, scanned = false, segments = 0;
  while (position < bytes.length) {
    if (bytes[position++] !== 0xff) invalid();
    while (bytes[position] === 0xff) position++;
    const marker = bytes[position++];
    if (marker === 0xd9) { if (!size || !scanned || position !== bytes.length) invalid(); return size; }
    if (marker === undefined || marker === 0 || marker === 0xd8 || marker >= 0xd0 && marker <= 0xd7 || ++segments > 4096 || position + 2 > bytes.length) invalid();
    const length = bytes.readUInt16BE(position);
    if (length < 2 || position + length > bytes.length) invalid();
    const start = position + 2, end = position + length;
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      if (size || length < 11 || bytes[start] !== 8 || ![1, 3, 4].includes(bytes[start + 5]) || length !== 8 + bytes[start + 5] * 3) invalid();
      size = dimensions(bytes.readUInt16BE(start + 3), bytes.readUInt16BE(start + 1));
    } else if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) invalid();
    if (marker === 0xe1 && bytes.toString('ascii', start, start + 6) === 'Exif\0\0') checkOrientation(bytes.subarray(start + 6, end));
    position = end;
    if (marker === 0xda) {
      if (!size || length < 6 || length !== 6 + bytes[start] * 2 || bytes[start] < 1 || bytes[start] > 4) invalid();
      scanned = true;
      while (position < bytes.length) {
        if (bytes[position] !== 0xff) { position++; continue; }
        const boundary = position;
        while (bytes[position] === 0xff) position++;
        const code = bytes[position];
        if (code === 0 || code >= 0xd0 && code <= 0xd7) { position++; continue; }
        position = boundary; break;
      }
    }
  }
  invalid();
}
export function validateFaceImage(image) {
  if (typeof image !== 'string' || !image || image.length > Math.ceil(MAX_FACE_IMAGE_BYTES / 3) * 4 + 40) invalid();
  const match = /^data:(image\/(?:png|jpeg));base64,([\s\S]+)$/.exec(image);
  const content = match ? match[2] : image;
  if (!content || content.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(content)) invalid();
  const bytes = Buffer.from(content, 'base64');
  if (!bytes.length || bytes.length > MAX_FACE_IMAGE_BYTES || bytes.toString('base64') !== content) invalid();
  let size, mimeType;
  if (bytes.length >= 33 && bytes.subarray(0, 8).equals(signature)) { size = pngDimensions(bytes); mimeType = 'image/png'; }
  else if (bytes.length >= 16 && bytes[0] === 0xff && bytes[1] === 0xd8) { size = jpegDimensions(bytes); mimeType = 'image/jpeg'; }
  else invalid();
  if (match && match[1] !== mimeType) invalid();
  return { ...size, mimeType, content };
}
