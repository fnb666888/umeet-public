"""Local browser integration: Markdown editor, conflict merge, history and rollback."""
import json
import re
import time
from playwright.sync_api import sync_playwright, expect

BASE = 'http://127.0.0.1:5178'
with sync_playwright() as p:
    browser = p.chromium.launch(channel='msedge', headless=True)
    context = browser.new_context(viewport={'width': 1440, 'height': 1000})
    page = context.new_page()
    page.goto(BASE)
    page.wait_for_load_state('networkidle')
    suffix = str(time.time_ns())[-16:]
    page.goto(BASE + '/c/resources/wiki')
    page.get_by_role('link', name='新建词条', exact=True).click()
    title = '信息熵与共同编辑 ' + suffix
    slug = 'entropy-' + suffix
    page.get_by_label('词条标题', exact=True).fill(title)
    page.get_by_label('词条标识', exact=True).fill(slug)
    source = '# 学习笔记\n\n第一版内容。\n\n| 概念 | 含义 |\n| --- | --- |\n| 熵 | 不确定性 |\n\n$$\nH(X)=-\\sum p(x)\\log p(x)\n$$\n\n[[' + slug + '|本词条]]\n'
    page.get_by_role('button', name='Markdown 源码', exact=True).click()
    page.get_by_label('Markdown 正文', exact=True).fill(source)
    page.get_by_role('button', name='可视化', exact=True).click()
    expect(page.get_by_role('textbox', name='可视化正文')).to_be_visible()
    page.get_by_role('button', name='Markdown 源码', exact=True).click()
    assert '第一版内容' in page.get_by_label('Markdown 正文', exact=True).input_value()
    page.get_by_label('修改说明', exact=True).fill('创建词条')
    page.get_by_role('button', name='登录 / 注册', exact=True).click()
    page.get_by_role('button', name='注册', exact=True).click()
    page.get_by_label('用户名', exact=True).fill('wiki_' + suffix)
    page.get_by_label('密码', exact=True).fill('Wiki Test Password 84!')
    page.get_by_role('button', name='注册账号', exact=True).click()
    expect(page.locator('header').get_by_text('我的账号', exact=True)).to_be_visible()
    expect(page.get_by_label('词条标题', exact=True)).to_have_value(title)
    expect(page.get_by_label('Markdown 正文', exact=True)).to_have_value(source)
    try:
        with page.expect_response(lambda r: r.url.endswith('/api/backend/wiki') and r.request.method == 'POST', timeout=5000) as saved:
            page.get_by_role('button', name='发布词条', exact=True).click()
    except Exception:
        print(page.locator('main').inner_text())
        print('fields:', page.locator('main input').evaluate_all('(items)=>items.map(item=>item.value)'))
        raise
    assert saved.value.ok, saved.value.text()
    page.wait_for_url(re.compile(re.escape(BASE) + r'/wiki/[a-z0-9-]+$'))
    wiki_url = page.url
    expect(page.get_by_role('heading', name=title, exact=True)).to_be_visible()
    expect(page.locator('article table')).to_be_visible()
    expect(page.locator('article .katex').first).to_be_visible()
    expect(page.get_by_role('link', name='本词条', exact=True)).to_have_attribute('href', '/c/resources/wiki/' + slug)
    second = context.new_page()
    page.goto(wiki_url + '/edit')
    second.goto(wiki_url + '/edit')
    for tab in [page, second]:
        tab.get_by_role('button', name='Markdown 源码', exact=True).click()
    page.get_by_label('Markdown 正文', exact=True).fill(source + '\n第一位的修改。')
    page.get_by_label('词条标题', exact=True).fill('第一位修改的标题 ' + suffix)
    page.get_by_role('button', name='保存新版本', exact=True).click()
    page.wait_for_url(wiki_url)
    mine = source + '\n第二位保留的修改。'
    second.get_by_label('Markdown 正文', exact=True).fill(mine)
    second.get_by_role('button', name='可视化', exact=True).click()
    expect(second.get_by_role('textbox', name='可视化正文')).to_be_visible()
    second.get_by_role('button', name='保存新版本', exact=True).click()
    expect(second.get_by_role('region', name='合并版本冲突')).to_be_visible()
    expect(second.get_by_label('合并后的正文', exact=True)).to_have_value(mine)
    expect(second.get_by_label('当前公开标题', exact=True)).to_have_value('第一位修改的标题 ' + suffix)
    second.get_by_label('合并后的标题', exact=True).fill('人工合并的标题 ' + suffix)
    second.get_by_label('合并后的正文', exact=True).fill(source + '\n第一位的修改。\n第二位保留的修改。')
    second.get_by_role('button', name='使用合并结果继续编辑', exact=True).click()
    # The editor must display the merged document as well as sending it.
    expect(second.get_by_role('textbox', name='可视化正文')).to_contain_text('第一位的修改。')
    second.get_by_role('button', name='保存新版本', exact=True).click()
    second.wait_for_url(wiki_url)
    expect(second.locator('article')).to_contain_text('第二位保留的修改。')
    expect(second.get_by_role('heading', name='人工合并的标题 ' + suffix, exact=True)).to_be_visible()
    second.get_by_role('link', name='修订历史', exact=True).click()
    expect(second.locator('.revision-row')).to_have_count(3)
    second.get_by_role('button', name='比较版本', exact=True).click()
    expect(second.locator('.diff-added')).to_contain_text('第二位保留的修改。')
    second.get_by_role('button', name='回滚到此版', exact=True).last.click()
    second.get_by_role('button', name='确认创建回滚版本', exact=True).click()
    second.wait_for_url(wiki_url)
    expect(second.locator('article')).not_to_contain_text('第二位保留的修改。')
    second.get_by_role('link', name='修订历史', exact=True).click()
    expect(second.locator('.revision-row')).to_have_count(4)
    second.screenshot(path='docs/evidence/web-wiki-history.png', full_page=True)
    for width in [320, 390, 768, 1440]:
        second.set_viewport_size({'width': width, 'height': 900})
        assert second.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), f'Overflow at {width}'
    second.goto(wiki_url)
    second.wait_for_load_state('networkidle')
    expect(second.locator('header').get_by_text('我的账号', exact=True)).to_be_visible()
    second.set_viewport_size({'width': 390, 'height': 844})
    second.screenshot(path='docs/evidence/web-wiki-mobile.png', full_page=True)
    print(json.dumps({'journey': 'create -> mode switch -> concurrent conflict -> merge -> diff -> rollback', 'result': 'pass'}))
    context.close()
    browser.close()
