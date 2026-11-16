/**
 * CLI helper to generate salted scrypt password hashes for .env (DASHBOARD_PASSWORD_HASH)
 * or Directus iot_cctv_credentials records.
 *
 * Usage:
 *   npm run hash-password -- <password>
 *   node scripts/hash-password.js
 */

const readline = require('readline');
const { hashPassword } = require('../auth-crypto');

function promptHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (process.stdin.isTTY) {
      rl._writeToOutput = function _writeToOutput(str) {
        if (!str || str === '\r' || str === '\n' || str === '\r\n' || str.startsWith(question)) {
          process.stdout.write(str);
        } else {
          process.stdout.write('*');
        }
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (process.stdin.isTTY) process.stdout.write('\n');
      resolve(answer);
    });
  });
}

async function main() {
  let plain = process.argv[2];
  if (!plain) {
    plain = await promptHidden('Enter password to hash: ');
  }
  if (!plain || plain.length === 0) {
    console.error('Error: password cannot be empty');
    process.exit(1);
  }
  const hash = await hashPassword(plain);
  console.log(hash);
}

main().catch((err) => {
  console.error('Failed to hash password:', err.message);
  process.exit(1);
});
