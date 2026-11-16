import {MobileController} from './modules/mobile/mobile.controller.js';
import { ApplicationsController } from './modules/communities/applications.controller.js';
import {APP_GUARD} from '@nestjs/core';
import {BrowserAccountsController} from './modules/identity/browser-accounts.controller.js';
import {BrowserContextGuard} from './modules/identity/browser-context.guard.js';
import { KnowledgeController } from './modules/knowledge/knowledge.controller.js';
import { KnowledgeRuntime } from './modules/knowledge/knowledge.runtime.js';
import { InterestController } from './modules/community-interest/interest.controller.js';
import { InterestRuntime } from './modules/community-interest/interest.runtime.js';
import 'reflect-metadata';
import {
  Controller,
  Get,
  Inject,
  Module,
  ServiceUnavailableException,
  type DynamicModule,
} from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { Database } from './database/database.types.js';
import { AuthController, DATABASE } from './modules/identity/auth.controller.js';
import { AccountController } from './modules/identity/account.controller.js';
import { CommunitiesController } from './modules/communities/communities.controller.js';
import { WikiController } from './modules/wiki/wiki.controller.js';
import { RecordsController } from './modules/identity/records.controller.js';
import { WechatAuthController } from './modules/identity/wechat-auth.controller.js';
import {
  AUTH_CONFIGURATION,
  type AuthConfiguration,
} from './modules/identity/auth-configuration.js';
import { OtpController } from './modules/identity/otp.controller.js';
import { OTP_SENDERS, type OtpSenders } from './modules/identity/otp-sender.js';
import { createOtpSenders } from './modules/identity/otp-configuration.js';
import { JobsController } from './modules/jobs/jobs.controller.js';
import {JobsRuntime,type RuntimeOptions} from './modules/jobs/jobs.runtime.js';
import { DiscussionsController } from './modules/discussions/discussions.controller.js';
import { DemoController } from './modules/demo/demo.controller.js';
import { DemoSnapshotsService } from './modules/demo/demo-snapshots.service.js';
import { MessagingController } from './modules/messaging/messaging.controller.js';
import { MessagingService } from './modules/messaging/messaging.service.js';
import { AdminController } from './modules/admin/admin.controller.js';
import { AdminService } from './modules/admin/admin.service.js';
import { GovernanceController } from './modules/admin/governance.controller.js';
export const DB = DATABASE;
@Controller('/api/v1')
class HealthController {
  constructor(@Inject(DB) private readonly db: Kysely<Database>) {}
  @Get('health') health() {
    return { status: 'ok' };
  }
  @Get('ready') async ready() {
    try {
      await sql`SELECT 1`.execute(this.db);
      return { status: 'ready' };
    } catch {
      throw new ServiceUnavailableException({
        code: 'DEPENDENCY_UNAVAILABLE',
        message: '服务暂不可用',
      });
    }
  }
}
@Module({})
export class AppModule {
  static register(
    db: Kysely<Database>,
    authConfiguration: AuthConfiguration = {},
    otpSenders?: OtpSenders,
    runtime:RuntimeOptions={},
  ): DynamicModule {
    return {
      module: AppModule,
      controllers: [
        HealthController,
        MobileController,
        AuthController,
        BrowserAccountsController,
        AccountController,
        CommunitiesController,
        ApplicationsController,
        WikiController,
        KnowledgeController,
        InterestController,
        RecordsController,
        WechatAuthController,
        OtpController,
        JobsController,
        DiscussionsController,
        DemoController,
        MessagingController,
        AdminController,
        GovernanceController,
      ],
      providers: [
        { provide: DB, useValue: db },
        {provide:APP_GUARD,useClass:BrowserContextGuard},
        { provide: KnowledgeRuntime, useFactory:()=>new KnowledgeRuntime(db,!!runtime.runJobs) },
        { provide: InterestRuntime, useFactory:()=>new InterestRuntime(db,!!runtime.runJobs) },
        DemoSnapshotsService,
        MessagingService,
        AdminService,
        { provide: JobsRuntime, useFactory:()=>new JobsRuntime(db,runtime) },
        { provide: AUTH_CONFIGURATION, useValue: authConfiguration },
        { provide: OTP_SENDERS, useValue: otpSenders || createOtpSenders(authConfiguration.otp) },
      ],
    };
  }
}
