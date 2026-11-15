import { mkdir, cp, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = new URL('../',import.meta.url);
await access(new URL('dist/extension/manifest.json',root));
const release=new URL('releases/',root);await mkdir(release,{recursive:true});
const stamp=new Date().toISOString().replace(/[:.]/g,'-');
const staging=new URL(`.local/package-${stamp}/`,root);await mkdir(staging,{recursive:true,mode:0o700});
const extensionDir=new URL('extension/',staging);await cp(new URL('dist/extension/',root),extensionDir,{recursive:true});
// Use new archives, then replace only these known generated deliverables.
function zip(cwd,dest,items){const r=spawnSync('/usr/bin/zip',['-qr',fileURLToPath(dest),...items],{cwd:fileURLToPath(cwd),stdio:'inherit'});if(r.status!==0)throw new Error('Packaging failed');}
const extensionZip=new URL('extension.zip',staging);zip(extensionDir,extensionZip,['.']);
await cp(extensionZip,new URL('captionbridge-extension.zip',release));
const sourceDir=new URL('CaptionBridge/',staging);await mkdir(sourceDir);
// Explicit allowlist: NEVER package .env, .local, caches, screenshots or node_modules.
const include=['package.json','package-lock.json','README.md','README.en.md','CHANGELOG.md','.env.example','.gitignore','server','web','extension','scripts','tests','dist','start.command','open-setup.command','stop.command'];
for(const item of include)await cp(new URL(item,root),new URL(item,sourceDir),{recursive:true});
const fullZip=new URL('full.zip',staging);zip(staging,fullZip,['CaptionBridge']);
await cp(fullZip,new URL('captionbridge-full.zip',release));
console.log('Created releases/captionbridge-extension.zip and releases/captionbridge-full.zip (no credentials).');
