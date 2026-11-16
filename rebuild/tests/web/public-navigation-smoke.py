"""Read-only production navigation/authorization probe; creates no accounts or data."""
import asyncio,json,time
from pathlib import Path
from playwright.async_api import async_playwright
BASE='https://example.com'
async def main():
 report={'base':BASE,'pages':[],'clicks':[],'errors':[]}
 async with async_playwright() as p:
  b=await p.chromium.launch(channel='msedge',headless=True);c=await b.new_context(viewport={'width':1440,'height':1000})
  pg=await c.new_page();pg.on('pageerror',lambda e:report['errors'].append(str(e)))
  for path in ['/','/community/discover','/knowledge','/community/c/news','/community/c/forecasts','/community/search?q=test','/admin']:
   start=time.perf_counter();r=await pg.goto(BASE+path,wait_until='domcontentloaded',timeout=60000)
   await pg.wait_for_function("!!document.querySelector('main')",timeout=15000)
   await pg.wait_for_timeout(800)
   report['pages'].append({'path':path,'http':r.status,'documentMs':round((time.perf_counter()-start)*1000),'url':pg.url})
   assert r.status==200,(path,r.status)
  for endpoint in ['/api/backend/admin/community/access','/api/backend/account']:
   r=await c.request.get(BASE+endpoint);assert r.status==401,(endpoint,r.status)
  await pg.goto(BASE);await pg.wait_for_load_state('networkidle',timeout=30000)
  await pg.evaluate('window.__publicDocument=12345')
  for href,selector in [('/community/discover','.discover-grid'),('/knowledge','main#main'),('/','#feed')]:
   link=pg.locator('a[href="'+href+'"]:visible').first
   start=time.perf_counter();await link.click();await pg.wait_for_url(BASE+href)
   await pg.locator(selector).wait_for()
   assert await pg.evaluate('window.__publicDocument')==12345
   report['clicks'].append({'href':href,'readyMs':round((time.perf_counter()-start)*1000)})
  await pg.goto(BASE+'/#/discover');await pg.wait_for_url(BASE+'/community/discover',timeout=30000);await pg.locator('.discover-grid').wait_for()
  report['legacyBookmark']=True
  for width in [390,1440]:
   await pg.set_viewport_size({'width':width,'height':1000});await pg.wait_for_timeout(100)
   assert await pg.evaluate('document.documentElement.scrollWidth<=innerWidth'),width
  assert not report['errors'],report['errors']
  await b.close()
 Path('docs/evidence/performance/production-architecture-2026-11-15.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
 print(json.dumps(report,ensure_ascii=True))
asyncio.run(main())
