import test from 'node:test';
import assert from 'node:assert/strict';
import { createReolinkLogin } from '../artifacts/api-server/src/lib/reolink-login.ts';

const json = value => Response.json(value);
const success = [{code: 0, value: {Token: {name: 'test-token', leaseTime: 3600}}}];

test('concurrent save/sync/poll share one probe and close its token', async () => {
  const calls = [];
  const login = createReolinkLogin(async (url, options) => {
    calls.push({url, body: JSON.parse(options.body)});
    return json(url.includes('cmd=Login') ? success : [{code: 0}]);
  });
  const results = await Promise.all(Array.from({length: 20}, () => login('nvr', 80, 'admin', 'secret')));
  assert.ok(results.every(r => r.online));
  assert.equal(calls.length, 2);
  assert.ok(calls[1].url.endsWith('cmd=Logout&token=test-token'));
  assert.equal(calls[1].body[0].cmd, 'Logout');
});

test('repeated polling does not accumulate sessions', async () => {
  let clock = 0, active = 0, maxActive = 0;
  const login = createReolinkLogin(async url => {
    if (url.includes('cmd=Login')) { maxActive = Math.max(maxActive, ++active); return json(success); }
    --active; return json([{code: 0}]);
  }, () => clock);
  for (let i = 0; i < 150; ++i) {
    assert.equal((await login('nvr', 80, 'admin', 'secret')).online, true);
    clock += 30_000;
  }
  assert.equal(active, 0);
  assert.equal(maxActive, 1);
});

test('max session reports reachability and throttles retries for 60 seconds', async () => {
  let clock = 0, calls = 0;
  const login = createReolinkLogin(async () => {
    calls++; return json([{code: 1, error: {detail: 'max session', rspCode: -29}}]);
  }, () => clock);
  const r = await login('nvr', 80, 'admin', 'secret');
  assert.equal(r.online, false);
  assert.match(r.reason, /NVR raggiungibile/);
  assert.match(r.reason, /non indica una password errata/);
  clock = 59_999; await login('nvr', 80, 'admin', 'secret'); assert.equal(calls, 1);
  clock = 60_000; await login('nvr', 80, 'admin', 'secret'); assert.equal(calls, 2);
});

test('changed credentials bypass a previous failure cache', async () => {
  const users = [];
  const login = createReolinkLogin(async (url, options) => {
    if (url.includes('cmd=Logout')) return json([{code: 0}]);
    const user = JSON.parse(options.body)[0].param.User;
    users.push(user.password);
    return json(user.password === 'correct' ? success : [{code: 1, error: {detail: 'password wrong'}}]);
  });
  assert.equal((await login('nvr', 80, 'admin', 'wrong')).online, false);
  assert.equal((await login('nvr', 80, 'admin', 'correct')).online, true);
  assert.deepEqual(users, ['wrong', 'correct']);
});

test('logout failure stays observable and slows further logins', async () => {
  let calls = 0, clock = 0;
  const login = createReolinkLogin(async url => {
    calls++;
    if (url.includes('cmd=Logout')) throw new Error('timeout');
    return json(success);
  }, () => clock);
  const result = await login('nvr', 80, 'admin', 'secret');
  assert.equal(result.online, true);
  assert.match(result.reason, /chiusura.*non è stata confermata/);
  clock = 30_000; await login('nvr', 80, 'admin', 'secret'); assert.equal(calls, 2);
});

test('network and malformed response errors do not claim a credential failure', async () => {
  for (const request of [async () => { throw Object.assign(new Error(), {code: 'ECONNREFUSED'}); }, async () => new Response('not JSON')]) {
    const result = await createReolinkLogin(request)('nvr', 80, 'admin', 'secret');
    assert.equal(result.online, false);
    assert.doesNotMatch(result.reason, /password|credenziali/);
  }
});


test('discovers actual channels, advertised RTSP paths and port without retaining credentials', async () => {
  const commands = [];
  const login = createReolinkLogin(async (url, options) => {
    const body = JSON.parse(options.body);
    commands.push(...body.map(item => item.cmd));
    if (url.includes('cmd=Login')) return json(success);
    if (url.includes('cmd=Logout')) return json([{code:0}]);
    if (body[0].cmd === 'GetChannelstatus') return json([
      {cmd:'GetChannelstatus',code:0,value:{status:[{channel:0,name:'Front',online:1},{channel:1,name:'Empty',online:0}]}},
      {cmd:'GetNetPort',code:0,value:{NetPort:{rtspPort:8554}}},
    ]);
    return json([{cmd:'GetRtspUrl',code:0,value:{rtspUrl:{channel:0,mainStream:'rtsp://admin:secret@device:8554/Preview_01_main',subStream:'rtsp://admin:secret@device:8554/Preview_01_sub'}}}]);
  }, Date.now, true);
  const result = await login('nvr',80,'admin','secret');
  assert.equal(result.rtspPort,8554);
  assert.equal(result.channels.length,2);
  assert.equal(result.channels[0].mainPath,'/Preview_01_main');
  assert.equal(result.channels[1].online,false);
  assert.ok(!JSON.stringify(result).includes('secret'));
  assert.deepEqual(commands,['Login','GetChannelstatus','GetNetPort','GetRtspUrl','Logout']);
});

test('unsupported discovery commands preserve successful login and logout', async () => {
  let logout = false;
  const login = createReolinkLogin(async url => {
    if (url.includes('cmd=Login')) return json(success);
    if (url.includes('cmd=Logout')) { logout = true; return json([{code:0}]); }
    throw new Error('unsupported');
  }, Date.now, true);
  assert.equal((await login('nvr',80,'admin','secret')).online,true);
  assert.ok(logout);
});
