import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import test from 'node:test';
import { IframeMapView } from '../../main/mcp-ui/iframe-map.mjs';

const imageVersionId = 'a'.repeat(32);
const context = {
  enabled:true, provider:'AMAP', browser_key:'public-browser-key',
  js_url:'https://webapi.amap.com/maps?v=1.4.15', css_url:null, locale:'zh-CN',
  renderer_origin:'https://renderer.planly.test',
  renderer_url:`https://renderer.planly.test/mcp-apps/renderers/${imageVersionId}/${'b'.repeat(64)}.html`
};

function globals() {
  const previous = {
    document:Object.getOwnPropertyDescriptor(globalThis,'document'),
    crypto:Object.getOwnPropertyDescriptor(globalThis,'crypto')
  };
  let iframe;
  class FakeIframe {
    constructor() { this.handlers=new Map();this.className='';this.title='';this.contentWindow={postMessage(){}}; }
    addEventListener(type, listener) { this.handlers.set(type, listener); }
    setAttribute() {}
    emit(type) { this.handlers.get(type)?.(); }
    remove() {}
  }
  Object.defineProperty(globalThis,'crypto',{value:webcrypto,configurable:true,writable:true});
  Object.defineProperty(globalThis,'document',{value:{createElement(tag) { assert.equal(tag,'iframe');iframe=new FakeIframe();return iframe; }},configurable:true,writable:true});
  return {get iframe(){return iframe;},restore(){
    if(previous.document)Object.defineProperty(globalThis,'document',previous.document);else delete globalThis.document;
    if(previous.crypto)Object.defineProperty(globalThis,'crypto',previous.crypto);else delete globalThis.crypto;
  }};
}

test('renderer iframe error is reduced to the safe iframe code and last successful stage', async () => {
  const env=globals(),diagnostics=[];
  try {
    const container={replaceChildren(){}},view=new IframeMapView(container,{
      onSelect(){},onFailure(){},onDiagnostic:value=>diagnostics.push(value)
    });
    const mounted=view.mount(context,'AMAP',{markers:[],lines:[],warnings:[]},'zh-CN',imageVersionId);
    env.iframe.emit('error');
    await assert.rejects(mounted,error=>error.code==='RENDERER_IFRAME_LOAD_FAILED'
      && error.lastSuccessfulStage==='renderer_iframe_created'
      && error.failureStage==='renderer_document_loaded'
      && error.message==='RENDERER_IFRAME_LOAD_FAILED');
    assert.deepEqual(diagnostics,[{lastSuccessfulStage:'renderer_iframe_created',errorCode:null}]);
  } finally {env.restore();}
});

test('renderer progress ignores unknown and regressive stages', () => {
  const values=[],view=new IframeMapView({}, {onSelect(){},onFailure(){},onDiagnostic:value=>values.push(value)});
  view.advanceStage('renderer_channel_connected');
  view.advanceStage('raw task stage');
  view.advanceStage('renderer_document_loaded');
  view.advanceStage('amap_script_loaded');
  assert.equal(view.lastSuccessfulStage,'amap_script_loaded');
  assert.deepEqual(values.map(value=>value.lastSuccessfulStage),['renderer_channel_connected','amap_script_loaded']);
});
