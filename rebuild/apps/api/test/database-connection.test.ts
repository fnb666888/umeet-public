import { describe, it, expect, vi } from 'vitest';
const { pool } = vi.hoisted(() => ({ pool: vi.fn((_options: unknown) => ({ end: vi.fn() })) }));
vi.mock('mysql2', () => ({ createPool: pool }));
import { connectDatabase } from '../src/database/connection.js';
describe('database transport safety', () => {
  it('requires verified TLS for TiDB and accepts its console connection format', () => {
    connectDatabase(
      'mysql://prefix.user:example@gateway01.example.tidbcloud.com:4000/umeet?ssl={"rejectUnauthorized":true}',
    );
    expect(pool.mock.calls.at(-1)?.[0]).toMatchObject({
      host: 'gateway01.example.tidbcloud.com',
      port: 4000,
      ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true, verifyIdentity: true },
    });
    connectDatabase('mysql://user:example@gateway01.example.tidbcloud.com:4000/umeet');
    expect(pool.mock.calls.at(-1)?.[0]).toHaveProperty('ssl.rejectUnauthorized', true);
  });
  it('rejects attempts to disable TLS verification', () => {
    for (const ssl of [
      'false',
      '{"rejectUnauthorized":false}',
      '{"rejectUnauthorized":true,"checkServerIdentity":false}',
    ])
      expect(() =>
        connectDatabase(
          'mysql://user:example@gateway01.example.tidbcloud.com:4000/umeet?ssl=' +
            encodeURIComponent(ssl),
        ),
      ).toThrow('DATABASE_TLS_VALIDATION_REQUIRED');
  });
  it('preserves local MySQL connections without TLS', () => {
    connectDatabase('mysql://root@127.0.0.1:19316/test');
    expect(pool.mock.calls.at(-1)?.[0]).not.toHaveProperty('ssl');
  });
});
