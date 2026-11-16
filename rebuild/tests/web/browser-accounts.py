"""Local-only browser accounts regression; preserves the preview dataset and role fixtures."""
import json
import re
import subprocess
from pathlib import Path
from uuid import uuid4
from playwright.sync_api import sync_playwright, expect

BASE = 'http://127.0.0.1:5178'
subprocess.run(['node', '--import', 'tsx', 'tests/web/browser-account-fixtures.ts'], check=True)
accounts = json.loads(Path('.runtime/local-role-accounts.json').read_text(encoding='utf-8'))['accounts']
evidence = Path('docs/evidence/accounts')
evidence.mkdir(parents=True, exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch(channel='msedge', headless=True)
    context = browser.new_context(viewport={'width': 1280, 'height': 1000})
    context.set_default_timeout(45000)
    errors = []
    def page():
        tab = context.new_page()
        tab.on('pageerror', lambda error: errors.append(str(error)))
        tab.on('dialog', lambda dialog: dialog.accept())
        return tab
    def ready(tab):
        expect(tab.locator('main#main')).to_be_visible()
    def picker(tab):
        tab.evaluate("window.dispatchEvent(new Event('umeet:accounts'))")
        expect(tab.locator('.account-picker')).to_be_visible()
        # The list refresh must finish before an action captures its version.
        tab.wait_for_function("!document.querySelector('.account-picker [aria-busy=true]')")
    def login(tab, account, first=False):
        print('Signing in', account['username'], flush=True)
        if first:
            tab.evaluate("window.dispatchEvent(new Event('umeet:login'))")
        else:
            picker(tab)
            tab.get_by_role('button', name='添加其他账号', exact=True).click()
        tab.locator('#auth-username').fill(account['username'])
        tab.locator('#auth-password').fill(account['password'])
        with tab.expect_navigation(wait_until='domcontentloaded'):
            tab.locator('#auth-form button[type=submit]').click()
        ready(tab)
    def current(tab):
        return tab.evaluate("fetch('/api/session/accounts').then(r=>r.json()).then(d=>d.state)")
    def switch(tab, account):
        picker(tab)
        button = tab.locator('.account-picker-account').filter(has_text='@' + account['username']).filter(has_text=account['label'])
        with tab.expect_navigation(wait_until='domcontentloaded'):
            button.click()
        ready(tab)
        assert current(tab)['currentUserId'] == account['userId']
    def backend(tab, path):
        return tab.evaluate("async path=>{const r=await fetch('/api/backend/'+path);return {status:r.status,data:await r.json()}}", path)
    tab = page()
    try:
        tab.goto(BASE)
        ready(tab)
        login(tab, accounts[0], first=True)
        picker(tab)
        tab.get_by_role('button', name='添加其他账号', exact=True).click()
        tab.locator('#auth-username').fill(accounts[1]['username'])
        tab.locator('#auth-password').fill('incorrect password for QA')
        tab.locator('#auth-form button[type=submit]').click()
        expect(tab.locator('#auth-message')).to_contain_text('用户名、邮箱或密码错误')
        assert current(tab)['currentUserId'] == accounts[0]['userId']
        tab.get_by_role('button', name='取消切换', exact=True).click()
        for account in accounts[1:]:
            login(tab, account)
        state = current(tab)
        assert len(state['accounts']) == 5
        assert all(account['status'] == 'ready' for account in state['accounts'])
        assert 'token' not in json.dumps(state).lower()
        assert all(cookie['httpOnly'] for cookie in context.cookies() if cookie['name'] in ['umeet_session', 'umeet_browser'])
        assert all(account['password'] not in json.dumps(context.storage_state()['origins']) for account in accounts)
        sixth = json.loads(Path('.runtime/knowledge-fixture.json').read_text(encoding='utf-8-sig'))['accounts']['unrelated']
        limit = context.request.post(BASE + '/api/session/login', data={'username': sixth['username'], 'password': sixth['password']}, headers={'Origin': BASE, 'X-Umeet-Account': state['currentUserId'], 'X-Umeet-Browser-Version': str(state['version'])})
        assert limit.status == 409 and limit.json()['message'] == 'BROWSER_ACCOUNT_LIMIT'
        assert current(tab)['currentUserId'] == state['currentUserId']
        # Use the visible community entry, then inspect desktop and narrow layouts.
        tab.locator('#btn-avatar').click()
        tab.get_by_role('button', name='切换账号', exact=True).click()
        expect(tab.locator('.account-picker-add')).to_be_disabled()
        expect(tab.locator('.account-picker-account')).to_have_count(5)
        tab.screenshot(path=str(evidence / 'picker-desktop.png'))
        tab.set_viewport_size({'width': 390, 'height': 844})
        tab.screenshot(path=str(evidence / 'picker-mobile.png'))
        assert tab.evaluate('document.documentElement.scrollWidth <= innerWidth')
        tab.keyboard.press('Escape')
        expect(tab.locator('.account-picker')).not_to_be_visible()
        tab.set_viewport_size({'width': 1280, 'height': 1000})
        second = page()
        second.goto(BASE)
        ready(second)
        # All real roles switch without submitting passwords a second time.
        for account in accounts:
            if current(tab)['currentUserId'] != account['userId']:
                with second.expect_navigation(wait_until='domcontentloaded'):
                    switch(tab, account)
                ready(second)
            assert current(second)['currentUserId'] == account['userId']
            access = backend(tab, 'admin/community/access')['data']
            if account['role'] == 'admin':
                assert access['admin'] is True
                assert backend(tab, 'admin/community/overview')['status'] == 200
            elif account['role'] in ['moderator', 'assistant']:
                assert access['admin'] is False
                assert backend(tab, 'admin/community/overview?board=physics')['status'] == 200
                assert backend(tab, 'admin/community/overview?board=campus')['status'] == 403
            else:
                assert access['admin'] is False and not access['boards']
                assert backend(tab, 'admin/community/overview?board=physics')['status'] == 403
        # A Wiki draft is saved under A before another tab changes to B.
        switch(tab, accounts[3])
        second.goto(BASE + '/knowledge/new?task=account-switch-' + str(uuid4()))
        expect(second.get_by_label('词条标题', exact=True)).to_be_visible()
        second.get_by_label('词条标题', exact=True).fill('切换账号自动保存验收')
        with second.expect_navigation(wait_until='domcontentloaded'):
            switch(tab, accounts[4])
        expect(second.get_by_role('heading', name='Wiki 知识库', exact=True)).to_be_visible()
        # Old account/version cannot be used with the new shared cookie.
        stale = context.request.post(BASE + '/api/session/reauth', data={'password': accounts[4]['password']}, headers={'Origin': BASE, 'X-Umeet-Account': accounts[3]['userId'], 'X-Umeet-Browser-Version': str(state['version'])})
        assert stale.status == 409
        second.close()
        # Persistence survives closing and recreating the browser context.
        saved = context.storage_state()
        context.close()
        context = browser.new_context(storage_state=saved, viewport={'width': 1280, 'height': 1000})
        context.set_default_timeout(45000)
        tab = page(); tab.goto(BASE); ready(tab)
        assert len(current(tab)['accounts']) == 5
        switch(tab, accounts[3])
        mine = backend(tab, 'knowledge/drafts')['data']
        assert '切换账号自动保存验收' in json.dumps(mine, ensure_ascii=False)
        tab.locator('#btn-avatar').click()
        with tab.expect_navigation(wait_until='domcontentloaded'):
            tab.locator('#logout').click()
        ready(tab)
        assert current(tab)['currentUserId'] is None
        tab.locator('#btn-avatar').click()
        tab.locator('#switch-account').click()
        expired = tab.locator('.account-picker-account').filter(has_text='@' + accounts[3]['username']).filter(has_text=accounts[3]['label'])
        expect(expired).to_contain_text('重新登录')
        expired.click()
        expect(tab.locator('#auth-username')).to_have_value(accounts[3]['username'])
        tab.locator('#auth-password').fill(accounts[3]['password'])
        with tab.expect_navigation(wait_until='domcontentloaded'):
            tab.locator('#auth-form button[type=submit]').click()
        ready(tab)
        assert len(current(tab)['accounts']) == 5
        picker(tab)
        tab.get_by_role('button', name='退出所有账号', exact=True).click()
        expect(tab.locator('main#main')).to_be_visible()
        tab.wait_for_function("fetch('/api/session/accounts').then(r=>r.json()).then(d=>d.state.accounts.length===0)")
        assert not errors, errors
        print('PASS: five roles, one-click switching, cross-tab synchronization, bounds, draft isolation, stale writes, restart persistence, logout all')
    except Exception:
        print('Auth status:', tab.locator('#auth-message').all_text_contents(), flush=True)
        print('Picker status:', tab.locator('.account-picker-error').all_text_contents(), flush=True)
        tab.screenshot(path=str(evidence / 'failure.png'))
        raise
    finally:
        browser.close()
