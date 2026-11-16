import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
@Catch()
export class ErrorFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse();
    let status = 500;
    let message: string | string[] = '服务暂时不可用';
    if (error instanceof HttpException) {
      status = error.getStatus();
      const body = error.getResponse();
      message = typeof body === 'string' ? body : (body as { message: string | string[] }).message;
    } else if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        status = 409;
        message = '重复操作或数据冲突';
      }
      if (error.code === 'P2025') {
        status = 404;
        message = '内容不存在';
      }
    } else new Logger('API').error(error instanceof Error ? error.message : 'Unknown error');
    res.status(status).json({ statusCode: status, message, timestamp: new Date().toISOString() });
  }
}
