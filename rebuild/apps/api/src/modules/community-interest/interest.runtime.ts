import type { OnApplicationBootstrap, BeforeApplicationShutdown } from '@nestjs/common';
import type { InterestDb } from './common.js';
import { seedInterestBoards } from './common.js';
import { NewsService } from './news.service.js';
import { ForecastsService } from './forecasts.service.js';

export class InterestRuntime implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;
  private active: Promise<void> | undefined;
  constructor(
    readonly db: InterestDb,
    readonly enabled: boolean,
  ) {}
  async onApplicationBootstrap() {
    await seedInterestBoards(this.db);
    if (this.enabled) this.start();
  }
  private start() {
    if (this.stopped) return;
    this.active = this.tick()
      .catch(() => {
        console.error('[interest] 自动任务异常，将在下一轮重试；请检查数据库连接及任务记录');
      })
      .finally(() => {
        this.active = undefined;
        if (!this.stopped) {
          this.timer = setTimeout(() => this.start(), 60000);
          this.timer.unref();
        }
      });
  }
  async tick(now = new Date()) {
    const news = new NewsService(this.db),
      forecasts = new ForecastsService(this.db);
    const due = await this.db
      .selectFrom('interest_sources')
      .select('id')
      .where('enabled', '=', 1)
      .where('approved', '=', 1)
      .where('due_at', '<=', now)
      .orderBy('due_at')
      .limit(3)
      .execute();
    await forecasts.generate(now);
    await forecasts.autoResolve(now);
    for (const source of due) await news.collect(source.id, now);
  }
  async beforeApplicationShutdown() {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.active;
  }
}
