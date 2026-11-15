import { build } from 'esbuild';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
const out = new URL('dist/extension/', root);
await mkdir(out, { recursive: true });
await build({ absWorkingDir: fileURLToPath(root), entryPoints: ['extension/src/background.js', 'extension/src/content.js', 'extension/src/page-bridge.js', 'extension/src/ui.js'], outdir: fileURLToPath(out), bundle: true, format: 'iife', target: 'chrome111', sourcemap: false, legalComments: 'none' });
for (const file of ['manifest.json','ui.css']) await copyFile(new URL('extension/' + file, root), new URL(file, out));
for (const file of ['popup.html','options.html']) await copyFile(new URL('extension/ui.html', root), new URL(file, out));
for (const [locale, name, description] of [['en','CaptionBridge — Bilingual YouTube','Translate existing YouTube captions and download bilingual SRT / WebVTT subtitles with your local model service.'],['zh_CN','CaptionBridge — YouTube 双语字幕','通过本地模型服务翻译 YouTube 已有字幕，并下载双语 SRT / WebVTT 字幕文件。']]) {
  const dir = new URL(`_locales/${locale}/`, out); await mkdir(dir, { recursive: true });
  await writeFile(new URL('messages.json',dir), JSON.stringify({ appName:{message:name}, appDescription:{message:description} },null,2));
}
// Generate tiny local raster icons without remote assets or executable downloads.
const crcTable = Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++) n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function crc(buf){let n=0xffffffff;for(const byte of buf)n=crcTable[(n^byte)&255]^(n>>>8);return (n^0xffffffff)>>>0;}
function chunk(type,data){const t=Buffer.from(type);const size=Buffer.alloc(4);size.writeUInt32BE(data.length);const check=Buffer.alloc(4);check.writeUInt32BE(crc(Buffer.concat([t,data])));return Buffer.concat([size,t,data,check]);}
await mkdir(new URL('icons/',out),{recursive:true});
for(const size of [16,48,128]){
  const raw=Buffer.alloc((size*4+1)*size);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const i=y*(size*4+1)+1+x*4; const nx=x/size,ny=y/size;
    const line=(ny>.35&&ny<.43&&nx>.2&&nx<.7)||(ny>.56&&ny<.64&&nx>.32&&nx<.8)||(nx>.2&&nx<.28&&ny>.35&&ny<.56)||(nx>.72&&nx<.8&&ny>.43&&ny<.64);
    raw.set(line?[242,247,231,255]:[36,89,64,255],i);
  }
  const hdr=Buffer.alloc(13);hdr.writeUInt32BE(size);hdr.writeUInt32BE(size,4);hdr[8]=8;hdr[9]=6;
  await writeFile(new URL(`icons/icon${size}.png`,out),Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',hdr),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]));
}
const manifest=JSON.parse(await readFile(new URL('manifest.json',out),'utf8'));
console.log(`Built ${manifest.name} ${manifest.version} → dist/extension`);
