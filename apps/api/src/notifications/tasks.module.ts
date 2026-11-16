import { Injectable, Module, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { Database } from '../core/database';
import { sql } from '../core/database-dialect';
import { WechatService, IdentityModule } from '../identity/identity.module';
import { MediaService, MediaModule } from '../media/media.module';
@Injectable()
export class Tasks implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private queue?: Queue;
  private worker?: Worker;
  private running = false;
  private lastCleanup = 0;
  constructor(
    private db: Database,
    private wechat: WechatService,
    private media: MediaService,
  ) {}
  async onModuleInit() {
    if (process.env.DISABLE_BACKGROUND_TASKS === 'true' && process.env.NODE_ENV !== 'production')
      return;
    if (process.env.TASK_TRANSPORT !== 'database' && process.env.REDIS_URL) {
      const url = new URL(process.env.REDIS_URL);
      const connection = {
        host: url.hostname,
        port: Number(url.port || 6379),
        password: url.password || undefined,
        username: url.username || undefined,
        ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
        maxRetriesPerRequest: null,
      };
      this.queue = new Queue('umeet-outbox', { connection });
      if (process.env.PROCESS_ROLE === 'worker' || process.env.NODE_ENV !== 'production') {
        this.worker = new Worker('umeet-outbox', async (job) => this.process(String(job.data.id)), {
          connection,
          concurrency: 4,
        });
        this.worker.on('error', () => console.error('后台队列连接失败，请检查 Redis'));
      }
    }
    if (process.env.PROCESS_ROLE === 'worker' || process.env.NODE_ENV !== 'production')
      this.timer = setInterval(() => void this.tick(), 1500);
  }
  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      if (Date.now() - this.lastCleanup > 3600000) {
        await this.media.cleanup();
        this.lastCleanup = Date.now();
      }
      // PROCESSING 使用五分钟租约，崩溃后可重新投递。事件持久化在关系型数据库。
      await this.db.outbox.updateMany({
        where: { status: 'PROCESSING', nextAttemptAt: { lt: new Date() } },
        data: { status: 'PENDING' },
      });
      const rows = await this.db.outbox.findMany({
        where: { status: 'PENDING', nextAttemptAt: { lte: new Date() } },
        take: 30,
        orderBy: { createdAt: 'asc' },
      });
      for (const row of rows) {
        if (this.queue)
          await this.queue.add(
            'event',
            { id: row.id },
            { jobId: row.id, removeOnComplete: true, removeOnFail: true },
          );
        else if (process.env.TASK_TRANSPORT === 'database' || process.env.NODE_ENV !== 'production')
          await this.process(row.id);
      }
    } catch {
      console.error('后台事件处理异常，待办记录保留，稍后重试');
    } finally {
      this.running = false;
    }
  }
  async process(id: string) {
    const claimed = await this.db.outbox.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'PROCESSING', nextAttemptAt: new Date(Date.now() + 5 * 60000) },
    });
    if (!claimed.count) return;
    const event = await this.db.outbox.findUniqueOrThrow({ where: { id } });
    const p = event.payload as any;
    try {
      if (event.kind === 'NOTIFY') {
        await this.db.$transaction(async (tx) => {
          const user = await tx.user.findUnique({ where: { id: p.userId } });
          if (user && !user.deletedAt) {
            const notification = await tx.notification.upsert({
              where: { eventId: id },
              create: {
                eventId: id,
                userId: p.userId,
                title: p.title,
                body: p.body,
                postId: p.postId,
              },
              update: {},
            });
            if (
              user.openid &&
              process.env.WECHAT_SUBSCRIBE_TEMPLATE &&
              process.env.WECHAT_SUBSCRIBE_FIELD_MAP &&
              !(await tx.subscriptionDelivery.findUnique({
                where: { notificationId: notification.id },
              }))
            ) {
              const consents = await tx.$queryRaw<
                { id: string }[]
              >(sql`SELECT id FROM "Consent" WHERE "userId"=${user.id} AND "templateId"=${process.env.WECHAT_SUBSCRIBE_TEMPLATE} AND state='accept' ORDER BY "createdAt" DESC LIMIT 1 FOR UPDATE SKIP LOCKED`);
              if (consents[0]) {
                await tx.consent.update({
                  where: { id: consents[0].id },
                  data: { state: 'consumed' },
                });
                const delivery = await tx.subscriptionDelivery.create({
                  data: { notificationId: notification.id, consentId: consents[0].id },
                });
                await tx.outbox.create({
                  data: { kind: 'SEND_SUBSCRIBE', payload: { deliveryId: delivery.id } },
                });
              }
            }
          }
          await tx.outbox.update({ where: { id }, data: { status: 'DONE', error: '' } });
        });
        return;
      }
      if (event.kind === 'SEND_SUBSCRIBE') {
        const delivery = await this.db.subscriptionDelivery.findUniqueOrThrow({
          where: { id: p.deliveryId },
          include: { notification: { include: { user: true } } },
        });
        if (delivery.notification.user.deletedAt) {
          await this.db.subscriptionDelivery.update({
            where: { id: delivery.id },
            data: { status: 'CANCELLED', error: '账号已注销，取消发送' },
          });
        } else if (delivery.status === 'SENDING') {
          await this.db.subscriptionDelivery.update({
            where: { id: delivery.id },
            data: { status: 'UNKNOWN', error: '发送进程中断，结果未知，不自动重发' },
          });
        } else if (delivery.status === 'PENDING') {
          const map = JSON.parse(process.env.WECHAT_SUBSCRIBE_FIELD_MAP || '{}') as Record<
            string,
            string
          >;
          if (!map.title || !map.body || !map.time) throw new Error('订阅模板字段映射未配置');
          const n = delivery.notification,
            token = await this.wechat.accessToken();
          const values = {
            [map.title]: { value: n.title.slice(0, 20) },
            [map.body]: { value: n.body.slice(0, 20) },
            [map.time]: {
              value: new Date(n.createdAt.getTime() + 8 * 3600000)
                .toISOString()
                .slice(0, 16)
                .replace('T', ' '),
            },
          };
          // 发送前持久化 SENDING。超时/崩溃后不自动重发，避免重复外部通知。
          await this.db.subscriptionDelivery.update({
            where: { id: delivery.id },
            data: { status: 'SENDING' },
          });
          try {
            const result = (await (
              await fetch(
                `https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=${token}`,
                {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({
                    touser: n.user.openid,
                    template_id: process.env.WECHAT_SUBSCRIBE_TEMPLATE,
                    page: n.postId
                      ? 'features/detail/index?id=' + n.postId
                      : 'pages/messages/index',
                    data: values,
                  }),
                  signal: AbortSignal.timeout(12000),
                },
              )
            ).json()) as any;
            if (typeof result.errcode !== 'number') throw new Error('响应不明确');
            await this.db.subscriptionDelivery.update({
              where: { id: delivery.id },
              data: {
                status: result.errcode === 0 ? 'SENT' : 'FAILED',
                platformCode: result.errcode,
                error: result.errcode ? '平台拒绝发送，请核验授权与模板' : '',
              },
            });
          } catch {
            await this.db.subscriptionDelivery.update({
              where: { id: delivery.id },
              data: { status: 'UNKNOWN', error: '发送结果未知，保留站内消息，不自动重发' },
            });
          }
        }
      } else if (event.kind === 'MODERATE_POST') {
        const post = await this.db.post.findUnique({
          where: { id: p.id },
          include: { author: true },
        });
        if (post && post.status === 'PENDING' && post.version === p.version) {
          const result = await this.wechat.textCheck(
            post.title + '\n' + post.content,
            post.author.openid || '',
          );
          await this.db.post.updateMany({
            where: { id: post.id, status: 'PENDING', version: p.version },
            data: {
              moderationReason:
                result.suggest === 'risky'
                  ? '文字检查提示风险，请人工复核'
                  : '文字检查完成，等待人工复核文字及图片',
            },
          });
        }
      } else if (event.kind === 'MODERATE_COMMENT') {
        const c = await this.db.comment.findUnique({
          where: { id: p.id },
          include: { author: true },
        });
        if (c?.status === 'PENDING') {
          const result = await this.wechat.textCheck(c.content, c.author.openid || '');
          await this.db.comment.updateMany({
            where: { id: c.id, status: 'PENDING' },
            data: { reason: result.suggest === 'risky' ? '文字检查提示风险' : '等待人工复核' },
          });
        }
      } else throw new Error('未知事件类型');
      await this.db.outbox.update({ where: { id }, data: { status: 'DONE', error: '' } });
    } catch {
      const attempts = event.attempts + 1;
      await this.db.outbox.update({
        where: { id },
        data: {
          attempts,
          status: attempts >= 5 ? 'FAILED' : 'PENDING',
          error: '外部依赖或任务处理失败，请检查配置及服务状态',
          nextAttemptAt: new Date(Date.now() + Math.min(60000 * 2 ** attempts, 3600000)),
        },
      });
    }
  }
  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    while (this.running) await new Promise((resolve) => setTimeout(resolve, 50));
    await this.worker?.close();
    await this.queue?.close();
  }
}
@Module({ imports: [IdentityModule, MediaModule], providers: [Tasks], exports: [Tasks] })
export class TasksModule {}
