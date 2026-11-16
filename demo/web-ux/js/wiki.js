/* Wiki：阅读、贡献与本地修订记录。 */
'use strict';
const wikiGuides = {
  w1:{kind:'地点指南',aliases:['自习','自习室','插座','座位','借书'],scope:'主校区 · 图书馆',quick:[['带电脑自习','先看三楼西南角，再比较四楼北侧'],['想安静一些','四楼；研讨间需要另行预约'],['出发前确认','开放时间与预约规则以图书馆公告为准']],table:{section:2,heads:['楼层 / 区域','适合什么','插座与预约'],rows:[['二楼靠窗','白天阅读、短时自习','插座较少，东侧有插座位'],['三楼西南角','带电脑、赶作业','插座位较集中'],['四楼北侧','安静自习','有插座，注意保持安静'],['五楼研讨间','小组讨论','需提前预约']]},related:['w2'],sourceNote:'开放时间、借阅上限与费用尚未核实。以下为演示内容，请以所在学校图书馆的现行公告为准。'},
  w2:{kind:'办事指南',aliases:['选课','退课','课表','课程'],scope:'本科生 · 每学期需复核',quick:[['选课前','查看培养方案，准备主选与备选课表'],['选课时','先确认本轮规则，再检查时间冲突'],['选课后','核对结果与学分，留意退改截止日期']],related:['w1'],sourceNote:'选课时间、退改期限和学分规则尚未核实，请查阅所在学校本学期教务通知。'},
  w3:{kind:'办事指南',aliases:['饭卡','一卡通','丢卡','补卡','充值','挂失'],scope:'校园一卡通用户',quick:[['卡找不到了','先通过学校官方渠道挂失，再办理补卡'],['准备材料','学生证或身份证；具体要求向卡务中心确认'],['充值未到账','保留交易记录，避免连续重复支付']],sourceNote:'小程序名称、办理地点与补卡费用需由学校卡务中心确认，本文不提供未经核实的支付入口。'},
  w4:{kind:'同学经验',aliases:['吃饭','饭堂','食堂','夜宵','美食'],scope:'个人体验 · 口味仅供参考',quick:[['不知道吃什么','先比较窗口、口味与排队情况'],['想吃夜宵','先确认当天开放的窗口'],['分享新发现','补充体验日期、价格与具体窗口']],sourceNote:'以下为同学体验示例，不代表统一评价。窗口、菜品与价格可能变化，欢迎补充近期体验。'}
};
function initializeWiki(){
  const summaries={w1:'查开放时间、比较自习楼层，找到适合带电脑学习的位置。',w2:'从准备课表到核对结果，按顺序完成选课与退改。',w3:'充值、挂失和补办，按当前情况找到下一步。',w4:'按窗口查口味与排队体验，也欢迎补充你的发现。'};
  wiki.forEach((w,i)=>{
    if(w.wikiFormat===1)return;
    Object.assign(w,{wikiFormat:1,summary:summaries[w.id]||w.summary,kind:wikiGuides[w.id]?.kind||'校园指南',scope:wikiGuides[w.id]?.scope||'校园社区',example:true,updatedAt:new Date(2026,10,8-i,10,0).toISOString(),suggestions:[],history:[],notes:[]});
    if(w.id==='w1')w.sections[3].h='插座位置';
    if(w.id==='w2')w.sections=[
      {h:'选课前准备',p:'查看本专业培养方案，列出必修课与学分要求。准备主选与备选课表，检查上课时间是否冲突。'},
      {h:'选课与核对',p:'1. 从学校官网进入教务系统，阅读本轮选课说明。\n2. 按本轮规则提交选课，不把提交成功当成最终入选。\n3. 在结果公布后核对课表、学分和上课地点。'},
      {h:'退改与课程经验',p:'退课期限、成绩记载和名额调整以本学期通知为准。想了解课程体验，可以到问答求助板块提问，并说明课程名称和开课学期。'}];
    if(w.id==='w3')w.sections=[
      {h:'线上充值',p:'从学校官方网站或已认证的校园服务应用进入一卡通充值。支付前核对学号与金额；未到账时先查交易记录，再联系卡务中心。'},
      {h:'挂失与补办',p:'1. 尽快通过学校官方一卡通渠道挂失，避免卡片继续被使用。\n2. 联系卡务中心，确认办理地点、时间、证件与费用。\n3. 按要求补办后，核对余额转移和门禁权限。'},
      {h:'找回旧卡与异常处理',p:'补办前找回旧卡，先确认能否解除挂失；补办后不要继续使用旧卡。充值扣款未到账时，保留订单号与时间，向官方服务窗口查询。'}];
    if(w.id==='w4')w.sections[2].p='夜宵窗口与开放时间会调整。前往之前先确认当天营业情况；分享体验时，写清窗口名称、消费时间和口味偏好。';
  });
}
function wikiDate(w){return w.updatedAt?new Date(w.updatedAt).toLocaleDateString('zh-CN',{month:'long',day:'numeric'}):w.updated;}
function wikiNewest(entries){return [...entries].sort((a,b)=>new Date(b.updatedAt||0)-new Date(a.updatedAt||0));}
function wikiResults(entries,query){
  const key=query.trim().toLowerCase();
  const matches=wikiNewest(entries).filter(w=>[w.title,w.summary,w.kind,w.scope,...(wikiGuides[w.id]?.aliases||[]),...w.sections.map(s=>s.h+' '+s.p)].join(' ').toLowerCase().includes(key));
  const html=matches.map(w=>'<a class="wiki-entry" href="#/wiki/'+esc(w.id)+'"><div class="wiki-entry-main"><h3>'+esc(w.title)+'</h3><p>'+esc(w.summary)+'</p><span class="wiki-entry-kind">'+esc(w.kind||'校园指南')+'</span></div><time datetime="'+esc(w.updatedAt||'')+'">'+esc(wikiDate(w))+'更新</time></a>').join('');
  return {count:matches.length,html:html||'<div class="wiki-no-results"><p>没有找到相关词条</p><span>试试“校园卡”“自习”或“选课”，也可以新建一篇。</span></div>'};
}
function wikiIndexHtml(entries,slug=''){
  initializeWiki();
  const q=S.wikiQueries.get(slug)||'',results=wikiResults(entries,q);
  const tasks=[['w3','校园卡丢了怎么办','挂失与补办','inbox'],['w2','准备选课','选课与退改','list'],['w1','找个地方自习','楼层与插座','book-open']].filter(t=>entries.some(w=>w.id===t[0]));
  return '<div class="wiki-directory '+(slug?'wiki-board-directory':'')+'"><div class="page-head wiki-head"><div>'+(slug?'<h2>板块 Wiki</h2>':'<h1>Wiki</h1>')+'<p>把同学们的经验，整理成随时可查的指南。</p></div><button class="wiki-soft-button" data-wiki-create="'+esc(slug)+'">'+uiIcon('plus')+' 新建词条</button></div>'+
    '<div class="search wiki-search">'+uiIcon('search')+'<input id="wiki-q" type="search" aria-label="搜索'+(slug?'板块 Wiki':'词条')+'" placeholder="搜校园卡、选课、图书馆…" value="'+esc(q)+'"></div>'+
    '<div class="wiki-start" id="wiki-start" '+(q.trim()?'hidden':'')+'>'+(tasks.length?'<h3>你想了解什么？</h3><div class="wiki-task-list">'+tasks.map(t=>'<a href="#/wiki/'+t[0]+'">'+uiIcon(t[3])+'<span><b>'+t[1]+'</b><small>'+t[2]+'</small></span></a>').join('')+'</div>':'')+'</div>'+
    '<div class="wiki-list-heading"><h2>'+(slug?'本板块词条':'全部词条')+'</h2><span id="wiki-result-count" role="status">'+results.count+' 篇</span></div><div id="wiki-results">'+results.html+'</div>'+
    '<div class="wiki-directory-foot"><span>发现内容过时？打开词条即可补充或纠错。</span>'+(slug?'<a href="#/wiki">查看全部词条</a>':'<span>由社区共同维护</span>')+'</div></div>';
}
function bindWikiSearch(entries,slug=''){
  const input=$('#wiki-q');input.oninput=()=>{S.wikiQueries.set(slug,input.value);const r=wikiResults(entries,input.value);$('#wiki-results').innerHTML=r.html;$('#wiki-result-count').textContent=r.count+' 篇';$('#wiki-start').hidden=Boolean(input.value.trim());};
  $('[data-wiki-create]').onclick=()=>openWikiEditor(null,slug);
}
function renderWiki(){$('#main').innerHTML=wikiIndexHtml(wiki);bindWikiSearch(wiki);}
function wikify(text){return esc(text).replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g,(m,slug,label)=>{const w=wiki.find(x=>x.slug===slug);return w?'<a class="wikilink" href="#/wiki/'+esc(w.id)+'">'+label+'</a>':label;});}
function wikiParagraphs(text){
  const lines=text.split(/\r?\n/).filter(x=>x.trim());
  if(lines.length&&lines.every(l=>/^\d+\.\s/.test(l)))return '<ol class="wiki-steps">'+lines.map(l=>'<li>'+wikify(l.replace(/^\d+\.\s/,''))+'</li>').join('')+'</ol>';
  return lines.map(l=>'<p>'+wikify(l)+'</p>').join('');
}
function wikiTocLinks(w){return [...w.sections.map((s,i)=>[wikiSectionId(s,i),s.h]),['ws-sources','资料与来源'],['ws-contribute','补充与讨论']].map(([id,h])=>'<a href="#/wiki/'+esc(w.id)+'#'+id+'">'+esc(h)+'</a>').join('');}
function wikiTable(table){return '<div class="wiki-table-wrap" role="region" aria-label="楼层对照表" tabindex="0"><table><caption>楼层对照 · 示例信息</caption><thead><tr>'+table.heads.map(h=>'<th scope="col">'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+table.rows.map(row=>'<tr>'+row.map(c=>'<td>'+esc(c)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';}
function wikiReference(value){return /^https?:\/\/[^\s]+$/i.test(value)?'<a href="'+esc(value)+'" target="_blank" rel="noopener noreferrer">'+esc(value)+'</a>':esc(value);}
function renderWikiArticle(id,anchor){
  wikiTocObserver?.disconnect();
  initializeWiki();const w=wiki.find(x=>x.id===id);if(!w)return renderWiki();
  const guide=wikiGuides[id]||{},sources=posts.filter(p=>p.wikiRef?.id===id),quick=w.quick||guide.quick||[];
  $('#main').innerHTML='<div class="wiki-article-wrap"><div class="crumb"><a href="#/wiki">Wiki</a><span>/</span><span>'+esc(w.kind||'校园指南')+'</span></div>'+
    '<header class="wiki-article-head"><h1>'+esc(w.title)+'</h1><p>'+esc(w.summary)+'</p><div class="wiki-article-meta"><span>'+esc(w.scope||'校园社区')+'</span><span>'+esc(wikiDate(w))+'更新</span><span>'+authorLink(w.editor)+'维护</span></div><div class="wiki-article-tools"><button class="wiki-soft-button" data-wiki-action="suggest">'+uiIcon('pencil')+' 补充 / 纠错</button><button class="wiki-text-button" data-wiki-action="edit">编辑词条</button><button class="wiki-text-button" data-wiki-action="history">修订记录</button></div></header>'+
    '<div class="wiki-reading-layout"><aside class="wiki-reading-side"><details class="wiki-reading-toc" open><summary>本文目录 '+uiIcon('list')+'</summary><nav class="toc" aria-label="词条目录">'+wikiTocLinks(w)+'</nav></details><p class="wiki-side-note">'+uiIcon('users')+' 每一份补充，都会让下一位同学少走弯路。</p></aside><article class="wiki-reading-body">'+
    (w.example?'<div class="wiki-example-note">示例内容 · 校园规则与地点尚未核实，请以学校现行公告为准。</div>':'')+
    (quick.length?'<section class="wiki-quick"><h2>快速查阅</h2><dl>'+quick.map(([k,v])=>'<div><dt>'+esc(k)+'</dt><dd>'+esc(v)+'</dd></div>').join('')+'</dl></section>':'')+
    w.sections.map((s,i)=>'<section class="wiki-content-section"><h2 id="'+wikiSectionId(s,i)+'" tabindex="-1">'+esc(s.h)+'</h2>'+wikiParagraphs(s.p)+((w.table||guide.table)?.section===i?wikiTable(w.table||guide.table):'')+'</section>').join('')+
    '<section class="wiki-content-section"><h2 id="ws-sources" tabindex="-1">资料与来源</h2><p class="wiki-source-note">'+esc(guide.sourceNote||'社区共同整理；办事规则请对照学校当前公告。')+'</p>'+(w.reference?'<p>补充来源：'+wikiReference(w.reference)+'</p>':'')+
    (sources.length?'<h3>相关讨论</h3><ul class="wiki-source-list">'+sources.map(p=>'<li><a href="#/posts/'+esc(p.id)+(p.wikiRef.answerId?'#cm-'+esc(p.wikiRef.answerId):'')+'">'+esc(p.title)+'</a></li>').join('')+'</ul>':'')+
    ((guide.related||[]).length?'<h3>接着了解</h3><div class="wiki-related">'+guide.related.map(r=>wiki.find(x=>x.id===r)).filter(Boolean).map(r=>'<a href="#/wiki/'+r.id+'">'+uiIcon('book-open')+esc(r.title)+'</a>').join('')+'</div>':'')+'</section>'+
    '<section class="wiki-contribute"><h2 id="ws-contribute" tabindex="-1">一起完善这篇指南</h2><p>信息变了，或有更好的办法？补充你知道的内容。</p><button class="wiki-soft-button" data-wiki-action="suggest">'+uiIcon('plus')+' 补充 / 纠错</button>'+wikiSuggestions(w)+
    '<details class="wiki-discussion"><summary>词条讨论（'+(w.notes||[]).length+'）</summary><div>'+(w.notes||[]).map(n=>'<div class="wiki-note"><b>'+authorLink(n.author)+'</b><p>'+esc(n.text)+'</p></div>').join('')+((w.notes||[]).length?'':'<p class="muted">还没有讨论，可以先提出一个问题。</p>')+'</div><form id="wiki-note-form"><label class="sr-only" for="wiki-note">讨论内容</label><textarea id="wiki-note" required maxlength="2000" placeholder="针对这篇指南提问或分享经验…"></textarea><button class="wiki-soft-button" type="submit">发表讨论</button></form></details></section></article></div></div>';
  document.querySelectorAll('[data-wiki-action]').forEach(b=>b.onclick=()=>({suggest:()=>openWikiSuggestion(w),edit:()=>openWikiEditor(w),history:()=>openWikiHistory(w)})[b.dataset.wikiAction]());
  $('#wiki-note-form').onsubmit=e=>{e.preventDefault();const text=$('#wiki-note').value.trim();if(!text)return;(w.notes||=[]).push({author:CURRENT_USER,text,at:new Date().toISOString()});saveDemo();renderWikiArticle(id);document.querySelector('.wiki-discussion').open=true;toast('讨论已保存');};
  const toc=$('.wiki-reading-toc');if(matchMedia('(max-width:1000px)').matches)toc.open=false;
  const links=[...document.querySelectorAll('.wiki-reading-toc a')],sections=[...document.querySelectorAll('.wiki-reading-body h2[id]')];
  const mark=id=>links.forEach(a=>{const current=a.hash.endsWith('#'+id);a.classList.toggle('cur',current);if(current)a.setAttribute('aria-current','location');else a.removeAttribute('aria-current');});
  wikiTocObserver=new IntersectionObserver(es=>es.forEach(en=>{if(en.isIntersecting)mark(en.target.id);}),{rootMargin:'-15% 0px -65% 0px'});sections.forEach(s=>wikiTocObserver.observe(s));
  links.forEach(a=>a.onclick=e=>{if(a.hash===location.hash){e.preventDefault();focusContent(document.getElementById(a.hash.split('#').pop()));}if(matchMedia('(max-width:1000px)').matches)toc.open=false;});mark(anchor||sections[0]?.id);
}
function wikiSuggestions(w){return (w.suggestions||[]).length?'<div class="wiki-suggestions"><h3>我的补充</h3>'+w.suggestions.map(s=>'<div class="wiki-suggestion"><div><b>'+esc(s.section)+'</b><span>'+(s.applied?'已整理入正文':'已记录，待整理')+'</span></div><p>'+esc(s.text)+'</p><small>'+esc(s.author)+' · '+esc(new Date(s.at).toLocaleDateString('zh-CN'))+(s.reference?' · 来源：'+wikiReference(s.reference):'')+'</small></div>').join('')+'</div>':'';}
let wikiDialogReturn;
function wikiDialog(title,body){
  let d=$('#wiki-dialog');if(!d){d=document.createElement('dialog');d.id='wiki-dialog';d.className='wiki-dialog';d.setAttribute('aria-labelledby','wiki-dialog-title');document.body.append(d);d.addEventListener('close',()=>{if(wikiDialogReturn?.isConnected)wikiDialogReturn.focus();});}
  wikiDialogReturn=document.activeElement;d.innerHTML='<header><h2 id="wiki-dialog-title">'+esc(title)+'</h2><button type="button" class="icon-btn" aria-label="关闭窗口">'+uiIcon('x')+'</button></header><div class="wiki-dialog-content">'+body+'</div>';d.querySelector('header button').onclick=()=>d.close();d.showModal();return d;
}
function wikiSnapshot(w){return {title:w.title||'',summary:w.summary||'',sections:structuredClone(w.sections||[]),quick:structuredClone(w.quick||wikiGuides[w.id]?.quick||[]),table:structuredClone(w.table||wikiGuides[w.id]?.table||null),reference:w.reference||''};}
function wikiRecord(w,before,reason){(w.history||=[]).unshift({at:new Date().toISOString(),author:CURRENT_USER,reason,before,after:wikiSnapshot(w)});w.revisions=(w.revisions||0)+1;w.editor=CURRENT_USER;w.updatedAt=new Date().toISOString();}
function openWikiSuggestion(w){
  const d=wikiDialog('补充 / 纠错','<p class="muted">'+esc(w.title)+'</p><form id="wiki-suggest-form" class="wiki-form"><label>对应章节<select id="wiki-suggest-section">'+w.sections.map((s,i)=>'<option value="'+i+'">'+esc(s.h)+'</option>').join('')+'</select></label><label>你想补充或修正什么？<textarea id="wiki-suggest-text" required maxlength="4000" rows="5" placeholder="写清楚变更内容，方便其他同学核对。"></textarea></label><label>资料来源（选填）<input id="wiki-suggest-reference" maxlength="1000" placeholder="公告链接、实地体验日期等"></label><p class="wiki-form-hint">提交后保存在本浏览器。你可以继续编辑正文，将补充整理进指南。</p><button class="wiki-soft-button" type="submit">提交补充</button></form>');
  $('#wiki-suggest-form').onsubmit=e=>{e.preventDefault();const text=$('#wiki-suggest-text').value.trim();if(!text)return $('#wiki-suggest-text').setCustomValidity('请填写补充内容');const i=Number($('#wiki-suggest-section').value);(w.suggestions||=[]).push({id:'s'+Date.now(),section:w.sections[i].h,index:i,text,reference:$('#wiki-suggest-reference').value.trim(),at:new Date().toISOString(),author:CURRENT_USER,applied:false});saveDemo();d.close();renderWikiArticle(w.id);toast('补充已记录，可在词条底部查看');};$('#wiki-suggest-text').oninput=e=>e.target.setCustomValidity('');
}
function wikiSectionFields(s,index){return '<fieldset data-we-section="'+index+'"><legend>章节 '+(index+1)+'</legend><label>章节标题<input class="we-heading" required maxlength="80" value="'+esc(s.h)+'"></label><label>内容<textarea class="we-body" required rows="4" maxlength="10000">'+esc(s.p)+'</textarea></label></fieldset>';}
function openWikiEditor(w,board=''){
  const sections=w?.sections||[{h:'开始之前',p:''}];
  const pending=(w?.suggestions||[]).filter(s=>!s.applied);
  const d=wikiDialog(w?'编辑词条':'新建词条','<form id="wiki-editor" class="wiki-form"><label>词条标题<input id="we-title" required maxlength="80" value="'+esc(w?.title||'')+'" placeholder="用具体问题或事项命名"></label><label>一句话简介<input id="we-summary" required maxlength="180" value="'+esc(w?.summary||'')+'" placeholder="这篇指南能帮同学解决什么问题？"></label>'+
    (!w?'<label>关联板块<select id="we-board"><option value="">Wiki</option>'+communities.map(c=>'<option value="'+c.slug+'" '+(c.slug===board?'selected':'')+'>'+esc(c.name)+'</option>').join('')+'</select></label>':'')+
    '<div id="we-sections">'+sections.map(wikiSectionFields).join('')+'</div><button type="button" class="wiki-text-button" id="we-add">'+uiIcon('plus')+' 添加章节</button>'+
    (pending.length?'<details class="wiki-editor-suggestions"><summary>待整理的补充（'+pending.length+'）</summary>'+pending.map(s=>'<div><p><b>'+esc(s.section)+'</b>：'+esc(s.text)+'</p><label class="wiki-checkbox"><input type="checkbox" name="wiki-apply" value="'+esc(s.id)+'">本次已整理入正文</label></div>').join('')+'</details>':'')+
    '<label>资料来源（选填）<input id="we-reference" maxlength="1000" value="'+esc(w?.reference||'')+'" placeholder="公告链接或核实依据"></label><label>修改说明<input id="we-reason" required maxlength="160" placeholder="例如：补充四楼插座位置" value="'+(w?'':'创建词条')+'"></label><p class="wiki-form-hint">内容与修订记录保存在本浏览器。</p><p id="we-error" role="alert" hidden></p><button class="wiki-soft-button" type="submit">'+(w?'保存修改':'创建词条')+'</button></form>');
  const guide=wikiGuides[w?.id]||{},table=w?.table||guide.table;
  const structured=document.createElement('details');structured.className='wiki-structured-editor';
  structured.innerHTML='<summary>快速查阅'+(table?'与楼层对照':'')+'</summary><label>快速查阅（每行：事项 | 说明）<textarea id="we-quick" rows="4">'+esc((w?.quick||guide.quick||[]).map(row=>row.join(' | ')).join(String.fromCharCode(10)))+'</textarea></label>'+(table?'<label>楼层对照（每行：区域 | 适合什么 | 插座与预约）<textarea id="we-table" rows="5">'+esc(table.rows.map(row=>row.join(' | ')).join(String.fromCharCode(10)))+'</textarea></label>':'');
  $('#we-sections').before(structured);
  $('#we-add').onclick=()=>{const el=document.createElement('div');el.innerHTML=wikiSectionFields({h:'',p:''},d.querySelectorAll('[data-we-section]').length);const f=el.firstChild;$('#we-sections').append(f);f.querySelector('input').focus();};
  $('#wiki-editor').onsubmit=e=>{e.preventDefault();const title=$('#we-title').value.trim(),summary=$('#we-summary').value.trim(),reason=$('#we-reason').value.trim();const next=[...d.querySelectorAll('[data-we-section]')].map((f,i)=>({...sections[i],h:f.querySelector('input').value.trim(),p:f.querySelector('textarea').value.trim()}));if(!title||!summary||!reason||next.some(s=>!s.h||!s.p)){$('#we-error').hidden=false;$('#we-error').textContent='请填写标题、简介、章节内容和修改说明。';return;}
    const parseRows=value=>value.split(String.fromCharCode(10)).filter(l=>l.trim()).map(l=>l.split('|').map(c=>c.trim()));
    const quick=parseRows($('#we-quick').value),tableRows=$('#we-table')?parseRows($('#we-table').value):null;
    if(quick.some(row=>row.length!==2||row.some(c=>!c))||tableRows?.some(row=>row.length!==3||row.some(c=>!c))){$('#we-error').hidden=false;$('#we-error').textContent='速查每行填写两栏，楼层对照每行填写三栏，用 | 分隔。';return;}
    if(!w){const b=$('#we-board').value;w={id:'w'+Date.now(),slug:'community-'+Date.now(),communities:b?[b]:[],kind:'校园指南',scope:'社区共建',example:false,wikiFormat:1,history:[],notes:[],suggestions:[],revisions:0};wiki.push(w);}
    const before=wikiSnapshot(w);Object.assign(w,{title,summary,sections:next,quick,reference:$('#we-reference').value.trim()});if(tableRows)w.table={...table,rows:tableRows};d.querySelectorAll('[name="wiki-apply"]:checked').forEach(c=>{const s=w.suggestions.find(s=>s.id===c.value);if(s)s.applied=true;});wikiRecord(w,before,reason);saveDemo();d.close();if(location.hash==='#/wiki/'+w.id){renderWikiArticle(w.id);toast('修改已保存');}else location.hash='#/wiki/'+w.id;};
}
function openWikiHistory(w){const history=w.history||[];wikiDialog('修订记录','<p class="muted">'+esc(w.title)+'</p>'+(history.length?history.map(h=>'<details class="wiki-revision"><summary><b>'+esc(h.reason)+'</b><span>'+esc(h.author)+' · '+esc(new Date(h.at).toLocaleString('zh-CN'))+'</span></summary><div class="wiki-diff"><div><h3>修改前</h3>'+wikiRevisionContent(h.before)+'</div><div><h3>修改后</h3>'+wikiRevisionContent(h.after)+'</div></div></details>').join(''):'<p>暂时没有本地修订记录。保存一次修改后，可以在这里比较前后内容。</p>')+'<p class="wiki-form-hint">这里显示当前浏览器保存的修订；示例中原有的修订次数不代表可查看的历史版本。</p>');}
function wikiRevisionContent(v){return '<b>'+esc(v.title)+'</b><p>'+esc(v.summary)+'</p>'+(v.quick||[]).map(row=>'<p>'+row.map(esc).join('：')+'</p>').join('')+v.sections.map(s=>'<h4>'+esc(s.h)+'</h4><p>'+esc(s.p)+'</p>').join('')+(v.table?.rows||[]).map(row=>'<p>'+row.map(esc).join(' / ')+'</p>').join('')+(v.reference?'<p>来源：'+esc(v.reference)+'</p>':'');}
