import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';

/**
 * Application-owned media storage for game logos, banner artwork, package
 * icons and any other admin-uploaded image.
 *
 * Design contract (deliberately boring):
 * - Uploads are written to PERMANENT server-owned storage (a plain directory
 *   on disk) and registered in the MediaAsset table. They never expire.
 * - The public URL stored on records is the stable relative path
 *   `/api/media/<filename>`. It is origin-agnostic (works through the Mini
 *   App's same-origin proxy and against the API directly), survives restarts,
 *   deployments and CDN behavior, and is NEVER rewritten automatically.
 * - NOTHING in this service deletes or mutates anything automatically. The
 *   only deletion path is an explicit admin call to deleteById(), which
 *   REFUSES while any record still references the file.
 * - Filenames are server-generated UUIDs; client input can never influence
 *   the path written to disk (no traversal, no extension spoofing: the
 *   extension comes from sniffed magic bytes, not from the submitted name).
 */

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB — generous for logos/banners.

/** Sniffed signature → canonical mime type + file extension. */
const IMAGE_SIGNATURES: Array<{ mime: string; ext: string; test: (b: Buffer) => boolean }> = [
  { mime: 'image/png', ext: 'png', test: (b) => b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/jpeg', ext: 'jpg', test: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/gif', ext: 'gif', test: (b) => b.length >= 6 && b.subarray(0, 3).toString('latin1') === 'GIF' },
  // RIFF....WEBP
  { mime: 'image/webp', ext: 'webp', test: (b) => b.length >= 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' }
];

export interface SavedMediaAsset {
  id: string;
  filename: string;
  url: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
}

export type MediaDeleteOutcome = 'DELETED' | 'NOT_FOUND' | 'REFERENCED' | 'FILE_MISSING';

/** Tables/columns that may reference a media URL (used ONLY by explicit deletes). */
const REFERENCE_FIELDS: Array<{ model: keyof PrismaClient & string; column: string; label: string }> = [
  { model: 'topUpGame', column: 'imageUrl', label: 'game image' },
  { model: 'banner', column: 'imageUrl', label: 'banner image' },
  { model: 'category', column: 'imageUrl', label: 'category image' },
  { model: 'product', column: 'imageUrl', label: 'product image' },
  { model: 'topUpPackage', column: 'imageUrl', label: 'package image' },
  { model: 'topUpPackage', column: 'icon', label: 'package icon' }
];

export function isManagedMediaUrl(url: string | null | undefined): boolean {
  return typeof url === 'string' && url.startsWith('/api/media/');
}

function extractFilenameFromUrl(url: string): string | null {
  const prefix = '/api/media/';
  if (!url.startsWith(prefix)) return null;
  const rest = url.slice(prefix.length);
  // Strict shape: UUID + known extension. Anything else was not written by us.
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:png|jpg|gif|webp)$/.test(rest)
    ? rest
    : null;
}

export class MediaService {
  constructor(private prisma: PrismaClient) {}

  /** Permanent storage directory (created lazily, safe to call often). */
  private async ensureStorageDir(): Promise<string> {
    const configured = process.env.MEDIA_STORAGE_DIR?.trim();
    const dir = configured && configured.length > 0
      ? path.resolve(configured)
      : path.resolve(process.cwd(), 'uploads', 'media');
    await fsp.mkdir(dir, { recursive: true });
    return dir;
  }

  /**
   * Persist a base64-encoded image as a permanent owned asset.
   * Throws a customer-safe Error when the payload is not a supported image
   * or exceeds the size limit. Never trusts the client-provided filename.
   */
  async saveFromBase64(input: { dataBase64: string; adminId?: string | null }): Promise<SavedMediaAsset> {
    if (typeof input.dataBase64 !== 'string' || input.dataBase64.trim() === '') {
      throw new Error('Image data is required');
    }

    let buffer: Buffer;
    try {
      buffer = Buffer.from(input.dataBase64, 'base64');
    } catch {
      throw new Error('Invalid image data');
    }
    if (buffer.length === 0) throw new Error('Image data is empty');
    if (buffer.length > MAX_IMAGE_BYTES) throw new Error('Image is too large (maximum 5 MB)');

    const signature = IMAGE_SIGNATURES.find((candidate) => candidate.test(buffer));
    if (!signature) {
      throw new Error('Unsupported image format. Use PNG, JPEG, GIF or WebP.');
    }

    const dir = await this.ensureStorageDir();
    const filename = `${randomUUID()}.${signature.ext}`;
    const tmpPath = path.join(dir, `${filename}.tmp`);
    const finalPath = path.join(dir, filename);

    // Atomic write: temp file + rename so a crash can never leave a partial asset.
    await fsp.writeFile(tmpPath, buffer);
    await fsp.rename(tmpPath, finalPath);

    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');

    try {
      const asset = await this.prisma.mediaAsset.create({
        data: {
          filename,
          mimeType: signature.mime,
          sizeBytes: buffer.length,
          sha256,
          createdByAdminId: input.adminId ?? null
        }
      });
      return {
        id: asset.id,
        filename,
        url: `/api/media/${filename}`,
        mimeType: signature.mime,
        sizeBytes: buffer.length,
        sha256
      };
    } catch (error) {
      // Registration failed → do not leave an orphan file behind.
      await fsp.unlink(finalPath).catch(() => undefined);
      throw error;
    }
  }

  /**
   * Resolve a served filename to its absolute path + content type.
   * Returns null unless the strict filename shape AND the registry agree —
   * this makes the read endpoint incapable of serving arbitrary files.
   */
  async resolveForServe(filename: string): Promise<{ absolutePath: string; mimeType: string } | null> {
    if (!extractFilenameFromUrl(`/api/media/${filename}`)) return null;

    const asset = await this.prisma.mediaAsset.findUnique({ where: { filename } });
    if (!asset) return null;

    const dir = await this.ensureStorageDir();
    const absolutePath = path.join(dir, filename);
    try {
      const stat = await fsp.stat(absolutePath);
      if (!stat.isFile()) return null;
    } catch {
      return null;
    }
    return { absolutePath, mimeType: asset.mimeType };
  }

  listAssets(options: { page: number; pageSize: number }) {
    return this.prisma.mediaAsset.findMany({
      orderBy: { createdAt: 'desc' },
      skip: (options.page - 1) * options.pageSize,
      take: options.pageSize
    });
  }

  countAssets(): Promise<number> {
    return this.prisma.mediaAsset.count();
  }

  /**
   * EXPLICIT-ONLY deletion. Refuses while any game/banner/category/product/
   * package still references the file, so an admin can never break a live
   * record by deleting its artwork out from under it.
   */
  async deleteById(id: string): Promise<{ outcome: MediaDeleteOutcome; references?: string[] }> {
    const asset = await this.prisma.mediaAsset.findUnique({ where: { id } });
    if (!asset) return { outcome: 'NOT_FOUND' };

    const references: string[] = [];
    for (const field of REFERENCE_FIELDS) {
      const delegate = (this.prisma as unknown as Record<string, { count: (args: unknown) => Promise<number> } | undefined>)[field.model];
      if (!delegate) continue;
      const count = await delegate.count({
        where: { [field.column]: { endsWith: `/${asset.filename}` } }
      });
      if (count > 0) references.push(`${field.label} x${count}`);
    }
    if (references.length > 0) {
      return { outcome: 'REFERENCED', references };
    }

    const dir = await this.ensureStorageDir();
    try {
      await fsp.unlink(path.join(dir, asset.filename));
    } catch {
      // File already gone — still remove the registry row below.
      return { outcome: 'FILE_MISSING' };
    }
    await this.prisma.mediaAsset.delete({ where: { id } });
    return { outcome: 'DELETED' };
  }
}
