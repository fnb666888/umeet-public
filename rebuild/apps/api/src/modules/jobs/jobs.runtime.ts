import type {
  OnApplicationBootstrap,
  BeforeApplicationShutdown,
  OnApplicationShutdown,
} from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../database/database.types.js';
import { JobsService } from './jobs.service.js';
import { JobsRunner, type JobHandler } from './jobs.runner.js';
export type RuntimeOptions = {
  runJobs?: boolean;
  closeDatabase?: boolean;
  handlers?: ReadonlyMap<string, JobHandler>;
};
export class JobsRuntime
  implements OnApplicationBootstrap, BeforeApplicationShutdown, OnApplicationShutdown
{
  readonly runner: JobsRunner;
  constructor(
    private readonly db: Kysely<Database>,
    private readonly options: RuntimeOptions,
  ) {
    this.runner = new JobsRunner(new JobsService(db), options.handlers ?? new Map());
  }
  onApplicationBootstrap(): void {
    if (this.options.runJobs) this.runner.start();
  }
  async beforeApplicationShutdown(): Promise<void> {
    await this.runner.close();
  }
  async onApplicationShutdown(): Promise<void> {
    if (this.options.closeDatabase) await this.db.destroy();
  }
}
