import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
const root=new URL('../',import.meta.url);
const local=new URL('.local/',root);await mkdir(local,{recursive:true});
const connection=JSON.parse(await readFile(new URL('connection.json',local),'utf8'));
let executablePath=process.env.BROWSER_EXECUTABLE;
if(!executablePath){const cached=`${homedir()}/Library/Caches/ms-playwright/chromium-1161/chrome-mac/Chromium.app/Contents/MacOS/Chromium`;try{await access(cached);executablePath=cached;}catch{executablePath=chromium.executablePath();}}
const profile=await mkdtemp(fileURLToPath(new URL('browser-profile-',local)));
const extPath=fileURLToPath(new URL('dist/extension',root));
const context=await chromium.launchPersistentContext(profile,{executablePath,headless:true,args:[`--disable-extensions-except=${extPath}`,`--load-extension=${extPath}`],viewport:{width:1280,height:1000},acceptDownloads:true});
const errors=[];context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
const shots=new URL('screenshots/',local);await mkdir(shots,{recursive:true});
try{
 const worker=context.serviceWorkers().find(w=>w.url().startsWith('chrome-extension://'))||await context.waitForEvent('serviceworker',{predicate:w=>w.url().startsWith('chrome-extension://')});
 for(let i=0;i<100;i++){if(await worker.evaluate(()=>!!globalThis.chrome?.storage?.local))break;if(i===99)throw new Error('Extension API did not initialize');await new Promise(r=>setTimeout(r,50));}
 const extensionId=new URL(worker.url()).host;
 await worker.evaluate(async({serverUrl,clientToken})=>{await chrome.storage.local.set({enabled:false,serverUrl,clientToken,locale:'zh-CN',targetLanguage:'zh-Hans'});},connection);
 const setup=await context.newPage();await setup.goto(connection.setupUrl);await setup.locator('#service-status').filter({hasText:'本地翻译服务已启动'}).waitFor();
 for(const [locale,width,height] of [['zh-CN',1280,1000],['en',1280,1000],['zh-CN',390,844],['en',390,844]]){
  await setup.setViewportSize({width,height});await setup.selectOption('#language',locale);
  assert.equal(await setup.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`Setup overflow: ${locale}/${width}`);
  await setup.screenshot({path:fileURLToPath(new URL(`setup-${locale}-${width}.png`,shots)),fullPage:true});
 }
 // User-facing button calls the real server and real configured provider, never a stub.
 await setup.click('#test-translation');await setup.waitForFunction(()=>/[㐀-鿿]/.test(document.querySelector('#test-result').textContent),null,{timeout:110000});
 const realTranslation=await setup.locator('#test-result').textContent();assert(!/翻译失败|正在|测试后/.test(realTranslation));
 console.log('Setup button real translation:',realTranslation);
 const options=await context.newPage();await options.goto(`chrome-extension://${extensionId}/options.html`);
 await options.locator('#connection-state').filter({hasText:'服务已连接'}).waitFor();
 for(const [locale,width] of [['zh-CN',1100],['en',1100],['zh-CN',390],['en',390]]){
  await options.setViewportSize({width,height:1000});await options.selectOption('#locale',locale);
  assert.equal(await options.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`Options overflow: ${locale}/${width}`);
  await options.screenshot({path:fileURLToPath(new URL(`options-${locale}-${width}.png`,shots)),fullPage:true});
 }
 // Controlled YouTube-shaped fixture: real MV3 injection, message bridge, fetch,
 // service worker, backend/provider, overlay and file downloads. Not a live-site claim.
 let clip;
 try { clip=await readFile(new URL('fixture.webm',local)); } catch {
  const bytes=await setup.evaluate(async()=>{const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;const ctx=canvas.getContext('2d');const stream=canvas.captureStream(12);const recorder=new MediaRecorder(stream,{mimeType:'video/webm'});const parts=[];recorder.ondataavailable=e=>parts.push(e.data);const done=new Promise(r=>recorder.onstop=r);recorder.start();let tick=0;const timer=setInterval(()=>{ctx.fillStyle='#234a39';ctx.fillRect(0,0,640,360);ctx.fillStyle='#7b9f7c';ctx.beginPath();ctx.arc(320+Math.sin(tick++/15)*25,145,80,0,Math.PI*2);ctx.fill();},80);await new Promise(r=>setTimeout(r,6500));recorder.stop();await done;clearInterval(timer);stream.getTracks().forEach(t=>t.stop());return Array.from(new Uint8Array(await new Blob(parts).arrayBuffer()));});
  clip=Buffer.from(bytes);await writeFile(new URL('fixture.webm',local),clip);
 }
 const id='cbfixture01';
 const captionBody=JSON.stringify({events:[{tStartMs:0,dDurationMs:2500,segs:[{utf8:'Hello and welcome to this video.'}]},{tStartMs:3000,dDurationMs:2500,segs:[{utf8:'Today we are learning something new.'}]}]});
 const fixture=`<!doctype html><html><head><title>CaptionBridge integration fixture</title><style>body{background:#f3f6ef;font:16px system-ui;color:#24442f;padding:40px}#movie_player{position:relative;width:900px;height:500px;background:#234a39;border-radius:14px}video{width:100%;height:100%}</style></head><body><h1>Controlled caption integration fixture</h1><div id="movie_player"><video class="html5-main-video" autoplay muted loop src="data:video/webm;base64,${clip.toString('base64')}"></video></div><script>window.ytInitialPlayerResponse={videoDetails:{videoId:'${id}',title:'CaptionBridge integration fixture'},captions:{playerCaptionsTracklistRenderer:{captionTracks:[{baseUrl:'https://www.youtube.com/api/timedtext?v=${id}&lang=en',languageCode:'en',name:{simpleText:'English'}}]}}};document.getElementById('movie_player').getPlayerResponse=()=>window.ytInitialPlayerResponse;const v=document.querySelector('video');v.addEventListener('loadeddata',()=>v.play());</script></body></html>`;
 await context.route('https://www.youtube.com/api/timedtext?*',route=>route.fulfill({status:200,contentType:'application/json',body:captionBody}));
 await context.route(`https://www.youtube.com/watch?v=${id}`,route=>route.fulfill({status:200,contentType:'text/html',body:fixture}));
 await worker.evaluate(async()=>chrome.storage.local.set({enabled:true,locale:'en'}));
 const video=await context.newPage();await video.goto(`https://www.youtube.com/watch?v=${id}`);
 const tab=await worker.evaluate(async id=>(await chrome.tabs.query({url:`https://www.youtube.com/watch?v=${id}`}))[0].id,id);
 try { await video.waitForFunction(()=>{const h=document.querySelector('#captionbridge-overlay');return h&&!h.hidden&&/[㐀-鿿]/.test(h.shadowRoot.querySelector('.translated').textContent);},null,{timeout:20000}); }
 catch(e){console.log('Fixture diagnostics:',JSON.stringify(await worker.evaluate(async tab=>chrome.tabs.sendMessage(tab,{type:'GET_STATUS'}),tab)));console.log('Page diagnostics:',JSON.stringify(await video.evaluate(()=>({player:!!window.ytInitialPlayerResponse,video:{paused:document.querySelector('video').paused,time:document.querySelector('video').currentTime,ready:document.querySelector('video').readyState},overlay:document.querySelector('#captionbridge-overlay')?.outerHTML,body:document.body.innerText}))));console.log('Page errors:',errors);throw e;}
 const send=(type,extra={})=>worker.evaluate(async({tab,type,extra})=>chrome.tabs.sendMessage(tab,{type,...extra}),{tab,type,extra});
 let status;
 for(let i=0;i<40;i++){status=await send('GET_STATUS');if(status.data.state==='ready')break;await new Promise(r=>setTimeout(r,250));}
 assert.equal(status.data.state,'ready');assert.equal(status.data.completed,2);
 await video.screenshot({path:fileURLToPath(new URL('fixture-overlay.png',shots))});
 await video.evaluate(()=>{document.querySelector('video').currentTime=3.2;});
 await video.waitForFunction(()=>document.querySelector('#captionbridge-overlay').shadowRoot.querySelector('.original').textContent.startsWith('Today'));
 await video.evaluate(()=>document.querySelector('video').pause());
 assert(await video.locator('#captionbridge-overlay').evaluate(e=>e.hidden));
 await video.evaluate(()=>{const v=document.querySelector('video');v.currentTime=.5;return v.play();});
 for(const format of ['srt','vtt']){const exported=await send('DOWNLOAD',{format});assert(exported.ok);assert.match(exported.data.text,/Hello and welcome/);assert.match(exported.data.text,/[㐀-鿿]/);assert.match(exported.data.text,/00:00:00[,.]000 --> 00:00:02[,.]500/);}
 const popup=await context.newPage();await popup.goto(`chrome-extension://${extensionId}/popup.html`);await popup.setViewportSize({width:390,height:850});
 // Keep the YouTube tab active so activeTab-based popup discovery finds it.
 await worker.evaluate(async tab=>chrome.tabs.update(tab,{active:true}),tab);
 await popup.locator('#video-state').filter({hasText:'Bilingual subtitles ready'}).waitFor({timeout:10000});
 for(const locale of ['en','zh-CN']){await popup.selectOption('#locale',locale);await popup.screenshot({path:fileURLToPath(new URL(`popup-${locale}.png`,shots)),fullPage:true});assert(await popup.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
 const downloadPromise=popup.waitForEvent('download');await popup.click('#download-srt');const download=await downloadPromise;
 const file=await download.path();assert.match(await readFile(file,'utf8'),/Hello and welcome/);
 const before=await send('GET_STATUS');await worker.evaluate(async()=>chrome.storage.local.set({locale:'en'}));const after=await send('GET_STATUS');assert.equal(before.data.completed,after.data.completed,'Language switch preserves progress');
 await worker.evaluate(async()=>chrome.storage.local.set({enabled:false}));
 await video.waitForFunction(()=>document.querySelector('#captionbridge-overlay').hidden);
 console.log('MV3 fixture passed: bridge → real model → overlay, seek/pause, bilingual export, actual download, locale persistence, disabled state.');
 assert.deepEqual(errors,[],`Browser exceptions: ${errors.join('; ')}`);
 console.log('Desktop/mobile zh/en layouts and console checks passed. Screenshots: .local/screenshots/');
 if(process.argv.includes('--youtube')){
  await context.unroute('https://www.youtube.com/api/timedtext?*');
  const live=await context.newPage();
  try{
   await live.goto('https://www.youtube.com/watch?v=iG9CE55wbtY',{waitUntil:'domcontentloaded',timeout:30000});
   const metadata=await live.evaluate(()=>new Promise(resolve=>{const requestId=crypto.randomUUID();const timeout=setTimeout(()=>resolve({ok:false,error:{code:'BRIDGE_TIMEOUT'}}),20000);window.addEventListener('message',function handler(e){if(e.data?.source==='CAPTIONBRIDGE_RESPONSE'&&e.data.requestId===requestId){clearTimeout(timeout);window.removeEventListener('message',handler);resolve(e.data);}});window.postMessage({source:'CAPTIONBRIDGE_REQUEST',type:'GET_TRACKS',requestId,videoId:'iG9CE55wbtY'},location.origin);}));
   console.log('Live YouTube caption discovery:',JSON.stringify({ok:metadata.ok,error:metadata.error,tracks:metadata.data?.tracks?.length}));
   if(metadata.ok){const captions=await live.evaluate(({videoId,trackIndex})=>new Promise(resolve=>{const requestId=crypto.randomUUID();const timeout=setTimeout(()=>resolve({ok:false,error:{code:'BRIDGE_TIMEOUT'}}),22000);window.addEventListener('message',function handler(e){if(e.data?.source==='CAPTIONBRIDGE_RESPONSE'&&e.data.requestId===requestId){clearTimeout(timeout);window.removeEventListener('message',handler);resolve(e.data);}});window.postMessage({source:'CAPTIONBRIDGE_REQUEST',type:'GET_CAPTIONS',requestId,videoId,trackIndex},location.origin);}),{videoId:'iG9CE55wbtY',trackIndex:metadata.data.tracks[0].index});console.log('Live YouTube caption fetch:',JSON.stringify({ok:captions.ok,error:captions.error,format:captions.data?.format,chars:captions.data?.raw?.length}));}
   await live.screenshot({path:fileURLToPath(new URL('youtube-live.png',shots))});
  }catch(e){console.log('Live YouTube verification unavailable:',e.message.split('\n')[0]);}
 }
}finally{await context.close();}
