import 'reflect-metadata';
import './core/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { ErrorFilter } from './core/filter';
import { checkConfig } from './core/config';
async function main() {
  checkConfig();
  const app = await NestFactory.create(AppModule);
  if (process.env.TRUST_PROXY === '1') app.getHttpAdapter().getInstance().set('trust proxy', 1);
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.enableCors({
    origin: (process.env.CORS_ORIGINS || '').split(',').filter(Boolean),
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
  });
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalFilters(new ErrorFilter());
  if (process.env.NODE_ENV !== 'production')
    SwaggerModule.setup(
      'api/docs',
      app,
      SwaggerModule.createDocument(
        app,
        new DocumentBuilder()
          .setTitle('Umeet 校园社区 API')
          .setVersion('0.1')
          .addBearerAuth()
          .build(),
      ),
    );
  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT || 3100), process.env.HOST || '127.0.0.1');
  console.log(
    `Umeet API: http://${process.env.HOST || '127.0.0.1'}:${process.env.PORT || 3100}/api/v1`,
  );
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
