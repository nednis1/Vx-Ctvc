/**
 * Cross-platform Deployment Zip Bundler for VOSCCTV
 * Produces clean, POSIX-path archives prefixed with `cctv-` inside `dist/`.
 * Excludes local secrets (.env), runtime state (camera_names.json, go2rtc.yaml, sessions.json),
 * git metadata, and existing build artifacts.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT_DIR = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');

const RUNTIME_FILES = [
  'server.js',
  'auth-crypto.js',
  'go2rtc-manager.js',
  'directus-client.js',
  'package.json',
  'package-lock.json',
  '.env.example',
  'README.md'
];

const EXCLUDED_NAMES = new Set([
  '.env',
  '.git',
  '.DS_Store',
  'camera_names.json',
  'go2rtc.yaml',
  'sessions.json',
  'dist',
  'AGENTS.md',
  'cctv server issues.md'
]);

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

/**
 * Encode files into a standard ZIP archive with POSIX `/` separators and Unix file modes.
 */
function buildZipBuffer(fileEntries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of fileEntries) {
    const rawData = fs.readFileSync(entry.absPath);
    const deflated = zlib.deflateRawSync(rawData, { level: 6 });
    const useDeflate = deflated.length < rawData.length;
    const method = useDeflate ? 8 : 0;
    const payload = useDeflate ? deflated : rawData;

    const crc = crc32(rawData);
    const { dosTime, dosDate } = toDosTimeDate(entry.mtime);
    const nameBuf = Buffer.from(entry.zipPath, 'utf8');
    const utf8Flag = 0x0800;

    // Local file header (30 bytes + filename)
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

    // Central directory header (46 bytes + filename)
    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE((3 << 8) | 20, 4); // Unix creator + PKZip 2.0 extract
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
    centralHeader.writeUInt32LE((entry.unixMode << 16) >>> 0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(centralHeader, nameBuf);
    offset += localHeader.length + nameBuf.length + payload.length;
  }

  const centralDirBuf = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(fileEntries.length, 8);
  eocd.writeUInt16LE(fileEntries.length, 10);
  eocd.writeUInt32LE(centralDirBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirBuf, eocd]);
}

function collectFilesRecursively(dirPath, relPrefix, outList, filterFn) {
  if (!fs.existsSync(dirPath)) return;
  const items = fs.readdirSync(dirPath).sort();
  for (const name of items) {
    if (EXCLUDED_NAMES.has(name) || name.endsWith('.log') || name.endsWith('.zip')) continue;
    const full = path.join(dirPath, name);
    const stat = fs.lstatSync(full);
    if (stat.isSymbolicLink()) continue;
    const rel = relPrefix ? `${relPrefix}/${name}` : name;
    if (stat.isDirectory()) {
      collectFilesRecursively(full, rel, outList, filterFn);
    } else if (stat.isFile()) {
      if (filterFn && !filterFn(rel, name)) continue;
      const isExec = rel === 'bin/go2rtc_linux_amd64' || rel === 'bin/go2rtc' || rel.endsWith('.sh') || rel.endsWith('.exe');
      outList.push({
        absPath: full,
        zipPath: rel.replace(/\\/g, '/'),
        mtime: stat.mtime,
        unixMode: isExec ? 0o100755 : 0o100644
      });
    }
  }
}

function parseArgs(argv) {
  const opts = { platform: 'all', includeDeps: true, out: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--platform' && argv[i + 1]) {
      opts.platform = argv[++i].toLowerCase();
    } else if (arg === '--no-deps') {
      opts.includeDeps = false;
    } else if (arg === '--out' && argv[i + 1]) {
      opts.out = argv[++i];
    }
  }
  return opts;
}

function getShortGitSha() {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: ROOT_DIR, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch (e) {
    return 'local';
  }
}

function getLocalYmd() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8'));
  const version = pkg.version || '1.0.0';
  const sha = getShortGitSha();
  const ymd = getLocalYmd();

  const platformTag = opts.platform === 'linux' || opts.platform === 'win' ? `-${opts.platform}` : '';
  const defaultFileName = `cctv-vosctv${platformTag}-v${version}-${ymd}-${sha}.zip`;

  let outPath = opts.out ? path.resolve(ROOT_DIR, opts.out) : path.join(DIST_DIR, defaultFileName);
  const outBase = path.basename(outPath);
  if (!outBase.toLowerCase().startsWith('cctv')) {
    outPath = path.join(path.dirname(outPath), `cctv-${outBase}`);
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  const entries = [];

  for (const relFile of RUNTIME_FILES) {
    const abs = path.join(ROOT_DIR, relFile);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
      const stat = fs.statSync(abs);
      entries.push({
        absPath: abs,
        zipPath: relFile,
        mtime: stat.mtime,
        unixMode: 0o100644
      });
    }
  }

  collectFilesRecursively(path.join(ROOT_DIR, 'public'), 'public', entries);

  collectFilesRecursively(path.join(ROOT_DIR, 'bin'), 'bin', entries, (_rel, name) => {
    if (opts.platform === 'linux') return !name.endsWith('.exe');
    if (opts.platform === 'win') return name.endsWith('.exe');
    return true;
  });

  if (opts.includeDeps) {
    collectFilesRecursively(path.join(ROOT_DIR, 'node_modules'), 'node_modules', entries, (rel) => {
      return !rel.startsWith('node_modules/.cache');
    });
  }

  const zipBuf = buildZipBuffer(entries);
  fs.writeFileSync(outPath, zipBuf);

  const mb = (zipBuf.length / (1024 * 1024)).toFixed(2);
  console.log(`[bundle] Created ${path.relative(ROOT_DIR, outPath)} (${entries.length} files, ${mb} MB)`);
}

main();

