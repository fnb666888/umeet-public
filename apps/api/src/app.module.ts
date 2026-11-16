import './core/config';
import { Module, Controller, Get } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { DatabaseModule, Database } from './core/database';
import { AccessGuard, RateGuard, Public } from './core/auth';
import { IdentityModule } from './identity/identity.module';
import { ContentModule } from './content/content.module';
import { MediaModule } from './media/media.module';
import { OperationsModule } from './operations/operations.module';
import { TasksModule } from './notifications/tasks.module';
@Controller()
class HealthController {
  constructor(private db: Database) {}
  @Public() @Get('health') async health() {
    await this.db.$queryRaw`SELECT 1`;
    return {
      status: 'ok',
      name: 'Umeet',
      version: '0.1.0',
      demo: process.env.NODE_ENV !== 'production' && process.env.DEMO_MODE === 'true',
    };
  }
  @Public() @Get('config') config() {
    return {
      demo: process.env.NODE_ENV !== 'production' && process.env.DEMO_MODE === 'true',
      subscribeTemplate: process.env.WECHAT_SUBSCRIBE_FIELD_MAP
        ? process.env.WECHAT_SUBSCRIBE_TEMPLATE || ''
        : '',
    };
  }
}
@Module({
  imports: [
    DatabaseModule,
    IdentityModule,
    ContentModule,
    MediaModule,
    OperationsModule,
    TasksModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: RateGuard },
    { provide: APP_GUARD, useClass: AccessGuard },
  ],
})
export class AppModule {}
