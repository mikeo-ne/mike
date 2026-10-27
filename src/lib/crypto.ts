/**
 * Symmetric encryption + request signing for stored OAuth credentials.
 * Server-only. Key: TOKEN_ENCRYPTION_KEY (32 bytes, hex or base64).
 */
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

function keyBytes(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY?.trim();
  if (!raw) {
    throw new Error(
      'TOKEN_ENCRYPTION_KEY is not configured. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
  }
  let buf: Buffer;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    buf = Buffer.from(raw, 'hex');
  } else {
    try {
      buf = Buffer.from(raw, 'base64');
    } catch {
      throw new Error(
        'TOKEN_ENCRYPTION_KEY must be 32 bytes encoded as hex (64 chars) or base64.',
      );
    }
  }
  if (buf.length !== 32) {
    throw new Error(
      'TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes.',
    );
  }
  return buf;
}

/** AES-256-GCM encrypt. Returns "v1.<iv>.<ciphertext>.<tag>" (base64url). */
export function encryptSecret(plaintext: string): string {
  const key = keyBytes();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  return `v1.${iv.toString('base64url')}.${ct.toString('base64url')}.${cipher
    .getAuthTag()
    .toString('base64url')}`;
}

export function decryptSecret(blob: string): string {
  const key = keyBytes();
  const [version, ivB64, ctB64, tagB64] = blob.split('.');
  if (version !== 'v1' || !ivB64 || !ctB64 || !tagB64) {
    throw new Error('Unrecognized encrypted payload.');
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(ivB64, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

/** HMAC-SHA256 signature for OAuth state payloads. */
export function signState(payload: string): string {
  return createHmac('sha256', keyBytes()).update(payload).digest('base64url');
}

export function verifyState(payload: string, signature: string): boolean {
  const expected = Buffer.from(signState(payload), 'utf8');
  const actual = Buffer.from(signature, 'utf8');
  return (
    expected.length === actual.length && timingSafeEqual(expected, actual)
  );
}
