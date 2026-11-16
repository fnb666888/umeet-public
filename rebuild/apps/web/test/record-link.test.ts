import {describe,it,expect} from 'vitest';
import {recordLink} from '../src/lib/record-link';
describe('private record links',()=>{
 it('opens a stored Wiki bookmark without printing its internal JSON',()=>{
  expect(recordLink(JSON.stringify({title:'信息熵',href:'/wiki/page-123'}))).toEqual({title:'信息熵',href:'/wiki/page-123'});
 });
 it('rejects executable, external and malformed record destinations',()=>{
  for(const href of ['javascript:alert(1)','//evil.invalid','https://evil.invalid','/wiki/a/../../admin'])expect(recordLink(JSON.stringify({title:'名称',href}))).toBeNull();
  expect(recordLink('普通文字')).toBeNull();
 });
});
