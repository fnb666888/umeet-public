import 'reflect-metadata';
import './core/config';
import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { DatabaseModule } from './core/database';
import { TasksModule } from './notifications/tasks.module';
import { checkConfig } from './core/config';
process.env.PROCESS_ROLE = 'worker';
@Module({ imports: [DatabaseModule, TasksModule] })
class WorkerModule {}
async function main() {
  checkConfig();
  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks();
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
