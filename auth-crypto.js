/**
 * Cryptographic Password Hashing & Constant-Time Verification Utilities
 * Uses salted Node built-in scrypt (zero external dependencies) and crypto.timingSafeEqual.
 *
 * Hash format:
 *   scrypt$<saltHex>$<derivedHex>
 * Also verifies custom cost format:
 *   scrypt$<N>$<r>$<p>$<saltHex>$<derivedHex>
 */

const crypto = require('crypto');

const DEFAULT_SCRYPT = { N: 16384, r: 8, p: 1 };
const KEYLEN = 64;
const SALT_BYTES = 16;
const MAX_MEM = 64 * 1024 * 1024;

function parseScryptHash(stored) {
  if (typeof stored !== 'string') return null;
  const trimmed = stored.trim();
  if (!trimmed) return null;

  const sep = trimmed.startsWith('scrypt$') ? '$' : (trimmed.startsWith('scrypt:') ? ':' : null);
  if (!sep) return null;

  const parts = trimmed.split(sep);
  if (parts.length === 3) {
    const [, saltHex, hashHex] = parts;
    if (!/^[0-9a-f]+$/i.test(saltHex) || !/^[0-9a-f]+$/i.test(hashHex) || hashHex.length % 2 !== 0) {
      return null;
    }
    return { N: DEFAULT_SCRYPT.N, r: DEFAULT_SCRYPT.r, p: DEFAULT_SCRYPT.p, salt: saltHex, hashHex };
  }

  if (parts.length === 6) {
    const [, nStr, rStr, pStr, saltHex, hashHex] = parts;
    const N = parseInt(nStr, 10);
    const r = parseInt(rStr, 10);
    const p = parseInt(pStr, 10);
    if (
      !Number.isInteger(N) || N < 1024 || N > 1048576 ||
      !Number.isInteger(r) || r < 1 || r > 64 ||
      !Number.isInteger(p) || p < 1 || p > 16 ||
      !/^[0-9a-f]+$/i.test(saltHex) || !/^[0-9a-f]+$/i.test(hashHex) || hashHex.length % 2 !== 0
    ) {
      return null;
    }
    return { N, r, p, salt: saltHex, hashHex };
  }

  return null;
}

function isPasswordHashed(stored) {
  return parseScryptHash(stored) !== null;
}

function hashPasswordSync(plainPassword) {
  if (typeof plainPassword !== 'string' || plainPassword.length === 0) {
    throw new Error('Password must be a non-empty string');
  }
  const salt = crypto.randomBytes(SALT_BYTES).toString('hex');
  const derived = crypto.scryptSync(plainPassword, salt, KEYLEN, {
    ...DEFAULT_SCRYPT,
    maxmem: MAX_MEM
  });
  return `scrypt$${salt}$${derived.toString('hex')}`;
}

function scryptAsync(password, salt, keylen, options) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, keylen, options, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(derivedKey);
    });
  });
}

async function hashPassword(plainPassword) {
  if (typeof plainPassword !== 'string' || plainPassword.length === 0) {
    throw new Error('Password must be a non-empty string');
  }
  const salt = crypto.randomBytes(SALT_BYTES).toString('hex');
  const derived = await scryptAsync(plainPassword, salt, KEYLEN, {
    ...DEFAULT_SCRYPT,
    maxmem: MAX_MEM
  });
  return `scrypt$${salt}$${derived.toString('hex')}`;
}

function timingSafeStringEqual(a, b) {
  const hashA = crypto.createHash('sha256').update(String(a), 'utf8').digest();
  const hashB = crypto.createHash('sha256').update(String(b), 'utf8').digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

/**
 * Verify a plaintext password against either a salted scrypt hash or a legacy plaintext value.
 * All comparisons execute in constant time via crypto.timingSafeEqual.
 */
async function verifyPassword(plainPassword, storedPasswordOrHash) {
  if (
    typeof plainPassword !== 'string' || plainPassword.length === 0 ||
    typeof storedPasswordOrHash !== 'string' || storedPasswordOrHash.length === 0
  ) {
    return false;
  }

  const parsed = parseScryptHash(storedPasswordOrHash);
  if (parsed) {
    try {
      const expectedBuf = Buffer.from(parsed.hashHex, 'hex');
      if (expectedBuf.length < 16) return false;
      const derivedBuf = await scryptAsync(plainPassword, parsed.salt, expectedBuf.length, {
        N: parsed.N,
        r: parsed.r,
        p: parsed.p,
        maxmem: MAX_MEM
      });
      return derivedBuf.length === expectedBuf.length && crypto.timingSafeEqual(derivedBuf, expectedBuf);
    } catch (e) {
      return false;
    }
  }

  // Legacy plaintext compatibility fallback using timing-safe SHA-256 digest comparison
  return timingSafeStringEqual(plainPassword, storedPasswordOrHash);
}

module.exports = {
  hashPassword,
  hashPasswordSync,
  verifyPassword,
  isPasswordHashed
};
