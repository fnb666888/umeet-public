import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
  Injectable,
  Module,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Response } from 'express';
import { Database } from '../core/database';
import { sql } from '../core/database-dialect';
import { CurrentUser, Public, Actor, checkAdminScope, requireMember } from '../core/auth';
import { ROOT } from '../core/config';
import { WxcloudCos } from './wxcloud-cos';
@Injectable()
export class MediaService {
  private cos = process.env.STORAGE_PROVIDER === 'wxcloud-cos' ? new WxcloudCos() : null;
  private s3 =
    process.env.STORAGE_PROVIDER === 's3'
      ? new S3Client({
          region: process.env.S3_REGION || 'auto',
          endpoint: process.env.S3_ENDPOINT || undefined,
          credentials: {
            accessKeyId: process.env.S3_ACCESS_KEY!,
            secretAccessKey: process.env.S3_SECRET_KEY!,
          },
          forcePathStyle: true,
        })
      : null;
  constructor(private db: Database) {}
  async upload(user: Actor, file: Express.Multer.File, purpose: string) {
    if (!['POST', 'VERIFICATION'].includes(purpose) || !file)
      throw new BadRequestException('请选择图片及用途');
    const b = file.buffer;
    const mime = b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      ? 'image/png'
      : b[0] === 255 && b[1] === 216 && b[2] === 255
        ? 'image/jpeg'
        : b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP'
          ? 'image/webp'
          : '';
    if (!mime || !b.length) throw new BadRequestException('仅支持 PNG、JPEG 和 WebP 图片');
    const key = randomUUID();
    if (this.s3)
      await this.s3.send(
        new PutObjectCommand({
          Bucket: process.env.S3_BUCKET!,
          Key: key,
          Body: b,
          ContentType: mime,
        }),
      );
    else if (this.cos) await this.cos.put(key, b, mime);
    else {
      await mkdir(path.join(ROOT, '.data/media'), { recursive: true });
      await writeFile(path.join(ROOT, '.data/media', key), b);
    }
    return this.db.media.create({
      data: { userId: user.id, purpose, key, mime, size: b.length },
      select: { id: true, mime: true, size: true },
    });
  }
  async asset(id: string, user?: Actor) {
    const media = await this.db.media.findUnique({ where: { id }, include: { post: true } });
    if (!media) throw new NotFoundException('图片不存在');
    let allowed = user?.id === media.userId;
    if (user?.role === 'PLATFORM_ADMIN') allowed = true;
    if (user?.role === 'SCHOOL_ADMIN') {
      const request = await this.db.verification.findFirst({ where: { materialId: id } });
      const schoolId = media.post?.schoolId || request?.schoolId;
      if (schoolId) {
        checkAdminScope(user, schoolId);
        allowed = true;
      }
    }
    if (!allowed && media.purpose === 'POST' && media.post?.status === 'PUBLISHED' && user) {
      await requireMember(this.db, user, media.post.schoolId);
      allowed = true;
    }
    if (!allowed) throw new ForbiddenException('图片不可访问');
    if (this.s3)
      return {
        url: await getSignedUrl(
          this.s3,
          new GetObjectCommand({ Bucket: process.env.S3_BUCKET!, Key: media.key }),
          { expiresIn: 60 },
        ),
        mime: media.mime,
      };
    return { buffer: this.cos ? await this.cos.get(media.key) : await readFile(path.join(ROOT, '.data/media', media.key)), mime: media.mime };
  }
  async remove(user: Actor, id: string) {
    const media = await this.db.media.findUnique({ where: { id } });
    if (
      !media ||
      media.userId !== user.id ||
      media.postId ||
      (await this.db.verification.count({ where: { materialId: id } }))
    )
      throw new ForbiddenException('图片仍被引用或无删除权限');
    if (this.s3)
      await this.s3.send(
        new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET!, Key: media.key }),
      );
    else if (this.cos) await this.cos.remove(media.key);
    else await unlink(path.join(ROOT, '.data/media', media.key)).catch(() => {});
    await this.db.media.delete({ where: { id } });
    return { ok: true };
  }
  async cleanup() {
    const age = new Date(Date.now() - 86400000);
    const cutoff = new Date(
      Date.now() - Number(process.env.VERIFICATION_RETENTION_DAYS || 7) * 86400000,
    );
    const media = await this.db.$queryRaw<{ id: string; key: string }[]>(sql`
      SELECT m.id, m."key" FROM "Media" m
      WHERE m."postId" IS NULL AND m."createdAt" < ${age}
      AND NOT EXISTS (
        SELECT 1 FROM "Verification" v WHERE v."materialId" = m.id
        AND (v.status = 'PENDING' OR v."reviewedAt" IS NULL OR v."reviewedAt" > ${cutoff})
      )
      ORDER BY m."createdAt" ASC LIMIT 100
    `);
    for (const m of media) {
      await this.db.$transaction(
        async (tx) => {
          await tx.$queryRaw(sql`SELECT id FROM "Media" WHERE id=${m.id} FOR UPDATE`);
          const current = await tx.media.findUnique({ where: { id: m.id } });
          if (!current || current.postId) return;
          const references = await tx.verification.findMany({ where: { materialId: m.id } });
          // 待审核材料及保留期内的材料不会删除。
          if (
            references.some((r) => r.status === 'PENDING' || !r.reviewedAt || r.reviewedAt > cutoff)
          )
            return;
          if (this.s3)
            await this.s3.send(
              new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET!, Key: m.key }),
            );
          else if (this.cos) await this.cos.remove(m.key);
          else
            await unlink(path.join(ROOT, '.data/media', m.key)).catch(
              (e: NodeJS.ErrnoException) => {
                if (e.code !== 'ENOENT') throw e;
              },
            );
          await tx.verification.updateMany({
            where: { materialId: m.id },
            data: { materialId: null },
          });
          await tx.media.deleteMany({ where: { id: m.id, postId: null } });
        },
        { timeout: 15000 },
      );
    }
    await this.db.verification.updateMany({
      where: { method: 'EMAIL', status: 'PENDING', codeExpiresAt: { lt: new Date() } },
      data: { status: 'EXPIRED', codeHash: null },
    });
    await this.db.verification.updateMany({
      where: { method: 'EMAIL', status: { not: 'PENDING' }, createdAt: { lt: cutoff } },
      data: { email: null, codeHash: null },
    });
  }
}
@ApiTags('media')
@ApiBearerAuth()
@Controller('media')
class MediaController {
  constructor(private service: MediaService) {}
  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024, files: 1 } }))
  upload(
    @CurrentUser() user: Actor,
    @UploadedFile() file: Express.Multer.File,
    @Query('purpose') purpose = 'POST',
  ) {
    return this.service.upload(user, file, purpose);
  }
  @Public() @Get(':id') async get(
    @CurrentUser() user: Actor | undefined,
    @Param('id') id: string,
    @Res() response: Response,
  ) {
    const asset = await this.service.asset(id, user);
    response.setHeader('Cache-Control', 'private, no-store');
    if (asset.url) return response.redirect(asset.url);
    return response.type(asset.mime).send(asset.buffer);
  }
  @Delete(':id') remove(@CurrentUser() user: Actor, @Param('id') id: string) {
    return this.service.remove(user, id);
  }
}
@Module({ controllers: [MediaController], providers: [MediaService], exports: [MediaService] })
export class MediaModule {}
