import test from 'node:test';
import assert from 'node:assert/strict';
import { createPtzController } from '../artifacts/api-server/src/lib/reolink-ptz.ts';
const target={host:'nvr',port:80,username:'admin',password:'do-not-expose',channel:1};
function fixture(options={}) {
 const calls=[]; let pan=100; let position=options.position ?? 16;
 const request=async(url,init)=>{
  const body=JSON.parse(init.body)[0];calls.push(body);
  let value={rspCode:200}; let range;
  if(body.cmd==='Login')value={Token:{name:'test-token'}};
  if(body.cmd==='GetAbility')value={Ability:{abilityChn:[{}, {ptzType:{ver:options.fixed?0:3}, supportPtzSpeed:{ver:1},supportDigitalZoom:{ver:options.fixed?0:1},supportAutoTrackStream:{ver:1}}]}};
  if(body.cmd==='GetZoomFocus'){value={ZoomFocus:{channel:1,zoom:{pos:position}}};range={ZoomFocus:{zoom:{pos:{min:0,max:32}}}};}
  if(body.cmd==='GetPtzCurPos' && !options.noPosition) value={PtzCurPos:{channel:1,Ppos:pan,Tpos:50}};
  if(body.cmd==='PtzCtrl' && body.param.op!=='Stop' && options.moved)pan+=10;
  if(body.cmd==='StartZoomFocus')position=body.param.ZoomFocus.pos;
  if(body.cmd==='PtzCtrl' && body.param.op!=='Stop' && options.moveFailure) throw new Error('ambiguous network timeout '+target.password);
  if(body.cmd==='PtzCtrl' && body.param.op==='Stop' && options.stopFailure) return Response.json([{code:1,error:{rspCode:-3,detail:target.password}}]);
  if(options.hook) await options.hook(body);
  return Response.json([{cmd:body.cmd,code:0,value,range}]);
 };
 return {calls,request};
}
test('TrackMix capability discovery and camera channel index',async()=>{
 const f=fixture();const ptz=createPtzController(f.request);
 const c=await ptz.capabilities(target);
 assert.equal(c.pan,true);assert.equal(c.tilt,true);assert.equal(c.telephoto,true);
 assert.deepEqual(c.zoom,{min:0,max:32,position:16});
 assert.equal(f.calls.at(-1).cmd,'Logout');
 assert.ok(!JSON.stringify(c).includes('do-not-expose'));
});
test('one tap sends bounded movement, then Stop before Logout',async()=>{
 const f=fixture();const waits=[];const ptz=createPtzController(f.request, async ms=>waits.push(ms));
 await ptz.command(target,'LeftUp',8);
 const moves=f.calls.filter(c=>c.cmd==='PtzCtrl');
 assert.deepEqual(moves.map(c=>c.param),[{channel:1,op:'LeftUp',speed:8},{channel:1,op:'Stop'}]);
 assert.deepEqual(waits,[1000]);assert.equal(f.calls.at(-1).cmd,'Logout');
});
test('ambiguous move failure still stops and logs out, without leaking device details',async()=>{
 const f=fixture({moveFailure:true});const ptz=createPtzController(f.request,async()=>{});
 await assert.rejects(ptz.command(target,'Right'),e=>!e.message.includes(target.password));
 assert.equal(f.calls.at(-2).param.op,'Stop');assert.equal(f.calls.at(-1).cmd,'Logout');
});
test('Stop retries and failure is visible rather than claiming success',async()=>{
 const f=fixture({stopFailure:true});const ptz=createPtzController(f.request,async()=>{});
 await assert.rejects(ptz.command(target,'Up'),/STOP non confermato/);
 assert.equal(f.calls.filter(c=>c.cmd==='PtzCtrl'&&c.param.op==='Stop').length,3);
 assert.equal(f.calls.at(-1).cmd,'Logout');
});
test('zoom reads actual range and clamps the absolute position',async()=>{
 const f=fixture({position:31});const ptz=createPtzController(f.request,async()=>{});
 await ptz.command(target,'ZoomIn');await ptz.command(target,'ZoomOut');
 assert.deepEqual(f.calls.filter(c=>c.cmd==='StartZoomFocus').map(c=>c.param.ZoomFocus),[
  {channel:1,op:'ZoomPos',pos:32},{channel:1,op:'ZoomPos',pos:29}]);
});
test('concurrent moves are rejected, while Stop interrupts the active movement',async()=>{
 const f=fixture();let release;let reached;
 const started=new Promise(r=>reached=r);
 const ptz=createPtzController(f.request,async()=>{reached();await new Promise(r=>release=r);});
 const move=ptz.command(target,'Down');await started;
 await assert.rejects(ptz.command(target,'Right'),e=>e.status===409);
 await ptz.command(target,'Stop');
 assert.equal(f.calls.at(-1).param.op,'Stop');
 release();await move;assert.equal(f.calls.at(-1).cmd,'Logout');
});
test('Stop during login prevents delayed movement',async()=>{
 let release;let reached;const started=new Promise(r=>reached=r);
 const f=fixture({hook:async body=>{if(body.cmd==='Login'){reached();await new Promise(r=>release=r);}}});
 const ptz=createPtzController(f.request,async()=>{});const move=ptz.command(target,'Left');await started;
 await ptz.command(target,'Stop');release();await move;
 assert.equal(f.calls.filter(c=>c.cmd==='PtzCtrl'&&c.param.op!=='Stop').length,0);
});
test('invalid commands and speed never reach the device; fixed camera refuses movement',async()=>{
 const f=fixture({fixed:true});const ptz=createPtzController(f.request,async()=>{});
 await assert.rejects(ptz.command(target,'Reboot'),e=>e.status===400);
 await assert.rejects(ptz.command(target,'Left',99),e=>e.status===400);
 assert.equal(f.calls.length,0);
 await assert.rejects(ptz.command(target,'Left'),e=>e.status===422);
 assert.equal(f.calls.filter(c=>c.cmd==='PtzCtrl').length,0);
});

// TrackMix telephoto must not accidentally point back at the panoramic stream.
import { cameraRtspUrls } from '../artifacts/api-server/src/lib/camera-source.ts';
test('telephoto URLs use the actual one-based NVR channel and encoded credentials',()=>{
 const urls=cameraRtspUrls({channel:2},{host:'nvr',username:'a@b',password:'a:b',rtspPort:554},'autotrack');
 assert.equal(urls[0],'rtsp://a%40b:a%3Ab@nvr:554/Preview_02_autotrack');
 assert.ok(urls.every(url=>url.endsWith('_autotrack')));
});

test('position feedback distinguishes changed, unchanged and unavailable',async()=>{
 for (const [options,expected] of [[{moved:true},'changed'],[{},'unchanged'],[{noPosition:true},'unverified']]) {
  const f=fixture(options);const ptz=createPtzController(f.request,async()=>{});
  const result=await ptz.command(target,'Left');
  assert.equal(result.movement,expected);assert.equal(result.channel,2);
  const lastRead=f.calls.findLastIndex(c=>c.cmd==='GetPtzCurPos');
  assert.ok(f.calls.findIndex(c=>c.cmd==='PtzCtrl'&&c.param.op==='Stop')<lastRead);
 }
});
test('bounded durations are validated before contacting NVR',async()=>{
 const f=fixture();const waits=[];const ptz=createPtzController(f.request,async ms=>waits.push(ms));
 await assert.rejects(ptz.command(target,'Left',16,60000),e=>e.status===400);
 assert.equal(f.calls.length,0);
 await ptz.command(target,'Left',16,2000);assert.deepEqual(waits,[2000]);
});
test('Stop during position lookup cancels queued movement',async()=>{
 let release;let reached;const started=new Promise(r=>reached=r);
 const f=fixture({hook:async body=>{if(body.cmd==='GetPtzCurPos'){reached();await new Promise(r=>release=r);}}});
 const ptz=createPtzController(f.request,async()=>{});const move=ptz.command(target,'Left');await started;
 await ptz.command(target,'Stop');release();await move;
 assert.equal(f.calls.filter(c=>c.cmd==='PtzCtrl'&&c.param.op!=='Stop').length,0);
});
