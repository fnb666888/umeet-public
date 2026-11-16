"""Local production regression: actual client navigation, history and draft guards."""
import asyncio, json, time
from pathlib import Path
from playwright.async_api import async_playwright
BASE='http://127.0.0.1:5180'
report={'checks':[], 'errors':[], 'transitions':[]}
async def main():
 accounts=json.loads(Path('.runtime/local-role-accounts.json').read_text(encoding='utf-8-sig'))['accounts']
 post=json.loads(Path('.runtime/home-audit-post.json').read_text(encoding='utf-8'))
 async with async_playwright() as p:
  b=await p.chromium.launch(channel='msedge',headless=True)
  c=await b.new_context(viewport={'width':1440,'height':1000})
  await c.request.post(BASE+'/api/session/login',data={k:accounts[0][k] for k in ['username','password']},headers={'Origin':BASE})
  pg=await c.new_page();pg.on('pageerror',lambda e:report['errors'].append(str(e)))
  snapshots=[]
  pg.on('request',lambda r:snapshots.append(r.url) if '/api/backend/demo?messages=omit' in r.url else None)
  await pg.goto(BASE);await pg.wait_for_load_state('networkidle')
  await pg.evaluate('window.__architectureDocument=12345')
  async def click(href,selector):
   legacy='#/'+href.removeprefix('/community/') if href.startswith('/community/') else '#/' if href=='/' else href
   selector_link='a[href="'+href+'"]:visible,a[href="'+legacy+'"]:visible'
   link=pg.locator(selector_link).first
   if not await link.count():
    await pg.locator('#btn-avatar').click()
    link=pg.locator(selector_link).first
   start=time.perf_counter();await link.click(timeout=5000);await pg.wait_for_url(BASE+href)
   try: await pg.locator(selector).wait_for(state='visible',timeout=6000)
   except Exception:
    print(json.dumps({'failed':href,'url':pg.url,'main':await pg.locator('main').all_text_contents(),'errors':report['errors']},ensure_ascii=True));raise
   assert await pg.evaluate('window.__architectureDocument')==12345,'DOCUMENT_RELOADED '+href
   report['transitions'].append({'href':href,'readyMs':round((time.perf_counter()-start)*1000)})
  for href,selector in [('/community/discover','.discover-grid'),('/community/c/daily','main#main'),('/knowledge','main#main'),('/','#feed')]:
   await click(href,selector)
  report['checks'].append('community, board, Wiki and home clicks keep one document')
  await click('/community/discover','.discover-grid')
  await pg.go_back();await pg.wait_for_url(BASE+'/');await pg.locator('#feed').wait_for()
  await pg.go_forward();await pg.wait_for_url(BASE+'/community/discover');await pg.locator('.discover-grid').wait_for()
  report['checks'].append('browser back and forward restore canonical community routes')
  await click('/','#feed')
  comment=pg.locator('a[href="#/posts/'+post['id']+'#comments"]:visible').first
  await comment.click();await pg.wait_for_url(BASE+'/community/posts/'+post['id']+'#comments')
  await pg.locator('#comments').wait_for()
  assert await pg.evaluate('window.__architectureDocument')==12345
  report['checks'].append('legacy post comment anchors use client navigation')
  await click('/','#feed')
  await pg.locator('#feed-board').select_option('daily');await pg.wait_for_url(BASE+'/?board=daily')
  assert await pg.evaluate('window.__architectureDocument')==12345
  await pg.locator('#feed-board').select_option('');await pg.wait_for_url(BASE+'/')
  report['checks'].append('home filter actions use the shared client router')
  await click('/community/posts/'+post['id'],'#post-body')
  await pg.locator('#reply-input').fill('architecture-unsent-reply')
  await click('/knowledge','main#main');await click('/','#feed')
  await click('/community/posts/'+post['id'],'#post-body')
  assert await pg.locator('#reply-input').input_value()=='architecture-unsent-reply'
  await pg.locator('#reply-input').fill('')
  report['checks'].append('unsent reply survives leaving the post and returning')
  report['communitySnapshotRequests']=len(snapshots)
  assert len(snapshots)<=1, snapshots
  # Root state remains present after admin; prepared sections retain content.
  await click('/admin','main')
  await pg.get_by_role('button',name='站点设置',exact=True).click()
  field=pg.get_by_label('站点名称',exact=True);await field.wait_for()
  old=await field.input_value();await field.fill(old+' unsaved')
  await pg.wait_for_timeout(100)
  pg.once('dialog',lambda d:d.dismiss())
  await pg.locator('a[href="/"]').first.click()
  assert pg.url.split('?')[0]==BASE+'/admin',pg.url
  assert await field.input_value()==old+' unsaved'
  await field.fill(old)
  await click('/','#feed')
  assert len(snapshots)<=1,snapshots
  report['checks'].append('admin unsaved settings guard and return preserve document and community state')
  # A cold deep link and a legacy hash resolve to the same content.
  await pg.goto(BASE+'/community/search?q=architecture&type=all');await pg.wait_for_load_state('networkidle')
  assert 'architecture' in await pg.locator('main').inner_text()
  await pg.goto(BASE+'/#/discover');await pg.wait_for_url(BASE+'/community/discover');await pg.wait_for_load_state('networkidle')
  await pg.locator('.discover-grid').wait_for()
  await pg.evaluate('window.__architectureDocument=12345')
  report['checks'].append('deep links, query values and legacy bookmarks work')
  # Cached content is visible during a slow revalidation.
  await click('/knowledge','main#main');await pg.wait_for_load_state('networkidle')
  await click('/','#feed')
  async def slow(route):
   await asyncio.sleep(3)
   try: await route.continue_()
   except Exception: pass
  await pg.route('**/api/backend/knowledge/**',slow)
  await click('/knowledge','main#main')
  assert not await pg.locator('main').get_by_text('正在加载知识库…',exact=True).count()
  report['checks'].append('prepared Wiki remains visible while background API responses are delayed')
  assert not report['errors'],report['errors']
  await c.close();await b.close()
 Path('docs/evidence/performance/navigation-architecture-2026-11-15.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
 print(json.dumps(report,ensure_ascii=True))
asyncio.run(main())
