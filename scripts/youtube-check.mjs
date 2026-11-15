import { chromium } from '@playwright/test';
import { mkdtemp, readFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseCaptions } from '../extension/src/subtitles.js';
const root=new URL('../',import.meta.url),local=new URL('.local/',root);await mkdir(local,{recursive:true});
const profile=await mkdtemp(fileURLToPath(new URL('youtube-check-',local)));
const ext=fileURLToPath(new URL('dist/extension/',root));
const executablePath=process.env.BROWSER_EXECUTABLE||`${homedir()}/Library/Caches/ms-playwright/chromium-1161/chrome-mac/Chromium.app/Contents/MacOS/Chromium`;
const context=await chromium.launchPersistentContext(profile,{executablePath,headless:true,viewport:{width:1280,height:900},args:[`--disable-extensions-except=${ext}`,`--load-extension=${ext}`]});
try{
 const worker=context.serviceWorkers().find(w=>w.url().startsWith('chrome-extension://'))||await context.waitForEvent('serviceworker',{predicate:w=>w.url().startsWith('chrome-extension://')});
 for(let i=0;i<100;i++){if(await worker.evaluate(()=>!!globalThis.chrome?.storage?.local))break;if(i===99)throw new Error('Extension API did not initialize');await new Promise(r=>setTimeout(r,50));}
 await worker.evaluate(()=>chrome.storage.local.set({enabled:false}));
 const page=await context.newPage();
 page.on('response',async r=>{if(new URL(r.url()).pathname==='/api/timedtext'){try{console.log('Native caption response:',JSON.stringify({status:r.status(),bytes:(await r.body()).length}));}catch{}}});
 await page.goto('https://www.youtube.com/watch?v=iG9CE55wbtY',{waitUntil:'domcontentloaded',timeout:30000});
 async function bridge(type,trackIndex){return page.evaluate(({type,trackIndex})=>new Promise(resolve=>{const requestId=crypto.randomUUID();const timeout=setTimeout(()=>resolve({ok:false,error:{code:'BRIDGE_TIMEOUT'}}),24000);window.addEventListener('message',function handler(e){if(e.data?.source==='CAPTIONBRIDGE_RESPONSE'&&e.data.requestId===requestId){clearTimeout(timeout);window.removeEventListener('message',handler);resolve(e.data);}});window.postMessage({source:'CAPTIONBRIDGE_REQUEST',type,requestId,videoId:'iG9CE55wbtY',trackIndex},location.origin);}),{type,trackIndex});}
 const metadata=await bridge('GET_TRACKS');console.log('Tracks:',JSON.stringify({ok:metadata.ok,count:metadata.data?.tracks?.length,error:metadata.error}));
 console.log('Audio defaults:',JSON.stringify(await page.evaluate(()=>{const r=document.querySelector('#movie_player')?.getPlayerResponse?.()||window.ytInitialPlayerResponse;const c=r?.captions?.playerCaptionsTracklistRenderer;return {audio:c?.audioTracks,defaultAudioTrackIndex:c?.defaultAudioTrackIndex,language:r?.videoDetails?.defaultAudioLanguage,defaultCaptionTrackIndex:c?.defaultCaptionTrackIndex};})));
 await page.locator('.ytp-large-play-button').click({timeout:15000}).catch(()=>{});
 await page.locator('.ytp-subtitles-button').waitFor({state:'visible',timeout:15000});
 if(await page.locator('.ytp-subtitles-button').getAttribute('aria-pressed')!=='true')await page.locator('.ytp-subtitles-button').click();
 await page.waitForFunction(()=>document.querySelector('video')?.currentTime>2,null,{timeout:20000}).catch(()=>{});
 console.log('Playback state:',JSON.stringify(await page.evaluate(()=>({time:document.querySelector('video')?.currentTime,paused:document.querySelector('video')?.paused,cc:document.querySelector('.ytp-subtitles-button')?.getAttribute('aria-pressed'),captionVisible:!!document.querySelector('.ytp-caption-segment'),error:document.querySelector('.ytp-error-content-wrap-reason')?.textContent}))));
 if(metadata.ok){const track=metadata.data.tracks.find(t=>t.languageCode==='en')||metadata.data.tracks[0];const captions=await bridge('GET_CAPTIONS',track.index);console.log('Caption retrieval:',JSON.stringify({ok:captions.ok,format:captions.data?.format,bytes:captions.data?.raw?.length,error:captions.error}));if(captions.ok){const cues=parseCaptions(captions.data.raw,captions.data.format);console.log('Parsed complete track:',cues.length,'cues');
  if(process.argv.includes('--translate')){const conn=JSON.parse(await readFile(new URL('connection.json',local),'utf8'));const result=await fetch(conn.serverUrl+'/api/translate',{method:'POST',headers:{Authorization:`Bearer ${conn.clientToken}`,'Content-Type':'application/json'},body:JSON.stringify({sourceLanguage:track.languageCode,targetLanguage:'zh-Hans',cues:cues.slice(0,3).map(({id,text})=>({id,text}))}),signal:AbortSignal.timeout(110000)}).then(r=>r.json());console.log('Actual YouTube sample translation:',JSON.stringify(result));}
 }}
 await page.screenshot({path:fileURLToPath(new URL('screenshots/youtube-playing.png',local))});
}finally{await context.close();}
