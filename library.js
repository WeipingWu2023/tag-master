import { cleanEntry, cleanTopic, groupEntries, parseBackup } from './core.js';

const $ = selector => document.querySelector(selector);
const extension = !!globalThis.chrome?.runtime?.id;
const demo = new URLSearchParams(location.search).has('demo');
let entries = [], topics = [], view = 'all', deleted, statusTimer, previewTimer;
const demoEntries = [
  ['Obsidian for medical school: a practical workflow','https://www.youtube.com/watch?v=example1','Connect lecture notes, clinical cases, and spaced repetition in Obsidian.'],
  ['Building an Obsidian study dashboard','https://www.youtube.com/watch?v=example2','A dashboard that brings together your study notes and review sessions.'],
  ['Obsidian: connecting clinical concepts','https://obsidian.md/','Link concepts together and see how your knowledge develops.'],
  ['How I organize anatomy notes in Obsidian','https://www.youtube.com/watch?v=example3','An example workflow for anatomy notes, diagrams, and revision.'],
  ['Codex: getting started with your first project','https://developers.openai.com/codex/','Explore coding workflows and build your first project.'],
  ['A practical Codex code review workflow','https://www.youtube.com/watch?v=example4','An example walkthrough of reviewing changes and validating fixes.'],
  ['Guitar practice: a daily routine','https://www.youtube.com/watch?v=example5','Build a repeatable practice routine with chords and timing exercises.'],
  ['Guitar fingerstyle fundamentals','https://www.youtube.com/watch?v=example6','A sample lesson covering right-hand patterns and technique.'],
  ['Machine learning foundations','https://www.youtube.com/watch?v=example7','Understand the building blocks of machine learning.'],
  ['Machine learning: from theory to practice','https://www.youtube.com/watch?v=example8','Connect core ideas to practical experiments.'],
  ['ChatGPT','https://chatgpt.com/','Your go-to place to think through ideas.'],
  ['Notion','https://www.notion.so/','Notes, plans, and projects in one place.']
].map(([title,url,description],index)=>cleanEntry({title,url,description,savedAt:Date.now()-index*3600000,pinned:index>9}));

function element(tag, className, text) { const node=document.createElement(tag); if(className)node.className=className; if(text!==undefined)node.textContent=text; return node; }
function notify(message, undo=false) { clearTimeout(statusTimer); $('#status span').textContent=message; $('#undo').hidden=!undo; $('#status').hidden=false; statusTimer=setTimeout(()=>$('#status').hidden=true,undo?10000:5000); }
function domain(entry) { return new URL(entry.url).hostname.replace(/^www\./,''); }
async function load() {
  if(demo) { entries=demoEntries; topics=[]; }
  else if(extension) { const stored=await chrome.storage.local.get(null);entries=Object.entries(stored).filter(([key])=>key.startsWith('page:')).map(([,value])=>cleanEntry(value));topics=stored.topics||[]; }
  else { entries=JSON.parse(localStorage.getItem('tag-master-preview')||'[]').map(cleanEntry);topics=JSON.parse(localStorage.getItem('tag-master-topics')||'[]'); }
  render();
}
async function mutate(message) {
  if(demo) { notify('Example only. Exit the example to save your own pages.'); return false; }
  if(extension) { const result=await chrome.runtime.sendMessage(message); if(!result?.ok) throw new Error(result?.error||'Could not save changes.'); }
  else {
    let updated=[...entries];
    if(message.type==='save') { const entry=cleanEntry(message.page); const old=updated.find(e=>e.id===entry.id); updated=updated.filter(e=>e.id!==entry.id); updated.push(old?{...entry,savedAt:old.savedAt,pinned:old.pinned,topic:old.topic}:entry); }
    if(message.type==='delete')updated=updated.filter(e=>e.id!==message.id);
    if(message.type==='pin')updated=updated.map(e=>e.id===message.id?{...e,pinned:!e.pinned}:e);
    if(message.type==='create-topic') { const label=cleanTopic(message.topic);if(topics.some(topic=>topic.toLowerCase()===label.toLowerCase()))throw new Error('That topic already exists.');topics.push(label); }
    if(message.type==='set-topic') { const label=cleanTopic(message.topic);updated=updated.map(e=>e.id===message.id?{...e,topic:label}:e);if(!topics.some(topic=>topic.toLowerCase()===label.toLowerCase()))topics.push(label); }
    if(message.type==='rename-topic') { const label=cleanTopic(message.topic);const ids=new Set(message.ids);updated=updated.map(e=>ids.has(e.id)?{...e,topic:label}:e);topics=topics.filter(topic=>topic.toLowerCase()!==message.oldTopic.toLowerCase());if(!topics.some(topic=>topic.toLowerCase()===label.toLowerCase()))topics.push(label); }
    if(message.type==='import') { const backup=parseBackup(message.text),ids=new Set(updated.map(e=>e.id));for(const entry of backup.entries)if(!ids.has(entry.id)){updated.push(entry);ids.add(entry.id);}for(const topic of backup.topics)if(!topics.some(value=>value.toLowerCase()===topic.toLowerCase()))topics.push(topic); }
    localStorage.setItem('tag-master-preview',JSON.stringify(updated));
    localStorage.setItem('tag-master-topics',JSON.stringify(topics));
  }
  await load(); return true;
}
function run(task) { return task().catch(error=>notify(error.message)); }
function makeLink(entry, favorite=false) {
  const a=element('a',favorite?'favorite':'page-link'); a.href=entry.url; a.target='_blank'; a.rel='noopener noreferrer';
  a.append(element('span','site-letter',domain(entry)[0].toUpperCase()));
  if(favorite)a.append(element('span','',entry.title));
  else {const copy=element('span','page-copy');copy.append(element('span','page-title',entry.title),element('span','page-domain',domain(entry)));a.append(copy);}
  if(demo)a.addEventListener('click',event=>{event.preventDefault();notify('Sample link. Save your own pages to open them here.');});
  a.addEventListener('mouseenter',()=>schedulePreview(entry,a));a.addEventListener('focus',()=>schedulePreview(entry,a));
  a.addEventListener('mouseleave',hidePreviewSoon);a.addEventListener('blur',hidePreviewSoon);
  return a;
}
function editTopic(button,group) {
  const input=element('input','topic-edit');input.value=group.label;input.maxLength=80;input.setAttribute('aria-label','Topic name');
  button.replaceWith(input);input.focus();input.select();
  let finished=false;
  const finish=save=>{if(finished)return;finished=true;if(!save||input.value.trim()===group.label){input.replaceWith(button);return;}
    const ids=groupEntries(entries,topics).find(item=>item.id===group.id)?.entries.map(entry=>entry.id)||[];
    run(async()=>{if(await mutate({type:'rename-topic',oldTopic:group.label,topic:input.value,ids}))notify('Topic renamed.');});
  };
  input.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();finish(true);}if(event.key==='Escape'){event.preventDefault();finish(false);}};
  input.onblur=()=>finish(true);
}
function render() {
  hidePreview();
  $('#demo-banner').hidden=!demo;
  $('#all-count').textContent=entries.length;$('#pin-count').textContent=entries.filter(e=>e.pinned).length;
  const pinned=entries.filter(e=>e.pinned);$('#favorites-section').hidden=!pinned.length;
  $('#favorites').replaceChildren(...pinned.map(e=>makeLink(e,true)));
  $('#view-title').textContent=view==='pinned'?'Your everyday favorites.':view==='recent'?'Your latest little discoveries.':'A happy place for your tabs.';
  const query=$('#search').value.trim().toLowerCase();
  let groups=groupEntries(entries,topics).map(group=>({...group,entries:group.entries.filter(e=>(view!=='pinned'||e.pinned)&&(view!=='recent'||Date.now()-e.savedAt<7*86400000)&&(!query||`${group.label} ${e.title} ${e.description} ${e.url}`.toLowerCase().includes(query)))})).filter(g=>g.entries.length||(view==='all'&&(!query||group.label.toLowerCase().includes(query))&&topics.some(topic=>topic.toLowerCase()===g.id)));
  const sort=$('#sort').value;
  const compare=sort==='title'?(a,b)=>a.title.localeCompare(b.title):sort==='oldest'?(a,b)=>a.savedAt-b.savedAt:(a,b)=>b.savedAt-a.savedAt;
  for(const group of groups)group.entries.sort(compare);
  groups.sort(sort==='title'?(a,b)=>a.label.localeCompare(b.label):(a,b)=>a.entries.length&&b.entries.length?compare(a.entries[0],b.entries[0]):b.entries.length-a.entries.length||a.label.localeCompare(b.label));
  const count=groups.reduce((sum,g)=>sum+g.entries.length,0);
  $('#summary').textContent=`${count} ${count===1?'link':'links'} in ${groups.length} ${groups.length===1?'topic':'topics'}${view==='recent'?' / last 7 days':''}`;
  const cards=groups.map(group=>{
    const card=element('section','topic-card'), heading=element('div','topic-heading');
    const title=element('h3');const rename=element('button','topic-name',group.label);rename.type='button';rename.title='Rename topic';rename.setAttribute('aria-label',`Rename topic ${group.label}`);rename.onclick=()=>editTopic(rename,group);title.append(rename);
    heading.append(title,element('span','count',String(group.entries.length)));card.append(heading,element('div','topic-info',group.entries.length?'Gathered by topic':'Drag links here to fill this topic'));
    card.ondragover=event=>{if(event.dataTransfer.types.includes('text/plain')){event.preventDefault();event.dataTransfer.dropEffect='move';card.classList.add('drop-target');}};
    card.ondragleave=event=>{if(!card.contains(event.relatedTarget))card.classList.remove('drop-target');};
    card.ondrop=event=>{event.preventDefault();card.classList.remove('drop-target');const id=event.dataTransfer.getData('text/plain');if(!entries.some(entry=>entry.id===id)||group.entries.some(entry=>entry.id===id))return;run(async()=>{if(await mutate({type:'set-topic',id,topic:group.label}))notify(`Moved to ${group.label}.`);});};
    const list=element('ul','link-list');
    for(const entry of group.entries){
      const row=element('li','link-row');row.draggable=true;row.title='Drag to another topic';row.ondragstart=event=>{hidePreview();event.dataTransfer.setData('text/plain',entry.id);event.dataTransfer.effectAllowed='move';row.classList.add('dragging');};row.ondragend=()=>{row.classList.remove('dragging');document.querySelectorAll('.drop-target').forEach(node=>node.classList.remove('drop-target'));};row.append(makeLink(entry));
      const pin=element('button','row-action pin',entry.pinned?'★':'☆');pin.title=entry.pinned?'Unpin link':'Pin link';pin.setAttribute('aria-label',`${entry.pinned?'Unpin':'Pin'} ${entry.title}`);pin.setAttribute('aria-pressed',String(entry.pinned));pin.onclick=()=>run(()=>mutate({type:'pin',id:entry.id}));
      const remove=element('button','row-action delete','×');remove.title='Delete link';remove.setAttribute('aria-label',`Delete ${entry.title}`);remove.onclick=()=>run(async()=>{if(await mutate({type:'delete',id:entry.id})){deleted=entry;notify('Link deleted.',true);$('#search').focus();}});
      row.append(pin,remove);list.append(row);
    }card.append(list);return card;
  });
  $('#groups').replaceChildren(...cards);$('#empty').hidden=!!(entries.length||topics.length);
  if(entries.length&&!cards.length) {const empty=element('p','muted',query?'No matches. Try another title, topic, or website.':view==='pinned'?'No pinned links yet. Use the star beside any saved link.':'No pages saved in the last 7 days. Your older links are in All saved.');$('#groups').append(empty);}
}
function schedulePreview(entry,anchor){clearTimeout(previewTimer);previewTimer=setTimeout(()=>{
  const preview=$('#preview');preview.replaceChildren(element('small','',domain(entry)),element('h3','',entry.title),element('p','',entry.description||entry.text.slice(0,650)||'No content excerpt was available when this page was saved.'),element('small','',`Saved ${new Date(entry.savedAt).toLocaleDateString()} / captured excerpt`));
  const rect=anchor.getBoundingClientRect();preview.hidden=false;const height=preview.offsetHeight;
  preview.style.left=`${Math.max(12,Math.min(rect.left,innerWidth-352))}px`;
  preview.style.top=`${Math.max(12,rect.bottom+height+14<innerHeight?rect.bottom+10:rect.top-height-10)}px`;
},250);}
function hidePreview(){clearTimeout(previewTimer);$('#preview').hidden=true;}
function hidePreviewSoon(){clearTimeout(previewTimer);previewTimer=setTimeout(hidePreview,180);}
$('#preview').onmouseenter=()=>clearTimeout(previewTimer);$('#preview').onmouseleave=hidePreviewSoon;
document.addEventListener('keydown',event=>{if(event.key==='Escape')hidePreview();});
window.addEventListener('resize',hidePreview);
document.querySelectorAll('[data-view]').forEach(button=>button.onclick=()=>{view=button.dataset.view;document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b===button));render();});
$('#search').oninput=render;$('#sort').onchange=render;
for(const id of ['#add','#empty-add'])$(id).onclick=()=>$('#add-dialog').showModal();
$('#create-topic').onclick=()=>{$('#topic-dialog').showModal();$('#topic-form input').focus();};
$('#topic-form').onsubmit=event=>{event.preventDefault();run(async()=>{const button=$('#topic-form button[type="submit"]');button.disabled=true;try{if(await mutate({type:'create-topic',topic:new FormData(event.target).get('topic')})){$('#topic-dialog').close();event.target.reset();notify('Topic created.');}}finally{button.disabled=false;}});};
$('#help-button').onclick=()=>$('#help-dialog').showModal();
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>b.closest('dialog').close());
$('#add-form').onsubmit=event=>{event.preventDefault();run(async()=>{const button=$('#add-form button[type="submit"]');button.disabled=true;try{if(await mutate({type:'save',page:Object.fromEntries(new FormData(event.target))})){$('#add-dialog').close();event.target.reset();notify('Link saved.');}}finally{button.disabled=false;}});};
$('#undo').onclick=()=>run(async()=>{if(deleted&&await mutate({type:'save',page:deleted})){deleted=null;notify('Link restored.');}});
$('#export').onclick=()=>{const blob=new Blob([JSON.stringify({version:2,exportedAt:new Date().toISOString(),entries,topics},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=element('a');a.href=url;a.download=`tag-master${demo?'-example':''}-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);notify('Backup exported.');};
$('#import').onclick=()=>$('#import-file').click();
$('#import-file').onchange=event=>run(async()=>{const file=event.target.files[0];try{if(!file)return;if(file.size>40*1024*1024)throw new Error('This backup is too large (40 MB maximum).');if(await mutate({type:'import',text:await file.text()}))notify('Backup imported. Existing links were kept.');}finally{event.target.value='';}});
let theme=localStorage.getItem('tag-master-theme')||'light';
function updatePageVisibility(){document.documentElement.classList.toggle('page-hidden',document.hidden);}
document.addEventListener('visibilitychange',updatePageVisibility);updatePageVisibility();
function applyTheme(){if(theme==='system')delete document.documentElement.dataset.theme;else document.documentElement.dataset.theme=theme;$('#theme').textContent=`Theme: ${theme[0].toUpperCase()+theme.slice(1)}`;}
$('#theme').onclick=()=>{theme={system:'light',light:'dark',dark:'system'}[theme];localStorage.setItem('tag-master-theme',theme);applyTheme();};applyTheme();
if(extension)chrome.storage.onChanged.addListener((_,area)=>{if(area==='local')run(load);});
else window.addEventListener('storage',()=>run(load));
run(load);
