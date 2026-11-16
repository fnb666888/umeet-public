import { createHash, randomUUID } from 'node:crypto';
import request from 'supertest';
import { expect, it } from 'vitest';
import { createTestApp } from './support/test-app.js';
import { PasswordAuthService } from '../src/modules/identity/password-auth.service.js';
import { OtpService } from '../src/modules/identity/otp.service.js';
import { SettingsService } from '../src/modules/settings/settings.service.js';
import type { OtpMessage } from '../src/modules/identity/otp-sender.js';

it('enforces registration and posting policies while keeping unpublished posts private', async () => {
  const app = await createTestApp();
  const settings = new SettingsService(app.db);
  const initial = await settings.getSiteSettings();
  try {
    const client = request(app.app.getHttpServer());
    const auth = new PasswordAuthService(app.db);
    const admin = await auth.register(
      { username: 'policy_admin', password: 'Site policies 123!' },
      'policy-admin',
    );
    await app.db
      .insertInto('platform_roles')
      .values({ user_id: admin.actor.userId, role: 'admin' })
      .execute();
    const update = structuredClone(initial);
    update.settings.registration = { mode: 'invite', domains: [] };
    update.settings.notifications.announcements = true;
    update.settings.boards.market.posting = {
      readonly: false,
      firstPostReview: true,
      cooldownSeconds: 0,
    };
    update.settings.boards.treehole.posting.readonly = true;
    let saved = await settings.updateSiteSettings(admin.actor.userId, update);
    const invite = (
      await client
        .post('/api/v1/admin/community/registration-invite')
        .auth(admin.token, { type: 'bearer' })
        .expect(201)
    ).body.code;
    const messages: OtpMessage[] = [];
    const otp = new OtpService(
      app.db,
      { hashKey: 'a'.repeat(64), dailyLimits: { email: 100, sms: 0 } },
      {
        email: {
          send: async (message) => {
            messages.push(message);
          },
        },
      },
    );
    const challenge = await otp.request('email', 'first@example.edu', 'register');
    const signup = {
      challengeId: challenge.challengeId,
      code: messages[0]!.code,
      username: 'policy_author',
      password: 'Site policies 123!',
    };
    await expect(otp.register(signup)).rejects.toThrow('REGISTRATION_INVITE_REQUIRED');
    const author = await otp.register({ ...signup, inviteCode: invite });
    const second = await otp.request('email', 'second@example.edu', 'register');
    await expect(
      otp.register({
        ...signup,
        username: 'policy_second',
        challengeId: second.challengeId,
        code: messages[1]!.code,
        inviteCode: invite,
      }),
    ).rejects.toThrow('REGISTRATION_INVITE_INVALID');

    const image =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS1sAAAAASUVORK5CYII=';
    const asset = '/api/v1/demo/assets/' + createHash('sha256').update(image).digest('hex');
    const createPost = (id: string, community = 'market', token = author.token) =>
      client
        .post('/api/v1/demo/operations')
        .auth(token, { type: 'bearer' })
        .send({
          id: randomUUID(),
          operations: [
            {
              type: 'post.create',
              post: { id, community, title: '政策验证 ' + id, body: '首帖正文', images: [image] },
            },
          ],
        });
    const draft = {
      id: 'policy-first',
      community: 'market',
      title: '政策验证 policy-first',
      body: '首帖正文',
      images: [image],
      author: 'policy_author',
      authorId: author.actor.userId,
      createdAt: Date.now(),
      likes: 0,
    };
    await app.db
      .insertInto('post_reviews')
      .values({
        id: draft.id,
        board: draft.community,
        user_id: draft.authorId,
        status: 'pending',
        data: JSON.stringify(draft),
        reason: '',
        created_at: new Date(draft.createdAt),
      })
      .execute();
    const publicBefore = (await client.get('/api/v1/demo').expect(200)).body;
    expect(publicBefore.content.posts).toEqual([]);
    expect(publicBefore.postReviews).toEqual([]);
    await client.get(asset).expect(404);
    await createPost('policy-first').expect(409);
    await createPost('policy-readonly', 'treehole').expect(403);
    const queue = '/api/v1/admin/community/items?section=reviews&status=pending';
    await client.get(queue).auth(author.token, { type: 'bearer' }).expect(403);
    expect(
      (await client.get(queue).auth(admin.token, { type: 'bearer' }).expect(200)).body.total,
    ).toBe(1);
    const detail = await client
      .get(queue + '&record=policy-first')
      .auth(admin.token, { type: 'bearer' })
      .expect(200);
    expect(detail.body.items[0].images).toEqual([image]);
    const review = {
      id: randomUUID(),
      action: 'post.review',
      target: 'policy-first',
      outcome: 'approved',
      reason: '符合交易规则',
    };
    const reviewPath = '/api/v1/admin/community/actions';
    await client
      .post(reviewPath + '?board=daily')
      .auth(admin.token, { type: 'bearer' })
      .send(review)
      .expect(404);
    await client.post(reviewPath).auth(admin.token, { type: 'bearer' }).send(review).expect(201);
    await client.get(asset).expect(200);
    await client.post(reviewPath).auth(admin.token, { type: 'bearer' }).send(review).expect(201);
    expect((await client.get('/api/v1/demo').expect(200)).body.content.posts[0].id).toBe(
      'policy-first',
    );

    saved.settings.boards.market.posting.cooldownSeconds = 3600;
    saved.settings.registration = { mode: 'campus', domains: ['example.edu'] };
    saved.settings.notifications.announcements = false;
    saved = await settings.updateSiteSettings(admin.actor.userId, saved);
    await createPost('policy-cooldown').expect(409);
    await expect(otp.request('email', 'wrong@example.edu.invalid', 'register')).rejects.toThrow(
      'CAMPUS_EMAIL_REQUIRED',
    );
    const campus = await otp.request('email', 'campus@EXAMPLE.EDU', 'register');
    const campusUser = await otp.register({
      ...signup,
      username: 'policy_campus',
      challengeId: campus.challengeId,
      code: messages[2]!.code,
    });
    const first = (await createPost('policy-open', 'market', campusUser.token).expect(201)).body;
    expect(first.content.posts.some((post: { id: string }) => post.id === 'policy-open')).toBe(
      true,
    );
    expect(first.postReviews).toEqual([]);
    expect(
      (await client.get('/api/v1/demo').auth(campusUser.token, { type: 'bearer' }).expect(200)).body
        .userState.notifPrefs,
    ).toBeUndefined();
    expect(
      (await client.get('/api/v1/demo').auth(author.token, { type: 'bearer' }).expect(200)).body
        .userState.notifPrefs.system,
    ).toBe(true);
  } finally {
    await app.db
      .updateTable('runtime_settings')
      .set({ revision: initial.revision, value: JSON.stringify(initial.settings) })
      .where('id', '=', 'site-settings')
      .execute();
    await app.db.deleteFrom('post_reviews').where('id', '=', 'policy-first').execute();
    await app.close();
  }
});
