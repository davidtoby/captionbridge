import { readdir,readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root=new URL('../',import.meta.url);let count=0;
async function check(dir){for(const e of await readdir(dir,{withFileTypes:true})){const u=new URL(e.name+(e.isDirectory()?'/':''),dir);if(e.isDirectory())await check(u);else if(/\.(m?js)$/.test(e.name)){const r=spawnSync(process.execPath,['--check',fileURLToPath(u)],{stdio:'inherit'});if(r.status!==0)process.exit(r.status);count++;}}}
for(const d of ['server/','extension/src/','scripts/','tests/','web/'])await check(new URL(d,root));
const manifest=JSON.parse(await readFile(new URL('dist/extension/manifest.json',root),'utf8'));
for(const entry of [manifest.background.service_worker,manifest.action.default_popup,manifest.options_ui.page,...manifest.content_scripts.flatMap(s=>s.js)])await readFile(new URL('dist/extension/'+entry,root));
console.log(`${count} JavaScript files pass syntax checks; manifest entries exist.`);
