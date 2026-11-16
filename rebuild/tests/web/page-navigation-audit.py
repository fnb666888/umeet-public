"""Read-only navigation audit against a local production build and QA fixtures."""
import asyncio, json, os, time
from pathlib import Path
from urllib.parse import urlparse
from playwright.async_api import async_playwright

BASE = os.environ.get('AUDIT_BASE', 'http://127.0.0.1:5180')
assert urlparse(BASE).hostname in ('127.0.0.1', 'localhost'), 'LOCAL_ONLY'
accounts = json.loads(Path('.runtime/local-role-accounts.json').read_text(encoding='utf-8-sig'))['accounts']
fixture = json.loads(Path('.runtime/knowledge-fixture.json').read_text(encoding='utf-8-sig'))
post = json.loads(Path('.runtime/home-audit-post.json').read_text(encoding='utf-8'))
report = {'base': BASE, 'mode': 'production', 'pages': [], 'clicks': [], 'errors': []}

async def settled(page):
    await page.wait_for_function("""() => window.__pendingAuditApi === 0 && !document.querySelector('.account-loading') && !document.querySelector('main[aria-busy=true]') && ![...document.querySelectorAll('main [role=status], main .empty, main .admin-empty, #feed .feed-end')].some(e => e.getClientRects().length && /正在加载|加载中|正在读取|正在打开|正在同步/.test(e.textContent))""", timeout=12000)

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(channel='msedge', headless=True)
        nojs = await browser.new_context(java_script_enabled=False)
        page = await nojs.new_page()
        await page.goto(BASE)
        assert await page.locator('#feed .row-item').count() == 20, 'SSR_FIRST_BATCH_MISSING'
        await nojs.close()
        slow = await browser.new_context()
        page = await slow.new_page()
        async def slow_account(route):
            await asyncio.sleep(3)
            try: await route.continue_()
            except Exception: pass
        await page.route('**/api/session/accounts', slow_account)
        start = time.perf_counter()
        await page.goto(BASE, wait_until='domcontentloaded')
        await page.locator('#feed .row-item').first.wait_for()
        report['publicBeforeAccountMs'] = round((time.perf_counter()-start)*1000)
        assert report['publicBeforeAccountMs'] < 3000
        await slow.close()
        context = await browser.new_context()
        await context.add_init_script("""window.__pendingAuditApi=0;const auditFetch=window.fetch.bind(window);window.fetch=(...args)=>{const api=String(args[0]).includes('/api/');if(api)window.__pendingAuditApi++;return auditFetch(...args).finally(()=>{if(api)window.__pendingAuditApi--})};""")
        response = await context.request.post(BASE + '/api/session/login', data={
            'username': accounts[0]['username'], 'password': accounts[0]['password'],
        }, headers={'Origin': BASE})
        assert response.status == 200, 'QA_LOGIN_FAILED'
        page = await context.new_page()
        page.on('pageerror', lambda error: report['errors'].append(str(error)))
        routes = ['/community/discover', '/community/settings', '/community/inbox', '/', '/#/discover', '/#/bookmarks', '/#/inbox', '/#/me', '/#/settings',
                  '/#/settings/privacy', '/#/my-applications', '/#/apply-board', '/#/apply-moderator',
                  '/#/c/daily', '/#/c/questions', '/#/c/market', '/#/c/treehole', '/#/c/buddies', '/#/c/resources',
                  '/#/c/news', '/#/c/forecasts', '/#/search?q=test', '/#/posts/' + post['id'],
                  '/#/users/' + accounts[0]['userId'], '/knowledge', '/knowledge/new', '/knowledge/manage',
                  '/c/daily/knowledge', '/knowledge/routes/' + fixture['routeId'], '/account/dispositions',
                  '/admin', '/moderation', '/moderation/discussions',
                  '/communities', '/me', '/me/security', '/search?q=test', '/posts/' + post['id'], '/wiki',
                  '/#/tag/test', '/#/settings/notifications', '/#/settings/security', '/#/apply-assistant',
                  '/c/daily', '/c/daily/wiki', '/c/daily/wiki/new', '/c/daily/wiki/missing-entry',
                  '/wiki/missing-entry', '/wiki/missing-entry/edit', '/wiki/missing-entry/history']
        for entry in fixture['pages'].values():
            routes += ['/knowledge/' + entry['id'], '/knowledge/' + entry['id'] + '/edit']
        for route in routes:
            start = time.perf_counter()
            try:
                response = await page.goto(BASE + route, wait_until='domcontentloaded')
                if route.startswith('/#/'):
                    await page.wait_for_url(lambda url: '/#/' not in url,timeout=5000)
                if route == '/moderation': await page.wait_for_url(BASE + '/admin')
                await settled(page)
                warm_ms = round((time.perf_counter()-start)*1000)
                cold_start = time.perf_counter()
                await page.reload(wait_until='domcontentloaded')
                await settled(page)
                alerts = await page.locator('[role=alert]:visible').all_text_contents()
                row = {'route': route, 'warmMs': warm_ms, 'coldMs': round((time.perf_counter()-cold_start)*1000),
                       'http': response.status if response else None, 'alerts': [a for a in alerts if a.strip()]}
                controls = page.locator('main button:visible:enabled')
                row['enabledButtons'] = await controls.count()
                safe = controls.filter(has_text=__import__('re').compile('^(最新|热门|卡片|紧凑|全部|文章|路线|目录|历史|返回|个人资料|隐私|通知|下一页|上一页|概览)$')).first
                if await safe.count():
                    row['probe'] = await safe.inner_text()
                    await safe.click(); await settled(page); row['probeOk'] = True
                report['pages'].append(row)
            except Exception as error:
                report['pages'].append({'route': route, 'ms': round((time.perf_counter()-start)*1000), 'failure': str(error)[:300]})
        await page.goto(BASE); await settled(page)
        # Exercise actual visible links, rather than assigning URLs.
        for href, expected in [('/community/discover', '.discover-grid'), ('/community/bookmarks', 'main#main'),
                               ('/community/inbox', 'main#main'), ('/community/me', 'main#main'), ('/', '#feed')]:
            link = page.locator('a[href="' + href + '"]:visible').first
            if not await link.count():
                await page.locator('#btn-avatar').click()
                link = page.locator('a[href="' + href + '"]:visible').first
            start = time.perf_counter()
            try:
                await link.click(timeout=4000)
                await page.wait_for_url(BASE + href)
                await page.locator(expected).wait_for(state='visible')
                await settled(page)
                report['clicks'].append({'href': href, 'ms': round((time.perf_counter()-start)*1000), 'ok': True})
            except Exception as error:
                report['clicks'].append({'href': href, 'ok': False, 'failure': str(error)[:250]})
        await page.goto(BASE + '/admin'); await settled(page)
        for title in ['用户管理', '内容管理', '资讯与预测', 'Wiki 管理', '群组管理', '站点设置', '申请管理']:
            start = time.perf_counter()
            try:
                await page.get_by_role('button', name=title, exact=True).click()
                await settled(page)
                report['clicks'].append({'admin': title, 'ms': round((time.perf_counter()-start)*1000), 'ok': True})
            except Exception as error:
                report['clicks'].append({'admin': title, 'ok': False, 'failure': str(error)[:250]})
        await browser.close()
    Path('.runtime/page-navigation-audit.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(report,ensure_ascii=True))

asyncio.run(main())
