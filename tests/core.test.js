import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalUrl, cleanEntry, groupEntries, parseBackup } from '../core.js';

test('safe URLs, duplicate video identity, dynamic topics, and backup validation', () => {
  assert.equal(canonicalUrl('https://youtu.be/abc?t=20'),canonicalUrl('https://www.youtube.com/watch?v=abc&list=123&t=60'));
  assert.equal(canonicalUrl('https://example.com/path?utm_source=x&lesson=2#section'),'https://example.com/path?lesson=2#section');
  assert.throws(()=>cleanEntry({url:'javascript:alert(1)'}));
  const titles=['Obsidian for medical students','How to organize anatomy in Obsidian','Obsidian study workflows','Obsidian clinical notes','Using Obsidian for exam revision','Guitar fingerstyle practice','Guitar chord exercises'];
  const entries=titles.map((title,i)=>cleanEntry({title,url:`https://example.com/${i}`}));
  const groups=groupEntries(entries);
  assert.equal(groups.find(g=>g.label==='Obsidian').entries.length,5);
  assert.equal(groups.find(g=>g.label==='Guitar').entries.length,2);
  const mixed = [
    ['Codex: getting started with your first project','Explore coding workflows and build your first project.'],
    ['A practical Codex code review workflow','An example walkthrough of reviewing changes and validating fixes.'],
    ['Guitar practice: a daily routine','Build a repeatable practice routine.'],
    ['Guitar fingerstyle fundamentals','Technique and patterns.'],
    ['Machine learning foundations','Understand the building blocks of machine learning.'],
    ['Machine learning: from theory to practice','Connect core ideas to practical experiments.']
  ].map(([title,description],i)=>cleanEntry({title,description,url:`https://example.org/${i}`}));
  assert.deepEqual(groupEntries(mixed).map(g=>[g.label,g.entries.length]).sort(),[['Codex',2],['Guitar',2],['Machine learning',2]]);
  assert.equal(groupEntries([cleanEntry({title:'天文学 观测 指南',url:'https://example.com/1'}),cleanEntry({title:'天文学 恒星 研究',url:'https://example.com/2'})])[0].entries.length,2);
  assert.deepEqual(parseBackup(JSON.stringify({version:1,entries})),{entries,topics:[]});
  const moved=cleanEntry({...entries[0],topic:'Study notes'});
  const manual=groupEntries([moved,...entries.slice(1)],['Study notes','Read later']);
  assert.equal(manual.find(group=>group.label==='Study notes').entries[0].id,moved.id);
  assert.equal(manual.find(group=>group.label==='Read later').entries.length,0);
  assert.deepEqual(parseBackup(JSON.stringify({version:2,entries:[moved],topics:['Study notes','Read later']})),{entries:[moved],topics:['Study notes','Read later']});
  assert.throws(()=>parseBackup('{"version":2,"entries":[]}'));
  assert.throws(()=>parseBackup('{"version":1,"entries":[{"url":"file:///secrets"}]}'));
});
