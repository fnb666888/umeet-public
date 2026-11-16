"""Real local browser journey. Never points at a hosted or production database."""
import json
import time
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

BASE = 'http://127.0.0.1:5178'
with sync_playwright() as p:
    browser = p.chromium.launch(channel='msedge', headless=True)
    context = browser.new_context(viewport={'width': 1440, 'height': 1000})
    page = context.new_page()
    page.goto(BASE)
    page.wait_for_load_state('networkidle')
    for name in ['树洞', '交易', '资源', '问答', '搭子与活动', '校园日常']:
        expect(page.locator('aside').get_by_role('link', name=name, exact=True)).to_be_visible()
    page.get_by_role('button', name='登录 / 注册', exact=True).click()
    page.get_by_role('button', name='先以游客身份体验', exact=True).click()
    expect(page.locator('header').get_by_text('游客', exact=True)).to_be_visible()
    page.goto(BASE + '/me')
    expect(page.get_by_role('heading', name='我的记录', exact=True)).to_be_visible()
    page.get_by_label('草稿内容').fill('从游客保存到正式账号的草稿。')
    page.get_by_role('button', name='保存草稿', exact=True).click()
    expect(page.get_by_role('status')).to_contain_text('已保存')
    page.get_by_role('button', name='升级账号', exact=True).click()
    username = 'browser_' + str(time.time_ns())[-16:]
    password = 'Browser Test Password 42!'
    page.get_by_label('用户名', exact=True).fill(username)
    page.get_by_label('密码', exact=True).fill(password)
    page.get_by_role('button', name='注册账号', exact=True).click()
    expect(page.locator('header').get_by_text('我的账号', exact=True)).to_be_visible()
    assert page.locator('dialog input[name=password]').input_value() == '', 'A successful login must clear the password field'
    expect(page.get_by_label('草稿内容')).to_have_value('从游客保存到正式账号的草稿。')
    cookie = next(c for c in context.cookies() if c['name'] == 'umeet_session')
    assert cookie['httpOnly'] and cookie['sameSite'] == 'Lax'
    assert page.evaluate("document.cookie.indexOf('umeet_session')") == -1
    assert context.request.post(BASE + '/api/session/logout', headers={'Origin': 'https://foreign.invalid'}, data={}).status == 403
    page.get_by_role('button', name='退出', exact=True).click()
    expect(page.get_by_role('button', name='登录 / 注册', exact=True)).to_be_visible()
    page.get_by_role('button', name='登录 / 注册', exact=True).click()
    page.get_by_label('用户名', exact=True).fill(username)
    page.get_by_label('密码', exact=True).fill(password)
    page.locator('dialog form').get_by_role('button', name='登录', exact=True).click()
    expect(page.locator('header').get_by_text('我的账号', exact=True)).to_be_visible()
    expect(page.get_by_label('草稿内容')).to_have_value('从游客保存到正式账号的草稿。')
    Path('docs/evidence').mkdir(parents=True, exist_ok=True)
    page.screenshot(path='docs/evidence/web-records-desktop.png', full_page=True)
    for width in [320, 390, 768, 1440]:
        page.set_viewport_size({'width': width, 'height': 900})
        assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), f'Overflow at {width}'
    page.set_viewport_size({'width': 390, 'height': 844})
    page.screenshot(path='docs/evidence/web-records-mobile.png', full_page=True)
    print(json.dumps({'journey': 'guest draft -> register -> logout -> login', 'result': 'pass', 'widths': [320, 390, 768, 1440]}))
    context.close()
    browser.close()
