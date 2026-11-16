"""Real local API + browser journeys for shared Wiki. Start run-knowledge-preview first."""
import json
import os
import subprocess
from pathlib import Path
from uuid import uuid4
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get('KNOWLEDGE_BASE', 'http://127.0.0.1:5178')
if BASE != 'http://127.0.0.1:5178':
    raise RuntimeError('This destructive fixture runner only supports the isolated local preview')
subprocess.run(['node','--import','tsx','tests/web/knowledge-fixtures.ts'],check=True)
fixture = json.loads(Path('.runtime/knowledge-fixture.json').read_text(encoding='utf-8-sig'))
evidence = Path('docs/evidence/knowledge')
evidence.mkdir(parents=True, exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch(channel='msedge', headless=True)
    contexts = {}
    errors = []
    def context(role=None):
        c = browser.new_context(viewport={'width': 1440, 'height': 1000})
        if role:
            account = fixture['accounts'][role]
            response = c.request.post(BASE + '/api/session/login', data={'username': account['username'], 'password': account['password']}, headers={'Origin': BASE})
            assert response.ok, response.text()
        contexts[role or 'guest'] = c
        return c
    def page(c):
        tab = c.new_page()
        tab.on('pageerror', lambda e: errors.append(str(e)))
        tab.on('console', lambda message: errors.append(message.text) if message.type == 'error' and not message.text.startswith('Failed to load resource:') else None)
        tab.on('dialog', lambda d: d.accept())
        return tab
    def bound_headers(c):
        state = c.request.get(BASE + '/api/session/accounts').json()['state']
        return {'Origin': BASE, 'X-Umeet-Browser-Version': str(state['version']), **({'X-Umeet-Account': state['currentUserId']} if state['currentUserId'] else {})}
    def api(c, path, body=None, method='GET'):
        url = BASE + '/api/backend/knowledge/' + path
        return c.request.fetch(url, method=method, data=body, headers=bound_headers(c))
    def source(tab):
        tab.get_by_role('button', name='Markdown 源码', exact=True).click()
        return tab.get_by_label('Markdown 正文', exact=True)

    try:
        guest = context()
        g = page(guest)
        g.goto(BASE + '/knowledge')
        expect(g.get_by_role('heading', name='Wiki 知识库', exact=True)).to_be_visible()
        expect(g.get_by_role('heading', name='几何光学', exact=True)).to_be_visible()
        g.screenshot(path=str(evidence / 'home-desktop.png'), full_page=True)
        g.goto(BASE + '/c/physics/knowledge')
        for label in ['基础理论', '近似理论', '实际应用']:
            expect(g.locator('summary').filter(has_text=label)).to_be_visible()
        g.goto(BASE + '/knowledge/' + fixture['pages']['geometry']['id'])
        expect(g.locator('.knowledge-prose .katex').first).to_be_visible()
        expect(g.get_by_text('近似自', exact=True)).to_be_visible()
        g.screenshot(path=str(evidence / 'physics-desktop.png'), full_page=True)
        g.goto(BASE + '/knowledge/' + fixture['pages']['campus-network']['id'])
        expect(g.locator('.knowledge-prose ol li')).to_have_count(4)
        expect(g.get_by_text('最后核实时间')).to_have_count(0)
        g.screenshot(path=str(evidence / 'handbook-desktop.png'), full_page=True)
        g.goto(BASE + '/knowledge/routes/' + fixture['routeId'])
        expect(g.get_by_role('heading', name='从波到薄透镜成像', exact=True)).to_be_visible()
        g.get_by_role('button', name='下一步', exact=True).click()
        expect(g.locator('.knowledge-route-intro h2')).to_have_text('电磁波（经典理论）')
        g.set_viewport_size({'width': 390, 'height': 844})
        g.screenshot(path=str(evidence / 'route-mobile.png'), full_page=True)
        assert g.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
        g.close()
        print('PASS guest reading, physics branches, math, handbook steps and learning route', flush=True)

        member = context('member')
        m = page(member)
        marker = '校园手册纠错-' + uuid4().hex[:8]
        m.goto(BASE + '/knowledge/new?task=' + marker)
        m.get_by_label('词条标题', exact=True).fill(marker)
        m.get_by_label('内容模板', exact=True).select_option('handbook')
        source(m).fill('## 操作步骤\n\n1. 核对说明。\n2. 根据实际资料补充信息。\n\nPRIVATE-PENDING-' + marker)
        expect(m.get_by_text('已保存', exact=True)).to_be_visible(timeout=15000)
        m.reload()
        expect(m.get_by_label('词条标题', exact=True)).to_have_value(marker)
        source(m)
        expect(m.get_by_label('Markdown 正文', exact=True)).to_contain_text('PRIVATE-PENDING-' + marker)
        # A second authenticated session (device) recovers the server draft.
        device = context('member')
        d = page(device)
        d.goto(BASE + '/knowledge/new?task=' + marker)
        expect(d.get_by_label('词条标题', exact=True)).to_have_value(marker)
        device.close()
        m.get_by_role('button', name='提交审核', exact=True).click()
        expect(m.get_by_role('heading', name='修改已提交审核', exact=True)).to_be_visible(timeout=15000)
        assert not api(guest, 'pages?q=' + marker).json()['items']
        assert api(context('other'), 'proposals').json() == []
        print('PASS private draft across refresh and login, submission and pending privacy', flush=True)

        unrelated = context('unrelated')
        u = page(unrelated)
        u.goto(BASE + '/knowledge/manage')
        pending = u.locator('.knowledge-proposal').filter(has=u.locator('summary strong', has_text=marker))
        pending.locator(':scope > summary').click()
        pending.get_by_role('button', name='退回补充', exact=True).click()
        u.get_by_label('处理理由与依据', exact=True).fill('请补充可核对来源')
        u.get_by_role('button', name='退回作者', exact=True).click()
        expect(u.locator('dialog.knowledge-dialog')).not_to_be_visible()
        m.goto(BASE + '/knowledge/manage')
        mine = m.locator('.knowledge-proposal').filter(has=m.locator('summary strong', has_text=marker))
        mine.locator(':scope > summary').click()
        expect(mine).to_contain_text('请补充可核对来源')
        mine.get_by_role('link', name='补充并重新提交', exact=True).click()
        m.get_by_label('修改说明', exact=True).fill('补充来源并重提')
        m.get_by_role('button', name='提交审核', exact=True).click()
        expect(m.get_by_role('heading', name='修改已提交审核', exact=True)).to_be_visible(timeout=15000)
        u.reload()
        pending = u.locator('.knowledge-proposal').filter(has=u.locator('summary strong', has_text=marker)).filter(has_text='待审核')
        pending.locator(':scope > summary').click()
        pending.get_by_role('button', name='批准发布', exact=True).click()
        u.get_by_label('处理理由与依据', exact=True).fill('已核对修改内容与来源')
        u.get_by_role('button', name='确认批准发布', exact=True).click()
        expect(u.locator('dialog.knowledge-dialog')).not_to_be_visible()
        published = api(guest, 'pages?q=' + marker).json()['items']
        assert len(published) == 1
        article_id = published[0]['id']
        assert published[0]['authorId'] == fixture['accounts']['member']['userId']
        print('PASS unrelated community manager returns and approves a new shared article', flush=True)

        m.goto(BASE + '/knowledge/' + article_id)
        m.get_by_role('tab', name='讨论与纠错', exact=True).click()
        m.get_by_label('补充讨论或纠错', exact=True).fill('这里可以进一步补充参考资料。')
        m.get_by_role('button', name='发布讨论', exact=True).click()
        expect(m.get_by_text('这里可以进一步补充参考资料。', exact=True)).to_be_visible()
        # A stale account binding is rejected even if a different valid session cookie exists.
        changed = member.request.put(BASE + '/api/backend/knowledge/drafts', headers={**bound_headers(member), 'X-Knowledge-Account': fixture['accounts']['other']['userId']}, data={'editingTaskId':'wrong-account','pageId':None,'expectedVersion':0,'content':{'title':'x','summary':'','markdown':'secret','template':'plain','relations':[],'baseRevisionId':None,'changeNote':''}})
        assert changed.status == 403
        print('PASS correction discussion and cross-account save protection', flush=True)

        manager = context('manager')
        t = page(manager)
        t.goto(BASE + '/c/physics/knowledge')
        t.get_by_role('button',name='维护目录',exact=True).click()
        t.get_by_role('button',name='添加目录',exact=True).click()
        node = t.locator('.knowledge-directory-edit').last
        node.get_by_label('目录名称',exact=True).fill('光学入门补充')
        node.locator('select').select_option('knowledge-physics-0')
        node.get_by_label('几何光学',exact=True).check()
        t.get_by_role('button',name='保存社区目录',exact=True).click()
        expect(t.get_by_text('社区知识库已更新',exact=True)).to_be_visible()
        expect(t.locator('summary').filter(has_text='光学入门补充')).to_be_visible()
        assert api(guest,'communities/physics').json()['entries'].count({'nodeId':'impossible'}) == 0
        t.goto(BASE + '/knowledge/routes/' + fixture['routeId'])
        t.get_by_role('button',name='维护学习路线',exact=True).click()
        t.get_by_label('整体学习目标',exact=True).fill('分清理论、近似条件和薄透镜应用，并复核模型边界。')
        t.get_by_role('button',name='保存学习路线',exact=True).click()
        expect(t.get_by_text('学习路线已保存',exact=True)).to_be_visible()
        print('PASS directory nesting, multiple collection locations and route maintenance UI',flush=True)

        # Independent edit tasks isolate private autosave from published-revision concurrency.
        geo_id = fixture['pages']['geometry']['id']
        a = page(manager)
        b = page(manager)
        a.goto(BASE + '/knowledge/' + geo_id + '/edit?task=concurrent-a-' + marker)
        b.goto(BASE + '/knowledge/' + geo_id + '/edit?task=concurrent-b-' + marker)
        a_source = source(a)
        b_source = source(b)
        original = a_source.input_value()
        a_source.fill(original + '\n\n甲补充：适用条件应逐项核对。')
        b_source.fill(original + '\n\n乙补充：模型边界需要说明。')
        a.get_by_role('button',name='发布词条',exact=True).click()
        expect(a.get_by_role('heading',name='词条已发布',exact=True)).to_be_visible(timeout=15000)
        b.get_by_role('button',name='发布词条',exact=True).click()
        expect(b.get_by_role('heading',name='词条已有新版本',exact=True)).to_be_visible()
        expect(b_source).to_have_value(original + '\n\n乙补充：模型边界需要说明。')
        b_source.fill(original + '\n\n甲补充：适用条件应逐项核对。\n\n乙补充：模型边界需要说明。')
        b.get_by_role('button',name='已核对差异，以最新版本为基准继续编辑',exact=True).click()
        b.get_by_role('button',name='发布词条',exact=True).click()
        expect(b.get_by_role('heading',name='词条已发布',exact=True)).to_be_visible(timeout=15000)
        t.goto(BASE + '/knowledge/routes/' + fixture['routeId'])
        t.locator('.knowledge-route-reading aside li').nth(2).get_by_role('button').click()
        expect(t.get_by_text('词条已更新，路线导读待维护者复核。正文展示最新发布版。',exact=False)).to_be_visible()
        t.get_by_role('button',name='已核对本步导读与最新正文',exact=True).click()
        expect(t.locator('.knowledge-route-intro .knowledge-notice')).to_have_count(0)
        print('PASS two-window publication conflict, deliberate merge and route re-review',flush=True)
        a.close()
        b.close()

        t.goto(BASE + '/knowledge/manage')
        t.get_by_role('tab',name='争议与隐藏管理',exact=True).click()
        t.get_by_label('选择要处理的已发布词条',exact=True).fill('几何光学')
        t.locator('.knowledge-picker-results button').filter(has=t.locator('strong',has_text='几何光学')).click()
        t.get_by_role('button',name='提出争议',exact=True).click()
        dispute_reason = '核对几何光学适用条件-' + marker
        t.get_by_label('处理理由与依据',exact=True).fill(dispute_reason)
        t.get_by_role('button',name='登记争议',exact=True).click()
        expect(t.locator('dialog.knowledge-dialog')).not_to_be_visible()
        assert api(guest,'pages/'+geo_id).json()['paused'] is False
        admin = context('admin')
        ad = page(admin)
        ad.goto(BASE + '/knowledge/manage')
        ad.get_by_role('tab',name='争议与隐藏管理',exact=True).click()
        dispute = ad.locator('.knowledge-governance-target').filter(has_text=dispute_reason)
        dispute.get_by_role('button',name='暂停直接发布',exact=True).click()
        ad.get_by_label('处理理由与依据',exact=True).fill('组织复核期间保留当前公开版')
        ad.get_by_role('button',name='暂停发布',exact=True).click()
        expect(ad.locator('dialog.knowledge-dialog')).not_to_be_visible()
        old_revision = api(guest,'pages/'+geo_id).json()['revisionId']
        t.goto(BASE + '/knowledge/' + geo_id + '/edit?task=frozen-' + marker)
        source(t).fill(api(guest,'pages/'+geo_id).json()['markdown']+'\n\n复核补充：模型条件应随应用逐项检查。')
        t.get_by_role('button',name='提交审核',exact=True).click()
        expect(t.get_by_role('heading',name='修改已提交审核',exact=True)).to_be_visible(timeout=15000)
        assert api(guest,'pages/'+geo_id).json()['revisionId'] == old_revision
        ad.goto(BASE + '/knowledge/manage')
        frozen = ad.locator('.knowledge-proposal').filter(has=ad.locator('summary strong',has_text='几何光学')).filter(has_text='待审核')
        frozen.locator(':scope > summary').click()
        frozen.get_by_role('button',name='复核并发布',exact=True).click()
        ad.get_by_label('处理理由与依据',exact=True).fill('根据来源核对适用条件，并记录复核结论')
        ad.get_by_role('button',name='确认批准发布',exact=True).click()
        expect(ad.locator('dialog.knowledge-dialog')).not_to_be_visible()
        assert api(guest,'pages/'+geo_id).json()['revisionId'] != old_revision
        t.goto(BASE + '/knowledge/manage')
        t.get_by_role('tab',name='争议与隐藏管理',exact=True).click()
        t.get_by_label('选择要处理的已发布词条',exact=True).fill('几何光学')
        t.locator('.knowledge-picker-results button').filter(has=t.locator('strong',has_text='几何光学')).click()
        t.get_by_role('button',name='隐藏词条',exact=True).click()
        t.get_by_label('处理理由与依据',exact=True).fill('验证共享引用的隐藏状态')
        t.locator('dialog.knowledge-dialog').get_by_role('button',name='隐藏词条',exact=True).click()
        expect(t.locator('dialog.knowledge-dialog')).not_to_be_visible()
        assert api(guest,'pages/'+geo_id).status == 404
        assert api(guest,'pages/'+geo_id+'/history').json() == []
        assert api(guest,'pages/'+geo_id+'/backlinks').json() == []
        hidden = t.locator('.knowledge-governance-target').filter(has=t.locator('strong',has_text='几何光学'))
        hidden.get_by_role('button',name='恢复阅读',exact=True).click()
        t.get_by_label('处理理由与依据',exact=True).fill('验证结束，恢复阅读')
        t.locator('dialog.knowledge-dialog').get_by_role('button',name='恢复阅读',exact=True).click()
        expect(t.locator('dialog.knowledge-dialog')).not_to_be_visible()
        assert api(guest,'pages/'+geo_id).ok
        ad.goto(BASE + '/knowledge/manage')
        ad.get_by_role('tab',name='争议与隐藏管理',exact=True).click()
        dispute = ad.locator('.knowledge-governance-target').filter(has_text=dispute_reason)
        dispute.get_by_role('button',name='结束复核',exact=True).click()
        ad.get_by_label('处理理由与依据',exact=True).fill('已完成来源和适用条件核验，恢复直接发布')
        ad.get_by_role('button',name='记录结论并恢复发布',exact=True).click()
        expect(ad.locator('dialog.knowledge-dialog')).not_to_be_visible()
        ad.screenshot(path=str(evidence/'governance-desktop.png'),full_page=True)
        print('PASS dispute flag, administrator freeze, reviewed publication and hide/restore UI',flush=True)

        m.goto(BASE+'/c/campus/knowledge')
        m.get_by_role('button',name='建议调整目录',exact=True).click()
        m.get_by_label('目录名称',exact=True).fill('校园学习与网络指南')
        m.get_by_role('button',name='提交目录建议',exact=True).click()
        expect(m.get_by_text('建议已提交，等待本社区 Wiki 管理人员审核。',exact=True)).to_be_visible()
        assert api(guest,'communities/campus').json()['nodes'][0]['title']=='学习与生活指南'
        campus=context('campus')
        cp=page(campus)
        cp.goto(BASE+'/knowledge/manage')
        cp.get_by_role('tab',name='社区目录与路线建议',exact=True).click()
        cp.get_by_label('选择社区',exact=True).select_option('default-campus')
        suggestion=cp.locator('.knowledge-proposal').filter(has_text='目录调整建议')
        suggestion.locator(':scope > summary').click()
        suggestion.get_by_role('button',name='批准调整',exact=True).click()
        cp.get_by_label('处理理由与依据',exact=True).fill('核对指南分类与引用后批准')
        cp.locator('dialog.knowledge-dialog').get_by_role('button',name='批准调整',exact=True).click()
        expect(cp.locator('dialog.knowledge-dialog')).not_to_be_visible()
        assert api(guest,'communities/campus').json()['nodes'][0]['title']=='校园学习与网络指南'
        cp.close()
        print('PASS ordinary directory suggestion waits for the correct community reviewer',flush=True)

        # Check editors and management at phone width, including semantic controls.
        m.goto(BASE + '/knowledge/' + article_id + '/edit')
        expect(m.get_by_label('词条标题', exact=True)).to_have_value(marker)
        m.set_viewport_size({'width':390,'height':844})
        m.screenshot(path=str(evidence / 'editor-mobile.png'), full_page=True)
        assert m.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
        u.screenshot(path=str(evidence / 'review-desktop.png'), full_page=True)

        ad.goto(BASE+'/knowledge/manage')
        ad.get_by_role('tab',name='争议与隐藏管理',exact=True).click()
        ad.get_by_label('选择要处理的已发布词条',exact=True).fill(marker)
        ad.locator('.knowledge-picker-results button').filter(has=ad.locator('strong',has_text=marker)).click()
        ad.get_by_role('button',name='永久清除',exact=True).click()
        destructive=ad.locator('dialog.knowledge-dialog')
        expect(destructive.get_by_role('button',name='永久清除',exact=True)).to_be_disabled()
        destructive.get_by_label('处理理由与依据',exact=True).fill('仅清除本轮自动化创建的临时词条')
        destructive.get_by_role('checkbox').check()
        destructive.get_by_role('button',name='永久清除',exact=True).click()
        expect(destructive).not_to_be_visible()
        assert api(guest,'pages/'+article_id).status==404
        legacy=page(guest)
        legacy.goto(BASE+'/#/wiki')
        expect(legacy.get_by_role('heading',name='Wiki',exact=True)).to_be_visible()
        expect(legacy.locator('aside.sidebar').get_by_role('link',name='Wiki',exact=True)).to_have_attribute('href','/knowledge')
        print('PASS guarded permanent purge, legacy reading entry and new primary Wiki navigation',flush=True)
        assert not errors, errors
        print('PASS phone layout and no uncaught browser errors', flush=True)
    except Exception:
        for key,c in contexts.items():
            for i,t in enumerate(c.pages):
                try: t.screenshot(path=str(evidence / ('failure-' + key + '-' + str(i) + '.png')), full_page=True)
                except Exception: pass
        raise
    finally:
        browser.close()
