import { Global, Injectable, Module, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { ROOT, demoMode } from './config';
import { windowsPostgres } from './local-postgres';
import { databaseProvider } from './database-dialect';

function adapter() {
  const provider = databaseProvider();
  const schema = readFileSync(require.resolve('.prisma/client/schema.prisma'), 'utf8');
  if (!new RegExp(`provider\\s*=\\s*"${provider}"`).test(schema))
    throw new Error(`Prisma Client 与数据库类型不一致，请使用 DATABASE_PROVIDER=${provider} 重新构建后端`);
  const url = new URL(process.env.DATABASE_URL!);
  if (provider === 'postgresql') {
    if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('PostgreSQL 连接协议错误');
    return new PrismaPg({ connectionString: process.env.DATABASE_URL });
  }
  if (url.protocol !== 'mysql:') throw new Error('MySQL 连接协议错误');
  const limit = Number(process.env.DATABASE_POOL_SIZE || 5);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error('DATABASE_POOL_SIZE 必须在 1 到 50 之间');
  return new PrismaMariaDb({
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.slice(1)),
    connectionLimit: limit,
    charset: 'utf8mb4',
    timezone: '+00:00',
    ...(url.searchParams.get('sslaccept') === 'strict' ? { ssl: { rejectUnauthorized: true } } : {}),
  });
}

@Injectable()
export class Database extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private embedded?: { stop(): Promise<void> };
  constructor() {
    super({ adapter: adapter() });
  }
  async onModuleInit() {
    if (process.env.LOCAL_DATABASE === 'true' && process.env.NODE_ENV !== 'production') {
      if (databaseProvider() !== 'postgresql') throw new Error('MySQL 请使用独立数据库，不能开启 LOCAL_DATABASE');
      const url = new URL(process.env.DATABASE_URL!);
      // Windows PostgreSQL 的初始化程序对含非 ASCII 字符的路径有限制。
      const databaseDir =
        process.env.LOCAL_DB_DIR ||
        path.join(
          os.tmpdir(),
          'umeet-postgres-' + createHash('sha256').update(ROOT).digest('hex').slice(0, 10),
        );
      mkdirSync(databaseDir, { recursive: true });
      if (process.platform === 'win32') this.embedded = await windowsPostgres(databaseDir, url);
      else {
        const { default: EmbeddedPostgres } = await import('embedded-postgres');
        const pg = new EmbeddedPostgres({
          databaseDir,
          user: url.username,
          password: url.password,
          port: Number(url.port),
          persistent: true,
          initdbFlags: ['--encoding=UTF8', '--locale=C'],
          postgresFlags: ['-h', '127.0.0.1'],
          onLog: () => {},
          onError: () => {},
        });
        if (!existsSync(path.join(databaseDir, 'PG_VERSION'))) await pg.initialise();
        await pg.start();
        this.embedded = pg;
        const client = pg.getPgClient();
        await client.connect();
        const name = url.pathname.slice(1);
        if (!/^[a-zA-Z0-9_]+$/.test(name)) throw new Error('非法数据库名称');
        const result = await client.query('SELECT 1 FROM pg_database WHERE datname=$1', [name]);
        if (!result.rowCount) await pg.createDatabase(name);
        await client.end();
      }
      execFileSync(
        process.execPath,
        [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'],
        { cwd: path.join(ROOT, 'apps/api'), env: process.env, stdio: 'pipe' },
      );
    }
    await this.$connect();
    await this.user.upsert({
      where: { id: 'platform-admin' },
      create: { id: 'platform-admin', nickname: '平台管理员', role: 'PLATFORM_ADMIN' },
      update: {},
    });
    if (demoMode()) await this.seedDemo();
  }
  private async seedDemo() {
    await this.school.upsert({
      where: { id: 'demo-school' },
      create: {
        id: 'demo-school',
        name: '示范大学',
        treeholeEnabled: true,
        emailDomains: ['example.edu.cn'],
      },
      update: {},
    });
    for (const [id, name] of [
      ['main', '主校区'],
      ['east', '东校区'],
    ])
      await this.campus.upsert({
        where: { id },
        create: { id, name, schoolId: 'demo-school' },
        update: {},
      });
    await this.school.upsert({
      where: { id: 'other-school' },
      create: { id: 'other-school', name: '另一所示范大学', emailDomains: [] },
      update: {},
    });
    await this.campus.upsert({
      where: { id: 'other-campus' },
      create: { id: 'other-campus', name: '本部', schoolId: 'other-school' },
      update: {},
    });
    const users = [
      { id: 'demo-student', nickname: '林同学', schoolId: 'demo-school' },
      { id: 'demo-peer', nickname: '周同学', schoolId: 'demo-school' },
      { id: 'demo-other', nickname: '陈同学', schoolId: 'other-school' },
    ];
    for (const u of users) {
      await this.user.upsert({
        where: { id: u.id },
        create: { id: u.id, nickname: u.nickname },
        update: {},
      });
      await this.membership.upsert({
        where: { userId_schoolId: { userId: u.id, schoolId: u.schoolId } },
        create: {
          userId: u.id,
          schoolId: u.schoolId,
          status: 'VERIFIED',
          expiresAt: new Date(Date.now() + 365 * 86400000),
        },
        update: {},
      });
    }
    const samples = [
      [
        'seed-guide',
        'GUIDE',
        '新同学，欢迎来到校园',
        '这是一份演示校园指南：在这里交流生活经验、寻找帮助，也把你的善意分享给更多同学。',
        false,
        null,
      ],
      [
        'seed-help',
        'HELP',
        '有人一起去图书馆自习吗？',
        '周三下午想找自习搭子，准备复习高数。希望我们能互相监督，学习结束一起吃个饭。',
        false,
        null,
      ],
      [
        'seed-market',
        'MARKET',
        '闲置台灯，送给下一位认真生活的人',
        '九成新，暖光和白光都能调节，宿舍整理后闲置。主校区可面交，欢迎留言。',
        false,
        3500,
      ],
      [
        'seed-lost',
        'LOST',
        '食堂门口拾到一串钥匙',
        '今天中午在食堂附近拾到钥匙，请失主提供钥匙扣特征。希望尽快找到主人。',
        false,
        null,
      ],
      [
        'seed-tree',
        'TREEHOLE',
        '慢慢来，也是在向前走',
        '最近事情很多，但今天傍晚看见校园的落日，突然觉得日子也没有那么糟。祝大家都有一个好梦。',
        true,
        null,
      ],
    ] as const;
    for (let i = 0; i < samples.length; i++) {
      const [id, category, title, content, anonymous, priceFen] = samples[i];
      await this.post.upsert({
        where: { id },
        create: {
          id,
          authorId: 'demo-peer',
          schoolId: 'demo-school',
          campusId: 'main',
          category,
          title,
          content,
          anonymous,
          priceFen,
          lostType: category === 'LOST' ? 'FOUND' : null,
          status: 'PUBLISHED',
          requestKey: id,
          requestHash: id,
          createdAt: new Date(Date.now() - (i + 1) * 7200000),
        },
        update: {},
      });
    }
  }
  async onModuleDestroy() {
    await this.$disconnect();
    if (this.embedded) await this.embedded.stop();
  }
}
@Global()
@Module({ providers: [Database], exports: [Database] })
export class DatabaseModule {}
