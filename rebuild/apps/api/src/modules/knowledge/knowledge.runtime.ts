import type { OnApplicationBootstrap, BeforeApplicationShutdown } from '@nestjs/common';
import type { KnowledgeDb } from './knowledge-core.js';
import { KnowledgeNotificationsService } from './knowledge-notifications.service.js';
export class KnowledgeRuntime implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<void> | undefined;
  private stopped = false;
  constructor(
    private readonly db: KnowledgeDb,
    private readonly enabled: boolean,
  ) {}
  onApplicationBootstrap() {
    if (this.enabled) this.schedule(0);
  }
  private schedule(delay: number) {
    this.timer = setTimeout(() => {
      this.running = this.tick();
    }, delay);
    this.timer.unref();
  }
  private async tick() {
    try {
      await new KnowledgeNotificationsService(this.db).deliverPending();
    } catch (error) {
      console.error('Knowledge notification delivery failed; retained for retry', error);
    } finally {
      if (!this.stopped) this.schedule(15000);
    }
  }
  async beforeApplicationShutdown() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    await this.running;
  }
}
