'use strict';

const argon2 = require('argon2');

// argon2.hash() defaults to argon2id with a random salt per call. The result
// is one string that carries the salt and parameters, so verify() needs
// nothing else and the parameters can be raised later without a migration.
function hashPassword(password) {
  return argon2.hash(password);
}

async function verifyPassword(hash, password) {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false; // malformed hash: treat as a mismatch
  }
}

// Unknown user names still cost one hash verification, so response time does
// not reveal whether an account exists.
let decoyHash = null;
async function spendHashTime(password) {
  decoyHash ??= await argon2.hash('decoy-password-for-timing');
  await verifyPassword(decoyHash, password);
}

module.exports = { hashPassword, verifyPassword, spendHashTime };
