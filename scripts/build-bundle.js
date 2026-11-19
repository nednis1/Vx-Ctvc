/**
 * Redeployment Essentials Zip Bundler for VOSCCTV
 * Packages ONLY the gitignored local files needed when redeploying to another device
 * after `git clone` + `npm install`:
 *   - .env (environment config, credentials, hashed PIN/password)
 *   - camera_names.json (custom camera display aliases, if present)
 *   - DEPLOY.txt (quick redeployment checklist)
 *
 * Output is written to gitignored `dist/cctv-essentials-<date>-<sha>.zip`.
 * Treat the resulting zip as sensitive (contains `.env`) and never commit it to Git.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT_DIR = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');

const ESSENTIAL_FILES = [
  { name: '.env', required: true },
  { name: 'camera_names.json', required: false }
];

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function toDosTimeDate(mtime) {
  const d = mtime instanceof Date ? mtime : new Date();
  const year = Math.max(1980, d.getFullYear());
  const dosTime = ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((d.getSeconds() >> 1) & 0x1f);
  const dosDate = (((year - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0x0f) << 5) | (d.getDate() & 0x1f);
  return { dosTime, dosDate };
}

function buildZipBuffer(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const rawData = entry.buffer;
    const deflated = zlib.deflateRawSync(rawData, { level: 6 });
    const useDeflate = deflated.length < rawData.length;
    const method = useDeflate ? 8 : 0;
    const payload = useDeflate ? deflated : rawData;

    const crc = crc32(rawData);
    const { dosTime, dosDate } = toDosTimeDate(entry.mtime);
    const nameBuf = Buffer.from(entry.zipPath, 'utf8');
    const utf8Flag = 0x0800;

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(utf8Flag, 6);
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(payload.length, 18);
    localHeader.writeUInt32LE(rawData.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, nameBuf, payload);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(0x0314, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(utf8Flag, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(payload.length, 20);
    centralHeader.writeUInt32LE(rawData.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE((((entry.mode || 0o100600) & 0xffff) << 16) >>> 0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(centralHeader, nameBuf);
    offset += localHeader.length + nameBuf.length + payload.length;
  }

  const centralSize = centralParts.reduce((sum, b) => sum + b.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, ...centralParts, eocd]);
}

function getGitShortSha() {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: ROOT_DIR, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString('utf8')
      .trim();
  } catch (e) {
    return 'local';
  }
}

function main() {
  const entries = [];
  const includedNames = [];

  for (const item of ESSENTIAL_FILES) {
    const absPath = path.join(ROOT_DIR, item.name);
    if (!fs.existsSync(absPath)) {
      if (item.required) {
        console.error(`[bundle] Missing required file: ${item.name}`);
        process.exit(1);
      }
      continue;
    }
    const stat = fs.statSync(absPath);
    entries.push({
      zipPath: item.name,
      buffer: fs.readFileSync(absPath),
      mtime: stat.mtime,
      mode: item.name === '.env' ? 0o100600 : 0o100644
    });
    includedNames.push(item.name);
  }

  const deployGuide = [
    'VOSCCTV Redeployment Essentials',
    '===============================',
    '',
    '1. Clone or pull the repository on the target device:',
    '   git clone https://github.com/nednis1/Vx-Ctvc.git && cd Vx-Ctvc',
    '2. Install dependencies:',
    '   npm install',
    '3. Extract this archive into the repository root (copies .env and camera_names.json).',
    '4. On Linux, lock .env permissions:',
    '   chmod 600 .env',
    '5. Start the server:',
    '   npm start',
    ''
  ].join('\n');

  entries.push({
    zipPath: 'DEPLOY.txt',
    buffer: Buffer.from(deployGuide, 'utf8'),
    mtime: new Date(),
    mode: 0o100644
  });
  includedNames.push('DEPLOY.txt');

  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const sha = getGitShortSha();
  const zipName = `cctv-essentials-${stamp}-${sha}.zip`;
  const outPath = path.join(DIST_DIR, zipName);

  fs.mkdirSync(DIST_DIR, { recursive: true });
  const zipBuf = buildZipBuffer(entries);
  fs.writeFileSync(outPath, zipBuf, { mode: 0o600 });

  console.log(`[bundle] Created ${path.relative(ROOT_DIR, outPath)} (${entries.length} files: ${includedNames.join(', ')}; ${(zipBuf.length / 1024).toFixed(2)} KB)`);
}

main();
