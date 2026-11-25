import './env.js';
import http from 'node:http';
import { URL } from 'node:url';
import { randomUUID, randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { read, write, seed, officialSources } from './store.js';
import { getApifyStatus, runConfiguredApifyActor } from './apify.js';
import { classifyStatus, createStatusSource } from './status-source.js';
import { initFlags, getFlags, isEnabled, flagStatus } from './flags.js';
import { transcribe, speak, summarise, sarvamStatus, VOICE_LANGUAGES } from './sarvam.js';
import QRCode from 'qrcode';
import { createHmac } from 'node:crypto';
initFlags();
const startedAt=Date.now();
const statusSource=createStatusSource();
const STAFF_STATUSES=['Open','Busy','Near capacity','Closed'];
// Public responses expose classified status only, so raw values never reach visitors without source and timestamp.
const publicSite=(s,db)=>({crowd:db&&s.provenance?.kind==='demo'?publicCrowd(crowdFor(db,s.id)):null,id:s.id,name:s.name,nameSource:s.nameSource||null,city:s.city||null,area:s.area,address:s.address||null,siteType:s.siteType||null,coordinates:s.coordinates||null,sourceLink:s.sourceLink||null,provenance:s.provenance||null,icon:s.icon,description:s.description||null,facilities:s.facilities||[],hours:s.hours||null,statusInfo:classifyStatus(s)});
const PORT = Number(process.env.PORT || 4173);
const demo = process.env.DEMO_MODE !== 'false';
const publicRoot=process.cwd();
const opsSessions=new Map(),loginAttempts=new Map();
const sessionMaxAge=8*60*60*1000;
const credentialsConfigured=()=>Boolean(process.env.OPS_USERNAME&&process.env.OPS_PASSWORD&&process.env.OPS_PASSWORD.length>=12);
function sessionFor(req){const raw=(req.headers.cookie||'').match(/(?:^|;\s*)visarjanops_ops=([^;]+)/)?.[1];if(!raw)return null;let token;try{token=decodeURIComponent(raw)}catch{return null;}const key=createHash('sha256').update(token).digest('hex'),session=opsSessions.get(key);if(!session||session.expiresAt<Date.now()){opsSessions.delete(key);return null;}return {key,...session};}
const secureEqual=(a,b)=>timingSafeEqual(createHash('sha256').update(String(a)).digest(),createHash('sha256').update(String(b)).digest());
let reservationQueue=Promise.resolve();
const exclusive=async work=>{let release;const previous=reservationQueue;reservationQueue=new Promise(r=>release=r);await previous;try{return await work();}finally{release();}};
await seed();
const send = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'content-type' }); res.end(JSON.stringify(body)); };
const body = req => new Promise((resolve,reject)=>{let s='';req.on('data',c=>{s+=c;if(s.length>12000)reject(new Error('Request too large'));});req.on('end',()=>{try{resolve(s?JSON.parse(s):{});}catch{reject(new Error('Invalid JSON'));}});});
const api=http.createServer(async(req,res)=>{if(req.method==='OPTIONS'){send(res,204,{});return;}const u=new URL(req.url,'http://localhost');const path=u.pathname;
try {
 if(path==='/api/v1/operations/auth/session'&&req.method==='GET'){const session=sessionFor(req);send(res,200,{data:session?{authenticated:true,role:'operations',expiresAt:new Date(session.expiresAt).toISOString()}:{authenticated:false,loginConfigured:credentialsConfigured()}});return;}
 if(path==='/api/v1/operations/auth/login'&&req.method==='POST'){const ip=req.socket.remoteAddress||'local',now=Date.now(),attempt=loginAttempts.get(ip)||{count:0,until:now+5*60*1000};if(attempt.until<now){attempt.count=0;attempt.until=now+5*60*1000;}if(attempt.count>=5){send(res,429,{error:'Too many sign-in attempts. Wait a few minutes and try again.'});return;}if(!credentialsConfigured()){send(res,503,{error:'Operations sign-in is not configured. Set OPS_USERNAME and OPS_PASSWORD (at least 12 characters) before starting the server.'});return;}const x=await body(req);if(!secureEqual(x.username||'',process.env.OPS_USERNAME)||!secureEqual(x.password||'',process.env.OPS_PASSWORD)){attempt.count++;loginAttempts.set(ip,attempt);send(res,401,{error:'The username or password is incorrect.'});return;}loginAttempts.delete(ip);const token=randomBytes(32).toString('base64url'),key=createHash('sha256').update(token).digest('hex'),expiresAt=now+sessionMaxAge;opsSessions.set(key,{role:'operations',expiresAt});const secure=process.env.NODE_ENV==='production'?'; Secure':'';res.setHeader('Set-Cookie',`visarjanops_ops=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${sessionMaxAge/1000}${secure}`);send(res,200,{data:{role:'operations',expiresAt:new Date(expiresAt).toISOString()}});return;}
 if(path==='/api/v1/operations/auth/logout'&&req.method==='POST'){const session=sessionFor(req);if(session)opsSessions.delete(session.key);res.setHeader('Set-Cookie','visarjanops_ops=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');send(res,200,{data:{loggedOut:true}});return;}
 if(path==='/api/v1/operations/sites'&&req.method==='GET'){if(!sessionFor(req)){send(res,401,{error:'Operations sign-in required.'});return;}const db=await read();send(res,200,{data:db.sites.map(s=>({...s,statusInfo:classifyStatus(s),crowd:s.provenance?.kind==='demo'?crowdFor(db,s.id):null})),statusSource:{name:statusSource.name,connected:statusSource.connected},sources:officialSources(),features:{flags:await getFlags(),flagsmith:flagStatus(),voice:sarvamStatus()}});return;}
 if(path==='/api/v1/operations/checkin'&&req.method==='POST'){
  if(!sessionFor(req)){send(res,401,{error:'Operations sign-in required.'});return;}
  if(!(await isEnabled('ops_status_updates'))){send(res,403,{error:'Gate check-in is turned off (feature flag ops_status_updates).'});return;}
  if(limited(req,'scan',120,60*1000)){send(res,429,{error:'Too many scans. Wait a moment.'});return;}
  const x=await body(req);
  const parsed=String(x.payload||'').trim().match(/^VJ1\|(VJ-[0-9A-F]{8})\|([0-9A-F]{10})$/);
  const reference=parsed?parsed[1]:String(x.reference||'').trim().toUpperCase(),code=parsed?parsed[2]:String(x.code||'').toUpperCase().replace(/[^0-9A-F]/g,'');
  if(!/^VJ-[0-9A-F]{8}$/.test(reference)||code.length!==10){send(res,400,{error:'That is not a VisarjanOps pass. Scan the QR or type the booking reference and 10-character code.'});return;}
  if(!['auto','entry','exit'].includes(x.action||'auto')){send(res,400,{error:'Invalid action.'});return;}
  const result=await exclusive(async()=>{
   const db=await read(),b=db.bookings.find(y=>y.reference===reference);
   if(!b||!db.passSecret||!secureEqual(code,passCodeFor(db,reference)))return {status:404,error:'Pass not recognised. Check the code and try again.'};
   const site=db.sites.find(y=>y.id===b.siteId);
   if(x.siteId&&x.siteId!==b.siteId)return {status:409,error:`This pass is for ${site?.name||'another site'}, not this gate.`};
   const state=b.visitStatus||'booked',action=(x.action||'auto')==='auto'?(state==='booked'?'entry':state==='on-site'?'exit':'used'):x.action;
   if(action==='used')return {status:409,error:'This pass has already been used for entry and exit.'};
   if(action==='entry'&&state!=='booked')return {status:409,error:'This group is already checked in.'};
   if(action==='exit'&&state!=='on-site')return {status:409,error:'This group has not checked in yet.'};
   const now=new Date().toISOString();
   if(action==='entry')Object.assign(b,{visitStatus:'on-site',checkedIn:true,checkedInAt:now});else Object.assign(b,{visitStatus:'exited',exitedAt:now});
   db.siteScans={...(db.siteScans||{}),[b.siteId]:now};
   await write(db);
   return {data:{action,reference:b.reference,people:b.people,slot:b.slot,siteId:b.siteId,siteName:site?.name,visitStatus:b.visitStatus,crowd:crowdFor(db,b.siteId)}};
  });
  if(result.error){send(res,result.status,{error:result.error});return;}
  send(res,200,{data:result.data});return;
 }
 const statusRoute=path.match(/^\/api\/v1\/operations\/sites\/([^/]+)\/status$/);
 if(statusRoute&&req.method==='POST'){
  if(!sessionFor(req)){send(res,401,{error:'Operations sign-in required.'});return;}
  if(!(await isEnabled('ops_status_updates'))){send(res,403,{error:'Staff status updates are turned off (feature flag ops_status_updates).'});return;}
  const x=await body(req);
  if(!STAFF_STATUSES.includes(x.status)){send(res,400,{error:`Status must be one of: ${STAFF_STATUSES.join(', ')}.`});return;}
  const optionalInt=(v,max)=>v===undefined||v===null||v===''?null:Number.isInteger(v)&&v>=0&&v<=max?v:NaN;
  const waiting=optionalInt(x.waiting,5000),waitMinutes=optionalInt(x.waitMinutes,600);
  if(Number.isNaN(waiting)||Number.isNaN(waitMinutes)){send(res,400,{error:'People waiting must be 0–5000 and wait time 0–600 minutes.'});return;}
  const updated=await exclusive(async()=>{const db=await read(),site=db.sites.find(s=>s.id===statusRoute[1]);if(!site)return null;Object.assign(site,{status:x.status,waiting,wait:waitMinutes===null?null:`~${waitMinutes} min`,statusSource:{kind:'staff-update',source:'VisarjanOps site staff',observedAt:new Date().toISOString()}});await write(db);return site;});
  if(!updated){send(res,404,{error:'Site not found.'});return;}
  send(res,200,{data:{...updated,statusInfo:classifyStatus(updated)}});return;
 }
 if(path==='/api/v1/operations/apify/status'&&req.method==='GET'){if(!sessionFor(req)){send(res,401,{error:'Operations sign-in required.'});return;}const db=await read(),status=getApifyStatus();send(res,200,{data:{...status,importEnabled:await isEnabled('apify_import'),latestImport:db.apifyImports?.[0]||null}});return;}
 if(path==='/api/v1/operations/apify/run'&&req.method==='POST'){
  if(!sessionFor(req)){send(res,401,{error:'Operations sign-in required.'});return;}
  if(!(await isEnabled('apify_import'))){send(res,403,{error:'Apify import is turned off (feature flag apify_import).'});return;}
  try{
   const items=await runConfiguredApifyActor(),status=getApifyStatus();
   const latestImport={id:randomUUID(),actorId:status.actorId,importedAt:new Date().toISOString(),reviewStatus:'pending-review',itemCount:items.length,items};
   await exclusive(async()=>{const db=await read();db.apifyImports=[latestImport,...(db.apifyImports||[])].slice(0,3);await write(db);});
   send(res,200,{data:latestImport});
  }catch(e){send(res,e.statusCode||502,{error:e.message||'The Apify import failed.'});}
  return;
 }
 if(path==='/api/v1/public/features'&&req.method==='GET'){const f=await getFlags();send(res,200,{data:{nearbyDiscovery:f.nearby_discovery,mapView:f.map_view,voiceAssistance:f.voice_assistance&&sarvamStatus().enabled}});return;}
 if(path==='/api/v1/public/voice/search'&&req.method==='POST'){
  if(!sameOrigin(req)){send(res,403,{error:'Voice requests must come from this site.'});return;}
  if(!(await isEnabled('voice_assistance'))||!sarvamStatus().enabled){send(res,503,{error:'Voice assistance is turned off. Please search by typing.'});return;}
  if(limited(req,'voice',10,10*60*1000)){send(res,429,{error:'Too many voice requests. Try again in a few minutes.'});return;}
  const type=String(req.headers['content-type']||'').split(';')[0].trim();
  if(!/^audio\/(webm|ogg|mp4|mpeg|wav|x-wav|aac)$/.test(type)){send(res,415,{error:'Unsupported audio format.'});return;}
  const audio=await readRaw(req,800_000);
  if(audio.length<4000){send(res,400,{error:'The recording was too short or silent. Tap the button and speak again.'});return;}
  const db=await read();
  const areas=[...new Set(db.sites.map(s=>String(s.area||'').replace(/,\s*(Mumbai|Pune|Bengaluru)$/,'')).filter(a=>a&&!['Mumbai','Pune','Bengaluru'].includes(a)))];
  try{const heard=await transcribe(audio,type,[...new Set([...areas,...LOCALITIES])]);const match=interpretQuery(heard.transcript,db.sites,areas);if(match.kind==='locality'){const centre=await localityCentre(match.name);if(centre)Object.assign(match,centre);}send(res,200,{data:{...heard,match}});}
  catch(e){send(res,e.statusCode||502,{error:e.message});}
  return;
 }
 if(path==='/api/v1/public/voice/speak'&&req.method==='POST'){
  if(!sameOrigin(req)){send(res,403,{error:'Voice requests must come from this site.'});return;}
  if(!(await isEnabled('voice_assistance'))||!sarvamStatus().enabled){send(res,503,{error:'Voice assistance is turned off.'});return;}
  if(limited(req,'speak',10,10*60*1000)){send(res,429,{error:'Too many voice requests. Try again in a few minutes.'});return;}
  const x=await body(req);
  if(!VOICE_LANGUAGES.includes(x.language)||!Array.isArray(x.items)||x.items.length>3){send(res,400,{error:'Invalid voice request.'});return;}
  const db=await read();
  const items=x.items.map(i=>{const site=db.sites.find(s=>s.id===i?.id);const meters=Number.isInteger(i?.meters)&&i.meters>=0&&i.meters<=200000?i.meters:null;return site?{site,meters,statusInfo:classifyStatus(site)}:null}).filter(Boolean);
  try{send(res,200,{data:await speak(summarise(items,x.language),x.language)});}
  catch(e){send(res,e.statusCode||502,{error:e.message});}
  return;
 }
 if(path==='/api/v1/health'&&req.method==='GET'){
  const token=process.env.OPS_MONITOR_TOKEN||'',auth=String(req.headers.authorization||'');
  if(!sessionFor(req)&&!(token.length>=24&&auth.startsWith('Bearer ')&&secureEqual(auth.slice(7),token))){send(res,401,{error:'Monitoring authorization required.'});return;}
  let storeOk=true,siteCount=0;try{siteCount=(await read()).sites.length;}catch{storeOk=false;}
  const flags=flagStatus(),voice=sarvamStatus();
  send(res,storeOk?200:503,{data:{status:storeOk?'ok':'degraded',service:'visarjanops',uptimeSeconds:Math.round((Date.now()-startedAt)/1000),checkedAt:new Date().toISOString(),store:{ok:storeOk,sites:siteCount},flags:{mode:flags.mode,lastLoadedAt:flags.lastLoadedAt,healthy:!flags.lastError},voice:{enabled:voice.enabled,usedToday:voice.usedToday,dailyLimit:voice.dailyLimit},liveStatusFeed:{connected:statusSource.connected}}});
  return;
 }
 if(path==='/api/v1/public/sites'&&req.method==='GET'){const db=await read();let sites=db.sites;const q=(u.searchParams.get('q')||'').trim().toLowerCase().slice(0,100);if(q)sites=sites.filter(s=>`${s.name} ${s.area} ${s.city||''}`.toLowerCase().includes(q));send(res,200,{data:sites.map(x=>publicSite(x,db))});return;}
 let m=path.match(/^\/api\/v1\/public\/sites\/([^/]+)$/);if(m&&req.method==='GET'){const db=await read(),site=db.sites.find(x=>x.id===m[1]);send(res,site?200:404,{data:site?publicSite(site,db):null});return;}
 m=path.match(/^\/api\/v1\/public\/bookings\/([^/]+)$/);if(m&&req.method==='GET'){const db=await read(),b=db.bookings.find(x=>x.reference===m[1]&&x.secretHash===createHash('sha256').update(u.searchParams.get('key')||'').digest('hex'));send(res,b?200:404,{data:b?publicBooking(b,db):null});return;}
 if(path==='/api/v1/public/bookings'&&req.method==='POST'){const x=await body(req);if(!x.siteId||!x.slot||!x.name||!/^\S+@\S+\.\S+$/.test(x.email||'')||!Number.isInteger(x.people)||x.people<1||x.people>12){send(res,400,{error:'Check the required details and group size (1–12).'});return;}const result=await exclusive(async()=>{const db=await read(),site=db.sites.find(s=>s.id===x.siteId);if(site&&site.provenance?.kind!=='demo')return {error:'Arrival bookings are not available for municipal sites. Follow the site’s on-ground arrangements.'};if(!site||site.status==='Paused')return {error:'This site is currently unavailable.'};const slot=db.slots.find(s=>s.siteId===x.siteId&&s.time===x.slot);if(!slot||slot.booked+x.people>slot.capacity)return {error:'Those spaces have just been taken. Choose another time.'};slot.booked+=x.people;db.passSecret||=randomBytes(32).toString('hex');const key=randomBytes(24).toString('base64url'),reference=`VJ-${randomBytes(4).toString('hex').toUpperCase()}`;const booking={id:randomUUID(),reference,secretHash:createHash('sha256').update(key).digest('hex'),siteId:x.siteId,slot:x.slot,people:x.people,name:x.name,email:x.email,createdAt:new Date().toISOString(),status:'Confirmed',checkedIn:false,visitStatus:'booked',checkedInAt:null,exitedAt:null,requests:[]};db.bookings.push(booking);await write(db);return {...publicBooking(booking,db),recoveryKey:key,passCode:passCodeFor(db,reference)};});if(result.error){send(res,409,{error:result.error});return;}send(res,201,{data:result});return;}
 m=path.match(/^\/api\/v1\/public\/assistance-requests$/);if(m&&req.method==='POST'){const x=await body(req);if(!x.bookingReference||!x.category){send(res,400,{error:'Booking and assistance type are required.'});return;}const db=await read(),b=db.bookings.find(y=>y.reference===x.bookingReference);if(!b){send(res,404,{error:'Booking not found.'});return;}const request={reference:`HELP-${randomBytes(3).toString('hex').toUpperCase()}`,category:x.category,note:String(x.note||'').slice(0,300),status:'Received',createdAt:new Date().toISOString()};b.requests.push(request);await write(db);send(res,201,{data:request});return;}
 m=path.match(/^\/api\/v1\/public\/assistance-requests\/([^/]+)$/);if(m&&req.method==='GET'){const db=await read(),r=db.bookings.flatMap(b=>b.requests||[]).find(x=>x.reference===m[1]);send(res,r?200:404,{data:r||null});return;}
 m=path.match(/^\/api\/v1\/public\/bookings\/([^/]+)\/pass$/);if(m&&req.method==='GET'){const key=u.searchParams.get('key')||'',db=await read(),b=db.bookings.find(x=>x.reference===m[1]&&x.secretHash===createHash('sha256').update(key).digest('hex'));if(!b){send(res,404,{data:null});return;}const code=passCodeFor(db,b.reference),qrPayload=`VJ1|${b.reference}|${code}`,site=db.sites.find(x=>x.id===b.siteId);send(res,200,{data:{reference:b.reference,siteName:site?.name,slot:b.slot,people:b.people,visitStatus:b.visitStatus||'booked',checkedInAt:b.checkedInAt||null,exitedAt:b.exitedAt||null,passCode:formatCode(code),qrPayload,qrSvg:await QRCode.toString(qrPayload,{type:'svg',errorCorrectionLevel:'M',margin:1,color:{dark:'#1D2A3A',light:'#FFFFFF'}})}});return;}
 if(path==='/api/v1/public/feedback'&&req.method==='POST'){const x=await body(req);const db=await read();db.feedback.push({...x,id:randomUUID(),createdAt:new Date().toISOString()});await write(db);send(res,201,{data:{received:true}});return;}
 if(path==='/api/v1/public/demo/reset'&&req.method==='POST'&&demo){await seed(true);send(res,200,{data:{reset:true}});return;}
 if(path==='/api/v1/public/live'&&req.method==='GET'){res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache','access-control-allow-origin':'*'});const pulse=async()=>{if(res.destroyed)return;const db=await read();res.write(`data: ${JSON.stringify({sites:db.sites.map(s=>({id:s.id,statusInfo:classifyStatus(s),crowd:s.provenance?.kind==='demo'?publicCrowd(crowdFor(db,s.id)):null}))})}\n\n`);};await pulse();const t=setInterval(pulse,15000);req.on('close',()=>clearInterval(t));return;}
 if(req.method==='GET'){const assets={'/':'index.html','/index.html':'index.html','/src.js':'src.js','/styles.css':'styles.css','/assets/ganesh-logo.jpg':'public/assets/ganesh-logo.jpg','/vendor/maplibre-gl.mjs':'public/vendor/maplibre-gl.mjs','/vendor/maplibre-gl-worker.mjs':'public/vendor/maplibre-gl-worker.mjs','/vendor/maplibre-gl.css':'public/vendor/maplibre-gl.css','/vendor/jsQR.js':'public/vendor/jsQR.js','/vendor/three.module.js':'public/vendor/three.module.js','/vendor/three.core.js':'public/vendor/three.core.js'},name=assets[path];if(name){const target=join(publicRoot,name);try{if((await stat(target)).isFile()){const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.jpg':'image/jpeg'};res.writeHead(200,{'content-type':types[extname(target)]||'application/octet-stream','x-content-type-options':'nosniff','cache-control':'no-cache'});createReadStream(target).pipe(res);return;}}catch{}}}
 send(res,404,{error:'Route not found'});
} catch(e){send(res,500,{error:e.message||'Request failed'});}});
api.listen(PORT,'127.0.0.1',()=>console.log(`VisarjanOps API and web app: http://localhost:${PORT}`));
// Check-in codes are derived (HMAC) from the booking reference, so they can be re-shown with the recovery key but never stored in plain text.
function passCodeFor(db,reference){const secret=process.env.PASS_SIGNING_SECRET||db.passSecret||'';return createHmac('sha256',secret).update(reference).digest('hex').slice(0,10).toUpperCase();}
const formatCode=c=>`${c.slice(0,5)}-${c.slice(5)}`;
// Crowd at a bookable site, from bookings and gate scans only: expected = booked but not arrived; on site = scanned in, not out.
function crowdFor(db,siteId){const out={expected:0,onSite:0,completed:0,groupsOnSite:0,bySlot:{},lastScanAt:db.siteScans?.[siteId]||null};for(const b of db.bookings){if(b.siteId!==siteId||b.status!=='Confirmed')continue;const st=b.visitStatus||'booked',slot=out.bySlot[b.slot]||={expected:0,onSite:0,completed:0};const key=st==='on-site'?'onSite':st==='exited'?'completed':'expected';out[key]+=b.people;slot[key]+=b.people;if(st==='on-site')out.groupsOnSite++;}return out;}
const publicCrowd=c=>({onSite:c.onSite,expected:c.expected,lastScanAt:c.lastScanAt,source:'Gate check-ins and bookings (estimate)'});
function publicBooking(b,db){const s=db.sites.find(x=>x.id===b.siteId);const {secretHash,...safe}=b;return {...safe,siteName:s?.name,siteArea:s?.area};}
// Voice endpoints spend Sarvam credits, so they reject cross-site requests despite the API's permissive CORS header.
function sameOrigin(req){const origin=req.headers.origin;if(!origin)return true;try{const o=new URL(origin);return ['localhost','127.0.0.1'].includes(o.hostname)&&Number(o.port||80)===PORT;}catch{return false;}}
const hits=new Map();
function limited(req,bucket,max,windowMs){const key=`${bucket}:${req.socket.remoteAddress}`,now=Date.now();let h=hits.get(key);if(!h||h.until<now){h={count:0,until:now+windowMs};hits.set(key,h);}h.count++;if(hits.size>5000)for(const [k,v] of hits)if(v.until<now)hits.delete(k);return h.count>max;}
function readRaw(req,max){return new Promise((resolve,reject)=>{const chunks=[];let size=0;req.on('data',c=>{size+=c.length;if(size>max){reject(Object.assign(new Error('Recording too long. Keep it under 30 seconds.'),{statusCode:413}));req.destroy();return;}chunks.push(c);});req.on('end',()=>resolve(Buffer.concat(chunks)));req.on('error',reject);});}
// Maps an English transcript to a known area, locality or site name; nothing else is inferred.
const LOCALITIES=['Colaba','Cuffe Parade','Fort','Marine Lines','Girgaon','Chowpatty','Malabar Hill','Grant Road','Tardeo','Mumbai Central','Byculla','Mazgaon','Dongri','Kalbadevi','Bhuleshwar','Charni Road','Nagpada','Agripada','Mahalaxmi','Lalbaug','Sewri','Naigaon','Lower Parel','Parel','Worli','Prabhadevi','Dadar','Mahim','Matunga','Sion','Antop Hill','Wadala','Dharavi','Bandra','Khar','Kalina','Santacruz','Vile Parle','Juhu','Andheri','Jogeshwari','Goregaon','Malad','Kandivali','Charkop','Borivali','Dahisar','Gorai','Kurla','Chembur','Ghatkopar','Vikhroli','Kanjurmarg','Powai','Bhandup','Mulund','Govandi','Mankhurd','Deonar','Trombay','Chandivali','Saki Naka','Versova','Oshiwara'];
const GENERIC=new Set(['road','marg','ground','garden','near','mumbai','maidan','opposite','lake','pond','ponds','tank','tanks','talav','visarjan','immersion','site','sites','show','artificial','nearby','nearest','please','where','find','place','places','ganesh','ganpati','udyan','park','school','municipal','west','east','north','south','nagar','chowk']);
function interpretQuery(transcript,sites,areas){
 const norm=t=>` ${String(t).toLowerCase().replace(/[^a-z0-9\s]/g,' ').replace(/\s+/g,' ').trim()} `;
 const text=norm(transcript);
 if(!text.trim())return {kind:'none'};
 const area=[...areas].sort((a,b)=>b.length-a.length).find(a=>text.includes(norm(a)));
 if(area)return {kind:'area',area};
 const locality=[...LOCALITIES].sort((a,b)=>b.length-a.length).find(l=>text.includes(norm(l)));
 if(locality)return {kind:'locality',name:locality};
 const words=t=>norm(t).trim().split(' ').filter(w=>w.length>3&&!GENERIC.has(w));
 let best=null,bestScore=0;
 for(const s of sites){const hits=words(s.name).filter(w=>text.includes(` ${w} `));const score=hits.length+(hits.some(w=>w.length>=6)?0.5:0);if(score>bestScore){best=s;bestScore=score;}}
 if(best&&bestScore>=1.5)return {kind:'site',id:best.id,name:best.name};
 if(/\b(near me|nearby|closest|nearest|around me|my location)\b/.test(text))return {kind:'near-me'};
 return {kind:'none'};
}
// Locality centres come from OpenStreetMap Nominatim (free; usage policy: ≤1 request/second, identifying User-Agent, cache results).
// Only the locality name is sent, bounded to Mumbai; results are cached for the life of the process.
const geocodeCache=new Map();let lastGeocodeAt=0;
async function localityCentre(name){
 if(geocodeCache.has(name))return geocodeCache.get(name);
 const wait=lastGeocodeAt+1100-Date.now();if(wait>0)await new Promise(r=>setTimeout(r,wait));lastGeocodeAt=Date.now();
 let centre=null;
 try{const q=new URLSearchParams({q:`${name}, Mumbai`,format:'jsonv2',limit:'1',countrycodes:'in',viewbox:'72.75,19.35,73.05,18.85',bounded:'1'});const r=await fetch(`https://nominatim.openstreetmap.org/search?${q}`,{headers:{'user-agent':'VisarjanOps/0.1 (+https://github.com/mrunalsj/visarjanops_wearedevelopers)'},signal:AbortSignal.timeout(6000)});if(r.ok){const [hit]=await r.json();if(hit)centre={lat:+hit.lat,lng:+hit.lon,source:'OpenStreetMap Nominatim'};}}catch{}
 geocodeCache.set(name,centre);return centre;
}
