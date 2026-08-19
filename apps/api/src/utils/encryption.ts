import crypto from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function getEncryptionKey(): Buffer {
  const key = process.env.INVENTORY_ENCRYPTION_KEY;
  if (!key) {
    throw new Error('INVENTORY_ENCRYPTION_KEY environment variable is not set');
  }
  return crypto.createHash('sha256').update(key).digest();
}

export function encryptInventoryValue(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final()
  ]);
  
  const authTag = cipher.getAuthTag();
  
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

export function decryptInventoryValue(encryptedData: string): string {
  const key = getEncryptionKey();
  const buffer = Buffer.from(encryptedData, 'base64');
  
  if (buffer.length < IV_LENGTH + TAG_LENGTH) {
    throw new Error('Invalid encrypted data format');
  }
  
  const iv = buffer.subarray(0, IV_LENGTH);
  const authTag = buffer.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const encrypted = buffer.subarray(IV_LENGTH + TAG_LENGTH);
  
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  
  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final()
  ]);
  
  return decrypted.toString('utf8');
}