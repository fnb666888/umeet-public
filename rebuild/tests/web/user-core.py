"""Ordinary-user browser journeys against local services, with disposable accounts."""
import atexit
import json
import subprocess
from pathlib import Path
from uuid import uuid4
from playwright.sync_api import sync_playwright, expect

BASE = 'http://127.0.0.1:5178'
subprocess.run(['node', '--import', 'tsx', 'tests/web/community-governance-fixtures.mjs', 'setup'], check=True)
atexit.register(lambda: subprocess.run(['node', '--import', 'tsx', 'tests/web/community-governance-fixtures.mjs', 'cleanup'], check=True))
fixture = json.loads(Path('.runtime/governance-ui-fixture.json').read_text(encoding='utf-8-sig'))
marker = '用户验收-' + uuid4().hex[:8]

with sync_playwright() as p:
    browser = p.chromium.launch(channel='msedge', headless=True)
    a = browser.new_context(viewport={'width': 1440, 'height': 900})
    b = browser.new_context(viewport={'width': 1440, 'height': 900})
    page, other = a.new_page(), b.new_page()
    errors = []
    for target in [page, other]:
        target.on('pageerror', lambda error: errors.append(str(error)))

    def login(target, account):
        target.goto(BASE + '/#/me')
        target.locator('#auth-username').fill(account['username'])
        target.locator('#auth-password').fill(account['password'])
        target.locator('#auth-form button[type=submit]').click()
        expect(target.locator('#profile-name')).to_have_text(account['username'])

    try:
        login(page, fixture)
        login(other, fixture['assistant'])
        access = a.request.get(BASE + '/api/backend/admin/community/access').json()
        assert not access['admin'] and not access['boards']
        assert a.request.get(BASE + '/api/backend/admin/community/site-settings').status == 403
        print('PASS two ordinary users log in; admin API denies access', flush=True)

        page.goto(BASE + '/#/c/questions')
        page.locator('#btn-new').click()
        page.locator('#cmp-community').select_option('questions')
        page.locator('#cmp-title').fill(marker)
        page.get_by_label('正文 Markdown 源码', exact=True).fill('**真实发布测试**：请分享校园学习经验。')
        page.locator('#cmp-submit').click()
        page.wait_for_url('**/#/posts/*')
        post_url = page.url
        expect(page.get_by_role('heading', name=marker, exact=True)).to_be_visible()
        other.goto(post_url)
        other.locator('#reply-input').fill('另一位用户的真实回复')
        other.locator('#reply-send').click()
        expect(other.locator('#reply-input')).to_have_value('')
        other.locator('.like-post').first.click()
        expect(other.locator('.like-post').first).to_have_attribute('aria-pressed', 'true')
        other.locator('[data-bmk]').first.click()
        expect(other.locator('[data-bmk]').first).to_have_attribute('aria-pressed', 'true')
        other.reload()
        expect(other.get_by_text('另一位用户的真实回复', exact=True)).to_be_visible()
        expect(other.locator('[data-bmk]').first).to_have_attribute('aria-pressed', 'true')
        assert not a.request.get(BASE + '/api/backend/demo?messages=omit').json()['userState'].get('bookmarks')
        other.goto(BASE + '/#/bookmarks')
        expect(other.get_by_role('link', name=marker, exact=True)).to_be_visible()
        page.reload()
        page.locator('.cbest').first.click()
        expect(page.locator('.question-status').first).to_have_text('已解决')
        print('PASS publish, second-user reply, like, bookmark, persistence, isolation and best answer', flush=True)

        page.goto(BASE + '/#/me')
        page.get_by_role('button', name='编辑个性签名', exact=True).click()
        page.locator('#pf-bio').fill(marker + ' 个性签名')
        page.locator('#pf-save').click()
        page.reload()
        expect(page.get_by_role('button', name='编辑个性签名', exact=True)).to_contain_text(marker)
        other.goto(BASE + '/#/users/' + fixture['userId'])
        expect(other.locator('.profile-bio')).to_contain_text(marker)
        expect(other.get_by_role('button', name='编辑个性签名', exact=True)).to_have_count(0)
        print('PASS profile edit persists; another user sees updates without edit controls', flush=True)

        page.goto(BASE + '/#/inbox/' + fixture['assistant']['userId'])
        page.locator('#message-text').fill(marker + ' 私信请求')
        page.get_by_role('button', name='发送', exact=True).click()
        expect(page.locator('.dm-messages')).to_contain_text(marker)
        other.goto(BASE + '/#/inbox/' + fixture['userId'])
        other.get_by_role('button', name='接受请求', exact=True).click()
        other.locator('#message-text').fill(marker + ' 私信回复')
        other.get_by_role('button', name='发送', exact=True).click()
        expect(page.locator('.dm-messages')).to_contain_text(marker + ' 私信回复', timeout=15000)
        page.reload()
        expect(page.locator('.dm-messages')).to_contain_text(marker + ' 私信回复')
        print('PASS direct message request, acceptance, reply and persistence', flush=True)

        page.goto(BASE + '/#/wiki')
        page.get_by_role('button', name='新建词条', exact=True).click()
        page.locator('#we-title').fill(marker + ' 指南')
        page.locator('#we-summary').fill('真实浏览器验收指南')
        page.locator('#we-board').select_option('questions')
        page.locator('.we-heading').fill('操作步骤')
        page.locator('.we-body').fill('第一步，打开页面。第二步，核对结果。')
        page.locator('#wiki-editor button[type=submit]').click()
        page.wait_for_url('**/#/wiki/*')
        wiki_url = page.url
        other.goto(wiki_url)
        other.get_by_role('button', name='编辑词条', exact=True).click()
        other.locator('#we-summary').fill('第二位用户补充的摘要')
        other.locator('#we-reason').fill('验证协作修改')
        other.locator('#wiki-editor button[type=submit]').click()
        expect(other.locator('#wiki-editor')).to_have_count(0)
        other.reload()
        expect(other.get_by_text('第二位用户补充的摘要', exact=True)).to_be_visible()
        print('PASS Wiki create, second-user edit and persistence', flush=True)

        page.locator('#btn-avatar').click()
        page.locator('#switch-account').click()
        page.locator('#auth-username').fill(fixture['assistant']['username'])
        page.locator('#auth-password').fill('incorrect-password')
        page.locator('#auth-form button[type=submit]').click()
        expect(page.locator('#auth-message')).not_to_be_empty()
        assert a.request.get(BASE + '/api/backend/demo?messages=omit').json()['actor']['userId'] == fixture['userId']
        page.locator('#auth-password').fill(fixture['assistant']['password'])
        page.locator('#auth-form button[type=submit]').click()
        expect(page.locator('#umeet-auth-dialog')).not_to_be_visible()
        page.goto(BASE + '/#/me')
        expect(page.locator('#profile-name')).to_have_text(fixture['assistant']['username'])
        print('PASS account switching: failed login retains current identity; successful login replaces it', flush=True)

        for width in [320, 390, 871, 1440]:
            page.set_viewport_size({'width': width, 'height': 900})
            page.goto(BASE + '/#/discover')
            expect(page.get_by_role('heading', name='发现', exact=True)).to_be_visible()
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), width
        page.screenshot(path='.runtime/user-core-discover.png', full_page=True)
        page.locator('#btn-avatar').click()
        page.locator('#logout').click()
        expect(page.locator('#umeet-auth-dialog')).not_to_be_visible()
        page.reload()
        page.locator('#btn-avatar').click()
        expect(page.locator('#login')).to_be_visible()
        assert not errors, errors
        print('PASS four viewport sizes, logout and no browser exceptions', flush=True)
    except Exception:
        page.screenshot(path='.runtime/user-core-failure.png', full_page=True)
        raise
    finally:
        browser.close()
