"""Local production-build regression for continuous community feeds."""
import asyncio,json,time
from pathlib import Path
from playwright.async_api import async_playwright
BASE='http://127.0.0.1:5180'
async def main():
 accounts=json.loads(Path('.runtime/local-role-accounts.json').read_text(encoding='utf-8-sig'))['accounts']
 report={'pages':[],'errors':[],'requests':[]}
 async with async_playwright() as p:
  browser=await p.chromium.launch(channel='msedge',headless=True)
  context=await browser.new_context()
  response=await context.request.post(BASE+'/api/session/login',data={key:accounts[0][key] for key in ['username','password']},headers={'Origin':BASE})
  assert response.status==200,'LOCAL_QA_LOGIN'
  page=await context.new_page()
  page.on('pageerror',lambda e:report['errors'].append(str(e)))
  page.on('request',lambda r:report['requests'].append(r.url) if '/api/backend/demo' in r.url else None)
  await page.goto(BASE);await page.locator('#feed .row-item').first.wait_for();await page.wait_for_load_state('networkidle')
  assert await page.locator('#feed .row-item').count()==20
  for expected in [40,60,65]:
   start=time.perf_counter();await page.locator('[data-feed-continuation]').scroll_into_view_if_needed()
   await page.wait_for_function('(count)=>document.querySelectorAll("#feed .row-item").length>=count',arg=expected)
   report['pages'].append({'atLeast':expected,'ms':round((time.perf_counter()-start)*1000)})
  ids=await page.locator('#feed .topic-title-line a').evaluate_all('(links)=>links.map(link=>link.href)')
  assert len(ids)==len(set(ids)),'DUPLICATE_POSTS'
  before=await page.locator('#feed .row-item').count()
  await page.locator('#feed .row-item').last.locator('a.r-title, .topic-title-line a').first.click()
  await page.locator('article[data-topic]').wait_for();await page.wait_for_load_state('networkidle')
  liked=await page.locator('.like-post').first.get_attribute('aria-pressed')
  await page.locator('.like-post').first.click()
  await page.wait_for_function('(before)=>document.querySelector(".like-post").getAttribute("aria-pressed")!==before',arg=liked)
  starred=await page.locator('.star').first.get_attribute('aria-pressed')
  await page.locator('.star').first.click()
  await page.wait_for_function('(before)=>document.querySelector(".star").getAttribute("aria-pressed")!==before',arg=starred)
  await page.locator('#post-back').click();await page.locator('#feed .row-item').first.wait_for()
  assert await page.locator('#feed .row-item').count()>=before,'LOST_APPENDED_PAGES'
  await page.goto(BASE+'/community/discover');await page.locator('.discover-grid').wait_for()
  await page.goto(BASE+'/community/c/daily');await page.locator('#c-feed .row-item').first.wait_for()
  await page.locator('#board-sort').select_option('latest');await page.wait_for_url('**/community/c/daily?sort=latest')
  await page.locator('#c-feed .row-item').first.wait_for()
  assert not report['errors'],report['errors']
  await browser.close()
 Path('.runtime/community-infinite.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
 print(json.dumps(report,ensure_ascii=True))
asyncio.run(main())
