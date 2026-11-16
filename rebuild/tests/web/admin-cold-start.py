import asyncio, json, time, sys, os
from pathlib import Path
from playwright.async_api import async_playwright
BASE = os.environ.get('COLD_ADMIN_BASE', 'http://127.0.0.1:5180')
async def main():
    account = json.loads(Path('.runtime/local-role-accounts.json').read_text(encoding='utf-8-sig'))['accounts'][0]
    report = {'runs': [], 'errors': []}
    async with async_playwright() as p:
        browser = await p.chromium.launch(channel='msedge', headless=True)
        context = await browser.new_context()
        login = await context.request.post(BASE + '/api/session/login', data={k: account[k] for k in ['username', 'password']}, headers={'Origin': BASE})
        assert login.ok, login.status
        cookies = await context.cookies(); await context.close()
        for delay in [0, 3000]:
            context = await browser.new_context(); await context.add_cookies(cookies)
            page = await context.new_page()
            page.on('pageerror', lambda e: report['errors'].append(str(e)))
            requests = []; start = time.perf_counter()
            page.on('request', lambda r: requests.append({'path': r.url.split(BASE)[-1], 'startMs': round((time.perf_counter()-start)*1000)}) if '/api/' in r.url else None)
            async def slow(route):
                await asyncio.sleep(delay/1000)
                try: await route.continue_()
                except Exception: pass
            await page.route('**/api/session/accounts', slow)
            response = await page.goto(BASE + '/admin', wait_until='domcontentloaded')
            html = await response.text()
            await page.get_by_role('button', name='用户管理', exact=True).wait_for()
            await page.wait_for_function("!document.querySelector('main')?.innerText.includes('正在加载管理数据')")
            ready = round((time.perf_counter()-start)*1000)
            report['runs'].append({'accountListDelayMs': delay, 'readyMs': ready, 'htmlHasLoadingText': '正在加载管理数据' in html, 'requestsAtReady': list(requests)})
            if '--verify' in sys.argv:
                assert '正在加载管理数据' not in html, 'Default admin document must contain its authorized queue'
                assert not any('/admin/community/items?' in r['path'] or '/admin/community/bootstrap?' in r['path'] for r in requests), requests
                assert ready < 3000, ready
                await page.wait_for_timeout(delay + 250)
                assert '正在加载管理数据' not in await page.locator('main').inner_text()
                assert '账号或管理权限已变化' not in await page.locator('main').inner_text()
                await page.get_by_role('button', name='用户管理', exact=True).click()
                await page.wait_for_function("!document.querySelector('main')?.innerText.includes('正在加载管理数据')")
                await page.get_by_role('button', name='内容管理', exact=True).click()
            await context.close()
        await browser.close()
    suffix = ('-after' if '--verify' in sys.argv else '-before') + ('-slow-sql' if os.environ.get('COLD_ADMIN_BASE') else '')
    Path('.runtime/admin-cold-browser' + suffix + '.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(report))
asyncio.run(main())
