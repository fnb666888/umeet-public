"""Real browser + real local TLS SMTP sink, with no provider or real recipient."""
import json
import time
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
BASE = 'http://127.0.0.1:5178'
DELIVERIES = Path('.runtime/smtp-fixture/deliveries.json')
def delivered_code(recipient):
    entries = json.loads(DELIVERIES.read_text(encoding='utf-8'))
    return next(entry['code'] for entry in reversed(entries) if entry['recipient'] == recipient)
with sync_playwright() as p:
    browser = p.chromium.launch(channel='msedge', headless=True)
    context = browser.new_context(viewport={'width':1440,'height':1000})
    page = context.new_page()
    page.goto(BASE)
    page.wait_for_load_state('networkidle')
    page.get_by_role('button', name='登录 / 注册', exact=True).click()
    page.get_by_role('button', name='先以游客身份体验', exact=True).click()
    expect(page.locator('header').get_by_text('游客', exact=True)).to_be_visible()
    page.goto(BASE + '/me')
    page.get_by_label('草稿内容', exact=True).fill('邮箱升级后保留的私人草稿')
    page.get_by_role('button',name='保存草稿',exact=True).click()
    expect(page.get_by_role('status')).to_contain_text('已保存')
    page.get_by_role('button',name='升级账号',exact=True).click()
    page.get_by_role('button',name='邮箱验证码',exact=True).click()
    address='otp_' + str(time.time_ns())[-16:] + '@fixture.invalid'
    page.get_by_label('邮箱地址',exact=True).fill(address)
    with page.expect_response(lambda r:r.url.endswith('/api/verification/request')) as pending:
        page.get_by_role('button',name='获取验证码',exact=True).click()
    assert pending.value.ok, pending.value.text()
    assert 'code' not in pending.value.json()
    page.get_by_label('邮箱验证码',exact=True).fill(delivered_code(address))
    page.get_by_role('button',name='继续登录 / 注册',exact=True).click()
    expect(page.locator('header').get_by_text('我的账号',exact=True)).to_be_visible()
    expect(page.get_by_label('草稿内容',exact=True)).to_have_value('邮箱升级后保留的私人草稿')
    cookie=next(c for c in context.cookies() if c['name']=='umeet_session')
    assert cookie['httpOnly'] and page.evaluate("document.cookie.includes('umeet_session')") is False
    assert context.request.post(BASE+'/api/verification/request',headers={'Origin':'https://foreign.invalid'},data={'channel':'email','recipient':address}).status==403
    page.goto(BASE+'/me/security')
    expect(page.get_by_role('heading',name='账号与登录',exact=True)).to_be_visible()
    username='otp_member_' + str(time.time_ns())[-16:]
    password='A Verified Password 42!'
    page.get_by_label('登录用户名',exact=True).fill(username)
    page.get_by_label('新密码',exact=True).fill(password)
    page.get_by_label('再次输入新密码',exact=True).fill(password)
    page.get_by_role('button',name='更新密码',exact=True).click()
    expect(page.get_by_role('status').filter(has_text='密码已更新')).to_be_visible()
    assert page.get_by_label('新密码',exact=True).input_value()==''
    page.get_by_role('button',name='退出',exact=True).click()
    page.locator('header').get_by_role('button',name='登录 / 注册',exact=True).click()
    page.get_by_label('用户名',exact=True).fill(username)
    page.get_by_label('密码',exact=True).fill(password)
    page.locator('dialog form').get_by_role('button',name='登录',exact=True).click()
    expect(page.locator('header').get_by_text('我的账号',exact=True)).to_be_visible()
    expect(page.locator('main')).to_contain_text(username)
    bound='bound_' + str(time.time_ns())[-16:] + '@fixture.invalid'
    page.get_by_label('邮箱地址',exact=True).fill(bound)
    with page.expect_response(lambda r:r.url.endswith('/api/verification/request')) as pending:
        page.get_by_role('button',name='获取验证码',exact=True).click()
    assert pending.value.ok, pending.value.text()
    page.get_by_label('邮箱验证码',exact=True).fill(delivered_code(bound))
    page.get_by_role('button',name='确认绑定',exact=True).click()
    expect(page.get_by_role('status').filter(has_text='已添加登录方式')).to_be_visible()
    page.get_by_role('button',name='退出',exact=True).click()
    page.locator('header').get_by_role('button',name='登录 / 注册',exact=True).click()
    page.get_by_role('button',name='邮箱验证码',exact=True).click()
    page.get_by_label('邮箱地址',exact=True).fill(bound)
    with page.expect_response(lambda r:r.url.endswith('/api/verification/request')) as cooldown:
        page.get_by_role('button',name='获取验证码',exact=True).click()
    assert cooldown.value.status==429
    expect(page.get_by_role('alert').filter(has_text='验证码请求过于频繁')).to_be_visible()
    print('Checking real resend cooldown before logging in with the new binding...',flush=True)
    resend=page.locator('dialog').get_by_role('button',name='获取验证码',exact=True)
    expect(resend).to_be_enabled(timeout=65000)
    with page.expect_response(lambda r:r.url.endswith('/api/verification/request')) as sent_again:
        resend.click()
    assert sent_again.value.ok, sent_again.value.text()
    page.get_by_label('邮箱验证码',exact=True).fill(delivered_code(bound))
    page.get_by_role('button',name='继续登录 / 注册',exact=True).click()
    expect(page.locator('header').get_by_text('我的账号',exact=True)).to_be_visible()
    expect(page.locator('main')).to_contain_text(username)
    page.screenshot(path='docs/evidence/web-account-security.png',full_page=True)
    for width in [320,390,768,1440]:
        page.set_viewport_size({'width':width,'height':900})
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), f'Overflow at {width}'
    print(json.dumps({'journey':'real local TLS SMTP -> guest upgrade -> password setup -> bind email -> resend cooldown -> same-account email login', 'result':'pass'}))
    context.close();browser.close()
