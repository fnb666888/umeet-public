import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { connectDatabase } from './database/connection.js';
import { CommunitiesService } from './modules/communities/communities.service.js';
import { loadAuthConfiguration } from './modules/identity/auth-configuration.js';
const connectionString = process.env['DATABASE_URL'];
if (!connectionString) throw new Error('DATABASE_URL_REQUIRED');
const db = connectDatabase(connectionString);
await new CommunitiesService(db).seedDefaults();
const app = await NestFactory.create<NestExpressApplication>(
  AppModule.register(db, loadAuthConfiguration(process.env),undefined,{runJobs:true,closeDatabase:true}),
  { logger: ['error', 'warn', 'log'] },
);
app.useBodyParser('json', { limit: '8mb' });
app.enableShutdownHooks();
await app.listen(Number(process.env['PORT'] || 8080), process.env['HOST'] || '0.0.0.0');
