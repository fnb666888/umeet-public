"""Validate disposition UI using isolated local fixtures created for this run."""
import atexit
import json
import subprocess
import uuid
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

base = 'http://127.0.0.1:5178'
subprocess.run(['node', '--import', 'tsx', 'tests/web/disposition-fixtures.mjs', 'setup'], check=True)
atexit.register(lambda: subprocess.run(['node', '--import', 'tsx', 'tests/web/disposition-fixtures.mjs', 'cleanup'], check=True))
fixture = json.loads(Path('.runtime/disposition-ui-fixture.json').read_text(encoding='utf-8-sig'))
passwords = json.loads(Path('.runtime/local-moderation-demo-accounts.json').read_text(encoding='utf-8-sig'))
headers = {'Origin': base}

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    errors = []
    def session(credentials):
        context = browser.new_context(viewport={'width': 1440, 'height': 900})
        response = context.request.post(base + '/api/session/login', data=credentials, headers=headers)
        assert response.ok, response.status
        page = context.new_page()
        page.on('pageerror', lambda error: errors.append(str(error)))
        return context, page
    def post(context, path, data):
        state = context.request.get(base + '/api/session/accounts').json()['state']
        bound = {**headers, 'X-Umeet-Account': state['currentUserId'], 'X-Umeet-Browser-Version': str(state['version'])}
        response = context.request.post(base + '/api/backend/' + path, data=data, headers=bound)
        assert response.ok, (response.status, response.text())
        return response.json()
    admin, page = session(json.loads(Path('.runtime/local-admin-login.json').read_text(encoding='utf-8-sig')))
    author, author_page = session({key: fixture[key] for key in ['username', 'password']})
    reviewer, review_page = session({key: fixture['reviewer'][key] for key in ['username', 'password']})
    moderator, mod_page = session({'username': 'preview_fang', 'password': passwords['preview_fang']})
    post(author, 'demo/operations', {'id': str(uuid.uuid4()), 'operations': [{'type': 'post.create', 'post': {'id': fixture['postId'], 'title': '处置交互验收', 'body': '用于验证组合处置和申诉流程。', 'community': 'questions'}}]})
    report = post(moderator, 'governance/reports', {'target': 'post:' + fixture['postId'], 'category': 'spam', 'detail': '组合处置测试'})
    fixture['reportId'] = report['id']
    Path('.runtime/disposition-ui-fixture.json').write_text(json.dumps(fixture), encoding='utf-8')
    if 'actionId' not in fixture:
        page.goto(base + '/admin?view=reports&record=' + fixture['reportId'])
        page.wait_for_load_state('networkidle')
        expect(page.get_by_role('button', name='保留内容', exact=True)).to_be_visible()
        page.get_by_role('button', name='删除内容', exact=True).click()
        page.get_by_label('同时限制作者参与', exact=True).check()
        expect(page.get_by_role('combobox', name='限制范围', exact=True)).to_have_value('global')
        page.get_by_role('combobox', name='限制范围', exact=True).select_option('community')
        page.get_by_role('combobox', name='有效期', exact=True).select_option('0')
        page.get_by_label('处理原因', exact=True).fill('页面验收，删除内容并永久限制社区参与')
        for theme in ['light', 'dark']:
            page.locator('html').evaluate('(el, theme) => el.dataset.theme = theme', theme)
            for width in [1440, 871, 390]:
                page.set_viewport_size({'width': width, 'height': 900})
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), (theme, width)
                page.screenshot(path=f'.runtime/dispositions-report-{theme}-{width}.png', full_page=True)
        page.locator('.admin-confirm button[type=submit]').click()
        expect(page.get_by_text('操作已完成', exact=True)).to_be_visible()
        actions = author.request.get(base + '/api/backend/governance').json()['actions']
        combined = next(action for action in actions if len(action.get('effects', [])) == 2)
        fixture['actionId'] = combined['id']
        Path('.runtime/disposition-ui-fixture.json').write_text(json.dumps(fixture), encoding='utf-8')
    else:
        combined = {'id': fixture['actionId']}
    mod_page.goto(base + '/moderation?view=users&board=questions')
    mod_page.wait_for_load_state('networkidle')
    expect(mod_page.get_by_role('navigation', name='用户分类').get_by_role('button', name='受限用户', exact=True)).to_have_attribute('aria-current', 'page')
    mod_page.get_by_role('button', name='管理用户 ' + fixture['username'], exact=True).click()
    expect(mod_page.get_by_role('button', name='限制参与', exact=True)).to_have_count(0)
    mod_page.get_by_role('button', name='账号操作', exact=True).click()
    expect(mod_page.get_by_role('button', name='调整限制参与', exact=True)).to_be_visible()
    expect(mod_page.get_by_role('button', name='解除限制参与', exact=True)).to_be_visible()
    mod_page.screenshot(path='.runtime/dispositions-user-detail.png', full_page=True)
    appeal = post(author, 'governance/appeals', {'actionId': combined['id'], 'reason': '请分别复核内容删除和社区限制'})
    review_page.goto(base + '/admin?view=appeals&record=' + appeal['id'])
    review_page.wait_for_load_state('networkidle')
    review_page.get_by_role('button', name='维持原处置', exact=True).click()
    decisions = review_page.locator('.admin-appeal-decisions select')
    expect(decisions).to_have_count(2)
    content = review_page.locator('.admin-appeal-decisions label').filter(has_text='内容删除').locator('select')
    content.select_option('reversed')
    review_page.get_by_label('处理原因', exact=True).fill('恢复内容，维持社区参与限制')
    review_page.screenshot(path='.runtime/dispositions-appeal.png', full_page=True)
    review_page.locator('.admin-confirm button[type=submit]').click()
    expect(review_page.get_by_text('操作已完成', exact=True)).to_be_visible()
    governance = author.request.get(base + '/api/backend/governance').json()
    assert next(action for action in governance['actions'] if action['id'] == combined['id'])['appeal']['status'] == 'partial'
    page.goto(base + '/admin?view=users')
    page.wait_for_load_state('networkidle')
    page.get_by_role('button', name='管理用户 ' + fixture['username'], exact=True).click()
    page.get_by_role('button', name='账号操作', exact=True).click()
    page.get_by_role('button', name='停用账号', exact=True).click()
    page.get_by_role('combobox', name='有效期', exact=True).select_option('24')
    page.get_by_label('处理原因', exact=True).fill('停用账号专用申诉页验收')
    page.locator('.admin-confirm button[type=submit]').click()
    expect(page.get_by_text('操作已完成', exact=True)).to_be_visible()
    author_page.goto(base)
    author_page.wait_for_url('**/account/dispositions')
    expect(author_page.get_by_role('heading', name='账号已停用', exact=True)).to_be_visible()
    expect(author_page.get_by_role('button', name='提交申诉', exact=True)).to_have_count(1)
    author_page.get_by_role('button', name='提交申诉', exact=True).click()
    author_page.get_by_label('申诉说明', exact=True).fill('停用账号仍能提出申诉')
    author_page.get_by_role('button', name='提交复核', exact=True).click()
    expect(author_page.get_by_role('button', name='提交申诉', exact=True)).to_have_count(0)
    author_page.get_by_role('button', name='查看登录设备', exact=True).click()
    expect(author_page.get_by_text('当前设备', exact=False)).to_be_visible()
    author_page.get_by_label('当前密码', exact=True).fill(fixture['password'])
    author_page.get_by_role('button', name='确认身份', exact=True).click()
    expect(author_page.get_by_text('身份已验证，可以退出其他设备', exact=True)).to_be_visible()
    for width in [1440, 871, 390]:
        author_page.set_viewport_size({'width': width, 'height': 900})
        assert author_page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        author_page.screenshot(path=f'.runtime/dispositions-account-{width}.png', full_page=True)
    assert not errors, errors
    browser.close()
    print('PASS combined disposition, community permanent limit, moderator menu, partial appeal, deactivation, security and responsive UI')
