import { createHash, randomBytes } from 'node:crypto';

/** Returns a URL-safe random token and the hash that is stored. Raw tokens are never persisted. */
export function newToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
