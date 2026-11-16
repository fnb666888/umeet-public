import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createTestApp, type TestApp } from './support/test-app.js';
import { PasswordAuthService } from '../src/modules/identity/password-auth.service.js';
import { AccountService } from '../src/modules/identity/account.service.js';
import { OtpService } from '../src/modules/identity/otp.service.js';
import { DemoSnapshotsService } from '../src/modules/demo/demo-snapshots.service.js';
import { up as lifecycleMigration } from '../src/database/migrations/016_account_lifecycle.js';
import type { OtpMessage } from '../src/modules/identity/otp-sender.js';

let h: TestApp | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});
const proof = (subject: string) => ({
  identities: [{ provider: 'email', subject }],
  nickname: '原作者',
});
function otp() {
  const messages: OtpMessage[] = [];
  const service = new OtpService(
    h!.db,
    { hashKey: 'a'.repeat(64), dailyLimits: { email: 100, sms: 0 } },
    {
      email: {
        send: async (message) => {
          messages.push(message);
        },
      },
    },
  );
  return { service, messages };
}
describe('web account lifecycle', () => {
  it('rechecks the password after waiting for a concurrent credential change', async () => {
    h = await createTestApp();
    const auth = new PasswordAuthService(h.db);
    const member = await auth.register(
      { username: 'race_password', password: 'Original Password 93!' },
      'register',
    );
    let result: Promise<PromiseSettledResult<unknown>[]>;
    await h.db.transaction().execute(async (tx) => {
      await tx
        .selectFrom('users')
        .select('id')
        .where('id', '=', member.actor.userId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      result = Promise.allSettled([
        auth.login({ username: 'race_password', password: 'Original Password 93!' }, 'login'),
      ]);
      await new Promise((resolve) => setTimeout(resolve, 300));
      await tx
        .deleteFrom('password_credentials')
        .where('user_id', '=', member.actor.userId)
        .execute();
    });
    expect((await result!)[0]!.status).toBe('rejected');
  });
  it('serializes account closure and an in-flight community profile save', async () => {
    h = await createTestApp();
    const auth = new PasswordAuthService(h.db);
    const member = await auth.register(
      { username: 'concurrent_close', password: 'Concurrent Password 38!' },
      'register',
    );
    const community = new DemoSnapshotsService(h.db);
    await Promise.allSettled([
      new AccountService(h.db).close(member.token),
      community.save(member.actor.userId, {
        id: 'concurrent-state',
        operations: [{ type: 'state.save', state: { bookmarks: [] } }],
      }),
      auth.login(
        { username: 'concurrent_close', password: 'Concurrent Password 38!' },
        'concurrent-login',
      ),
    ]);
    expect(
      (
        await h.db
          .selectFrom('users')
          .select('deleted_at')
          .where('id', '=', member.actor.userId)
          .executeTakeFirstOrThrow()
      ).deleted_at,
    ).toBeTruthy();
    expect(
      await h.db
        .selectFrom('demo_user_states')
        .selectAll()
        .where('user_id', '=', member.actor.userId)
        .execute(),
    ).toHaveLength(0);
    expect(
      await h.db
        .selectFrom('sessions')
        .selectAll()
        .where('user_id', '=', member.actor.userId)
        .execute(),
    ).toHaveLength(0);
  });
  it('expires recovery challenges and locks them after five incorrect attempts', async () => {
    h = await createTestApp();
    await new PasswordAuthService(h.db).acceptExternalProof(proof('attempts@example.com'));
    const { service, messages } = otp();
    const challenge = await service.request('email', 'attempts@example.com', 'recovery');
    const wrong = messages[0]!.code === '000000' ? '111111' : '000000';
    for (let attempt = 0; attempt < 5; attempt++)
      await expect(
        service.resetPassword({
          challengeId: challenge.challengeId,
          code: wrong,
          password: 'Recovered Password 19!',
        }),
      ).rejects.toThrow('OTP_INVALID_OR_EXPIRED');
    await expect(
      service.resetPassword({
        challengeId: challenge.challengeId,
        code: messages[0]!.code,
        password: 'Recovered Password 19!',
      }),
    ).rejects.toThrow('OTP_INVALID_OR_EXPIRED');
    await h.db
      .updateTable('otp_challenges')
      .set({ attempts: 0, expires_at: new Date(0) })
      .where('id', '=', challenge.challengeId)
      .execute();
    await expect(
      service.resetPassword({
        challengeId: challenge.challengeId,
        code: messages[0]!.code,
        password: 'Recovered Password 19!',
      }),
    ).rejects.toThrow('OTP_INVALID_OR_EXPIRED');
  });
  it('sets a password from the account handle, signs in by verified email and revokes old sessions', async () => {
    h = await createTestApp();
    const auth = new PasswordAuthService(h.db);
    const member = await auth.acceptExternalProof(proof('Email@example.com'));
    const account = new AccountService(h.db);
    await account.profile(member.token, { handle: 'email_password', nickname: '作者' });
    const changed = await auth.setPassword(member.token, { password: 'New Account Password 82!' });
    await expect(auth.authenticate(member.token)).rejects.toThrow('AUTH_REQUIRED');
    const login = await auth.login(
      { username: 'Email@EXAMPLE.COM', password: 'New Account Password 82!' },
      'email',
    );
    expect(login.actor.userId).toBe(member.actor.userId);
    await expect(
      auth.login({ username: 'email@example.com', password: 'New Account Password 82!' }, 'case'),
    ).rejects.toThrow('INVALID_CREDENTIALS');
    const overview = await account.overview(changed.token);
    expect(overview.passwordUsername).toBe('email_password');
    expect(
      overview.securityEvents.some((event) => event.kind === 'identity.password-updated'),
    ).toBe(true);
    expect(JSON.stringify(overview)).not.toContain('New Account Password');
  });
  it('isolates recovery from login, consumes it once and only restores an existing owner', async () => {
    h = await createTestApp();
    const auth = new PasswordAuthService(h.db);
    const member = await auth.acceptExternalProof(proof('recover@example.com'));
    const { service, messages } = otp();
    const challenge = await service.request('email', 'recover@example.com', 'recovery');
    const input = {
      challengeId: challenge.challengeId,
      code: messages[0]!.code,
      password: 'Recovered Password 19!',
    };
    await expect(service.verifyLogin({ challengeId: input.challengeId, code: input.code })).rejects.toThrow('OTP_INVALID_OR_EXPIRED');
    const restored = await service.resetPassword(input);
    expect(restored.actor.userId).toBe(member.actor.userId);
    await expect(service.resetPassword(input)).rejects.toThrow('OTP_INVALID_OR_EXPIRED');
    const absent = await service.request('email', 'absent@example.com', 'recovery');
    expect(absent.challengeId).toBeTruthy();
    expect(messages).toHaveLength(1);
    await expect(
      service.resetPassword({
        challengeId: absent.challengeId,
        code: '000000',
        password: 'Recovered Password 19!',
      }),
    ).rejects.toThrow('OTP_INVALID_OR_EXPIRED');
    expect(
      await h.db.selectFrom('users').select('id').where('kind', '=', 'member').execute(),
    ).toHaveLength(1);
  });
  it('rejects recovery if its email was detached or moved before verification', async () => {
    h = await createTestApp();
    const auth = new PasswordAuthService(h.db);
    await auth.acceptExternalProof(proof('detached@example.com'));
    const { service, messages } = otp();
    const challenge = await service.request('email', 'detached@example.com', 'recovery');
    await h.db
      .deleteFrom('external_identities')
      .where('subject', '=', 'detached@example.com')
      .execute();
    await auth.acceptExternalProof(proof('detached@example.com'));
    await expect(
      service.resetPassword({
        challengeId: challenge.challengeId,
        code: messages[0]!.code,
        password: 'Recovered Password 19!',
      }),
    ).rejects.toThrow('OTP_INVALID_OR_EXPIRED');
  });
  it('keeps contributions anonymous while deleting credentials, private state and sent messages', async () => {
    h = await createTestApp();
    const auth = new PasswordAuthService(h.db);
    const member = await auth.acceptExternalProof(proof('closed@example.com'));
    const other = await auth.acceptExternalProof(proof('other@example.com'));
    const community = new DemoSnapshotsService(h.db);
    await community.save(member.actor.userId, {
      id: 'create-content',
      operations: [
        {
          type: 'post.create',
          post: { id: 'p1', community: 'questions', title: '保留帖子', body: '正文' },
        },
        { type: 'reply.create', postId: 'p1', reply: { id: 'r1', body: '保留回复' } },
        {
          type: 'wiki.save',
          wiki: {
            id: 'w1',
            title: '保留词条',
            summary: '摘要',
            communities: ['questions'],
            sections: [{ h: '章节', p: '内容' }],
            quick: [],
            reference: '',
          },
          baseRevision: 0,
          reason: '创建',
          applied: [],
        },
        { type: 'wiki.note', wikiId: 'w1', text: '注释' },
        { type: 'state.save', state: { bookmarks: ['p1'] } },
        { type: 'message.send', id: 'm1', peer: other.actor.userId, text: '私人信息' },
      ],
    });
    await community.save(other.actor.userId, {
      id: 'reply-content',
      operations: [
        {
          type: 'reply.create',
          postId: 'p1',
          reply: { id: 'r2', body: '回应', replyTo: 'r1', parentId: 'r1' },
        },
      ],
    });
    await new AccountService(h.db).close(member.token);
    await expect(auth.authenticate(member.token)).rejects.toThrow('AUTH_REQUIRED');
    await expect(
      community.save(member.actor.userId, {
        id: 'after-close',
        operations: [{ type: 'state.save', state: { bookmarks: [] } }],
      }),
    ).rejects.toThrow('AUTH_REQUIRED');
    const snapshot = await community.get(other.actor.userId);
    expect(snapshot.content.posts[0]!.author).toBe('已注销用户');
    expect(snapshot.content.comments.p1![0]!.author).toBe('已注销用户');
    expect(snapshot.content.comments.p1![1]!.replyToName).toBe('已注销用户');
    expect(snapshot.content.wiki[0]!.editor).toBe('已注销用户');
    expect(snapshot.content.wiki[0]!.history[0]!.author).toBe('已注销用户');
    expect(snapshot.content.wiki[0]!.notes[0]!.author).toBe('已注销用户');
    expect(snapshot.contacts.some((item) => item.id === member.actor.userId)).toBe(false);
    expect(JSON.stringify(snapshot.userState.threads)).not.toContain('私人信息');
    expect(
      await h.db
        .selectFrom('demo_user_states')
        .selectAll()
        .where('user_id', '=', member.actor.userId)
        .execute(),
    ).toHaveLength(0);
    const recreated = await auth.acceptExternalProof(proof('closed@example.com'));
    expect(recreated.actor.userId).not.toBe(member.actor.userId);
  });
  it('requires recent verification and exact confirmation to close an account', async () => {
    h = await createTestApp();
    const member = await new PasswordAuthService(h.db).acceptExternalProof(
      proof('confirm@example.com'),
    );
    const client = request(h.app.getHttpServer());
    await client
      .post('/api/v1/account/close')
      .auth(member.token, { type: 'bearer' })
      .send({ confirmation: 'wrong' })
      .expect(400);
    await h.db
      .updateTable('sessions')
      .set({ authenticated_at: new Date(0) })
      .execute();
    await client
      .post('/api/v1/account/close')
      .auth(member.token, { type: 'bearer' })
      .send({ confirmation: '注销我的账号' })
      .expect(403);
  });
  it('can retry migration without assigning legacy Wiki ownership from nicknames', async () => {
    h = await createTestApp();
    await new PasswordAuthService(h.db).acceptExternalProof(proof('legacy-wiki@example.com'));
    await h.db
      .insertInto('demo_entities')
      .values({
        id: 'wiki:legacy',
        kind: 'wiki',
        data: JSON.stringify({
          editor: '原作者',
          history: [{ author: '原作者' }],
          notes: [],
          suggestions: [],
        }),
      })
      .execute();
    await lifecycleMigration(h.db);
    await lifecycleMigration(h.db);
    const entity = await h.db
      .selectFrom('demo_entities')
      .select('data')
      .where('id', '=', 'wiki:legacy')
      .executeTakeFirstOrThrow();
    expect(JSON.parse(entity.data).editorId).toBeUndefined();
  });
});
