import { createCipheriv, randomBytes } from 'node:crypto';

/** Envelope v1: 12-byte nonce | 16-byte authentication tag | ciphertext. */
export function encryptRut(rut: string): { ciphertext: Buffer; keyVersion: number } {
  const version = process.env.RUT_ENCRYPTION_KEY_VERSION;
  if (!version || !/^[1-9]\d*$/.test(version) || Number(version) > 2147483647) {
    throw new Error('Invalid RUT encryption configuration');
  }
  const encoded = process.env[`RUT_ENCRYPTION_KEY_V${version}`];
  const key = Buffer.from(encoded ?? '', 'base64');
  if (key.length !== 32 || key.toString('base64') !== encoded) {
    throw new Error('Invalid RUT encryption configuration');
  }
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(`exdev:postulaciones:rut:v${version}`));
  const ciphertext = Buffer.concat([cipher.update(rut, 'utf8'), cipher.final()]);
  return {
    ciphertext: Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]),
    keyVersion: Number(version),
  };
}

export function normalizeRut(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 20) return null;
  const rut = value.trim().replace(/\./g, '').toUpperCase();
  if (!/^[0-9]{1,8}-[0-9K]$/.test(rut)) return null;
  const [digits, verifier] = rut.split('-');
  if (Number(digits) === 0) return null;
  let sum = 0;
  let factor = 2;
  for (let i = digits.length - 1; i >= 0; i--) {
    sum += Number(digits[i]) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const remainder = 11 - (sum % 11);
  const expected = remainder === 11 ? '0' : remainder === 10 ? 'K' : String(remainder);
  return verifier === expected ? `${Number(digits)}-${verifier}` : null;
}
