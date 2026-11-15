import test from 'node:test';
import http from 'node:http';
import assert from 'node:assert/strict';
import { createApp, allowedOrigin } from '../server/app.js';
import { Translator, AppError, parseTranslations, validateRequest } from '../server/translator.js';
import { normalizeServerUrl } from '../extension/src/settings.js';
import { strings, errorText } from '../extension/src/i18n.js';
const payload={sourceLanguage:'en',targetLanguage:'zh-Hans',cues:[{id:1,text:'Hello'},{id:2,text:'Goodbye'}]};
const provider=async({cues})=>cues.map(c=>({id:c.id,text:c.text==='Hello'?'你好':'再见'}));

test('request validation bounds language, duplicates, size and cue input',()=>{
 assert.deepEqual(validateRequest(payload),payload);
 for(const bad of [{...payload,cues:[]},{...payload,targetLanguage:'auto'},{...payload,sourceLanguage:'ignore instructions'},{...payload,cues:[{id:1,text:'a'},{id:'1',text:'b'}]},{...payload,cues:[{id:{},text:'a'}]},{...payload,cues:[{id:1,text:'x'.repeat(2001)}]}])assert.throws(()=>validateRequest(bad),AppError);
});
test('model output validates IDs and returns input order, not model order',()=>{
 assert.deepEqual(parseTranslations('{"translations":[{"id":2,"text":"再见"},{"id":1,"text":"你好"}]}',payload.cues),[{id:1,text:'你好'},{id:2,text:'再见'}]);
 for(const value of ['not json','{"translations":[]}','{"translations":[{"id":1,"text":"a"},{"id":1,"text":"b"}]}','{"translations":[{"id":1,"text":"a"},{"id":3,"text":"b"}]}'])assert.throws(()=>parseTranslations(value,payload.cues),AppError);
});
test('cache is context/model/language scoped, preserves current IDs, expires, and bounds entries',async()=>{
 let count=0,now=0;const tr=new Translator({model:'test',cacheLimit:2,now:()=>now,provider:async b=>{count++;return provider(b);}});
 assert.equal((await tr.translate(payload)).cached,0);
 const second=await tr.translate({...payload,cues:payload.cues.map((c,i)=>({...c,id:'new'+i}))});
 assert.equal(second.cached,2);assert.equal(second.translations[0].id,'new0');assert.equal(count,1);
 await tr.translate({...payload,targetLanguage:'ja'});assert.equal(count,2);
 now=86400001;await tr.translate(payload);assert.equal(count,3);
 await tr.translate({...payload,targetLanguage:'fr'});assert.equal(tr.cache.size,2);
});
test('coalesces duplicate requests while rejecting excess concurrent work',async()=>{
 let finish;const gate=new Promise(r=>finish=r);const tr=new Translator({model:'test',maxConcurrent:1,provider:async b=>{await gate;return provider(b);}});
 const a=tr.translate(payload),b=tr.translate(payload);
 await assert.rejects(tr.translate({...payload,targetLanguage:'ja'}),e=>e.code==='SERVER_BUSY');finish();await Promise.all([a,b]);assert.equal(tr.active,0);
});
test('missing credentials never fall back to mock translations',async()=>{const tr=new Translator({model:'test',provider:null});await assert.rejects(tr.translate(payload),e=>e.code==='MODEL_NOT_CONFIGURED');});
test('origin allowlist and localhost address validation reject unrelated sites',()=>{
 assert(allowedOrigin('chrome-extension://'+'a'.repeat(32),8787));assert(allowedOrigin('http://127.0.0.1:8787',8787));
 assert(!allowedOrigin('https://evil.test',8787));assert(!allowedOrigin('null',8787));assert(!allowedOrigin('http://localhost:9999',8787));
 assert.equal(normalizeServerUrl('http://localhost:8787/'),'http://localhost:8787');
 for(const u of ['https://example.com','http://127.0.0.1.evil.test:8787','http://user:pass@localhost:8787','http://localhost:8787/path','file:///etc/passwd'])assert.throws(()=>normalizeServerUrl(u));
});
test('both UI dictionaries have identical keys',()=>{assert.deepEqual(Object.keys(strings.en).sort(),Object.keys(strings['zh-CN']).sort());assert.notEqual(errorText('en','NO_CAPTIONS'),errorText('zh-CN','NO_CAPTIONS'));});
test('HTTP integration: health, pairing, translation, cache, CORS, DNS rebinding, malformed inputs',async t=>{
 const tr=new Translator({model:'test-provider',provider});const token='a'.repeat(64);
 const server=createApp({translator:tr,clientToken:token,model:'test-provider',webDir:new URL('../web/',import.meta.url),zipPath:new URL('../releases/missing.zip',import.meta.url),port:0});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const base=`http://127.0.0.1:${server.address().port}`;
 let r=await fetch(base+'/api/health');assert.equal(r.status,200);assert.equal((await r.json()).data.configured,true);
 r=await fetch(base+'/api/status');assert.equal(r.status,401);
 const headers={Authorization:`Bearer ${token}`,'Content-Type':'application/json'};
 r=await fetch(base+'/api/translate',{method:'POST',headers,body:JSON.stringify(payload)});assert.equal(r.status,200);assert.equal((await r.json()).data.translations[0].text,'你好');
 r=await fetch(base+'/api/translate',{method:'POST',headers,body:JSON.stringify(payload)});assert.equal((await r.json()).data.cached,2);
 r=await fetch(base+'/api/translate',{method:'POST',headers,body:'{oops'});assert.equal(r.status,400);
 r=await fetch(base+'/api/translate',{method:'POST',headers:{...headers,Origin:'https://evil.test'},body:JSON.stringify(payload)});assert.equal(r.status,403);assert.equal(r.headers.get('access-control-allow-origin'),null);
 const hostileHostStatus=await new Promise((resolve,reject)=>{http.get(base+'/api/health',{headers:{Host:'attacker.test'}},res=>{res.resume();resolve(res.statusCode);}).on('error',reject);});assert.equal(hostileHostStatus,403);
 r=await fetch(base+'/api/translate',{method:'POST',headers,body:'x'.repeat(66000)});assert.equal(r.status,413);
 r=await fetch(base+'/.env',{headers});assert.equal(r.status,404);
 r=await fetch(base+'/');assert.equal(r.status,200);assert.match(r.headers.get('content-security-policy'),/frame-ancestors 'none'/);assert(!(await r.text()).includes(token));
});
