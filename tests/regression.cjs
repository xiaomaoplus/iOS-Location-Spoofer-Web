const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const zlib = require('node:zlib');
const { webcrypto } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'location-spoofer.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const api = require('../location-spoofer.js');
const { concatBytes: concat, makeVarintField: v, makeLengthDelimitedField: m } = api;
const target = { latitude: -33.86, longitude: 0, horizontalAccuracy: 20 };
const record = concat([v(1, 123456789), v(2, 234567890), v(3, 40), v(7, 555)]);
const payload = concat([m(2, m(2, record)), m(22, m(5, record)), v(33, 123)]);
const suffix = Uint8Array.from([255, 0, 171]);
function bytes(value) { return Buffer.from(value); }
function runtime(options = {}) {
  const results = [], logs = [];
  const context = {
    Uint8Array, ArrayBuffer, console: { log: s => logs.push(s) },
    $argument: 'latitude=-33.86&longitude=0',
    $response: { status: 200, headers: {}, body: payload },
    $done: value => results.push(value),
    ...options
  };
  vm.runInNewContext(source, context);
  assert.equal(results.length, 1, 'must complete exactly once');
  return { value: results[0], logs };
}
function pass(result) { assert.equal(Object.keys(result.value).length, 0); }

test('deployed and root scripts match; all inline JS parses', () => {
  assert.equal(source, fs.readFileSync(path.join(root, 'public/location-spoofer.js'), 'utf8'));
  for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]);
});

for (const kind of ['bare', 'synthetic', 'arpc', 'marker']) {
  test('preserves ' + kind + ' framing, unknown fields and suffix', () => {
    let input;
    if (kind === 'bare') input = payload;
    if (kind === 'synthetic') input = concat([api.buildSyntheticResponse(payload), suffix]);
    if (kind === 'arpc') input = concat([api.ArpcCodec.serialize({
      version: 1, locale: 'zh_CN', appIdentifier: 'com.apple.locationd',
      osVersion: 'test', functionId: 7, payload
    }), suffix]);
    if (kind === 'marker') input = concat([Uint8Array.from([255, 251, 201]),
      api.APPLE_MARKER_SIGNATURE, api.ArpcCodec.writeUInt16BE(payload.length), payload, suffix]);
    const original = api.extractEnvelope(input);
    assert.equal(original.kind, kind);
    const output = api.spoofAppleResponse(input, target);
    assert.equal(output.kind, kind);
    assert.equal(output.wifiCount, 1);
    assert.equal(output.cellCount, 1);
    const decoded = api.extractEnvelope(output.response);
    assert.equal(decoded.kind, kind);
    if (kind !== 'bare') assert.deepEqual(bytes(output.response.slice(-3)), bytes(suffix));
    if (kind === 'arpc') assert.deepEqual(bytes(decoded.arpc.headerPrefix), bytes(original.arpc.headerPrefix));
    if (kind === 'synthetic' || kind === 'marker') assert.deepEqual(bytes(decoded.prefix), bytes(original.prefix));
    const fields = api.parseFields(decoded.payload);
    assert.deepEqual(bytes(fields[2].raw), bytes(v(33, 123)));
    const location = api.parseFields(api.parseFields(fields[0].valueBytes)[0].valueBytes);
    assert.deepEqual(bytes(location[0].raw), bytes(v(1, api.coordToInt(target.latitude))));
    assert.deepEqual(bytes(location[1].raw), bytes(v(2, 0)));
    assert.deepEqual(bytes(location[3].raw), bytes(v(7, 555)));
    const repeated = api.spoofAppleResponse(output.response, target);
    assert.equal(repeated.wifiCount + repeated.cellCount, 0);
    assert.deepEqual(bytes(repeated.response), bytes(output.response));
  });
}

test('record without coordinates cannot report active', () => {
  const body = m(2, m(2, v(3, 4)));
  const result = api.spoofAppleResponse(body, target);
  assert.equal(result.wifiCount, 0);
  assert.deepEqual(bytes(result.response), bytes(body));
  pass(runtime({ $response: { body } }));
});

test('noncanonical length fields cannot create false coordinate changes', () => {
  const body = m(2, Uint8Array.from([0x12, 0x82, 0x00, 0x18, 0x04]));
  const result = api.spoofAppleResponse(body, target);
  assert.equal(result.wifiCount, 0);
  assert.deepEqual(bytes(result.response), bytes(body));
  pass(runtime({ $response: { body } }));
});

test('unknown framing and invalid coordinates pass through', () => {
  pass(runtime({ $response: { body: concat([Uint8Array.from([255, 255, 255]), payload]) } }));
  for (const argument of ['latitude=91', 'longitude=181', 'latitude=NaN', 'horizontalAccuracy=0', 'enabled=false', 'mode=request']) {
    pass(runtime({ $argument: argument }));
  }
  assert.throws(() => api.ArpcCodec.writeUInt16BE(65536));
});

test('success is a flat Shadowrocket result; headers normalized without mutating input', () => {
  const headers = { 'content-length': '1', 'ETag': 'old', 'TRANSFER-ENCODING': 'chunked', 'X-Keep': 'yes' };
  const { value } = runtime({ $response: { headers, body: payload } });
  assert.equal(value.headers['X-Location-Spoofer'], 'active');
  assert.equal(value.headers['X-Keep'], 'yes');
  assert.equal(value.headers['Content-Length'], String(value.body.length));
  assert.equal(value.headers.ETag, undefined);
  assert.equal(value.response, undefined);
  assert.equal(headers.ETag, 'old');
  pass(runtime({ $response: { status: 503, body: payload } }));
  pass(runtime({ $response: undefined }));
});

test('gzip decodes only with supported runtime tool; already decoded bodies work', () => {
  const response = { headers: { 'content-encoding': 'gzip' }, body: zlib.gzipSync(payload) };
  pass(runtime({ $response: response }));
  const { value } = runtime({ $response: response, $utils: { ungzip: zlib.gunzipSync } });
  assert.equal(value.headers['X-Location-Spoofer'], 'active');
  assert.equal(value.headers['content-encoding'], undefined);
  assert.equal(runtime({ $response: { ...response, body: payload } }).value.headers['X-Location-Spoofer'], 'active');
});

for (const [label, error, status, body] of [
  ['network', 'failure', 200, '{}'], ['auth', null, 401, JSON.stringify(target)],
  ['invalid JSON', null, 200, '{'], ['missing location', null, 200, '{}'],
  ['out of range', null, 200, '{"latitude":999,"longitude":0}'],
  ['wrong type', null, 200, '{"latitude":0,"longitude":"0"}']
]) {
  test('remote ' + label + ' does not fall back to Beijing', () => {
    const result = runtime({
      $argument: 'configUrl=https://example.test/loc.json?token=test-secret',
      $httpClient: { get: (_, callback) => callback(error, { status }, body) }
    });
    pass(result);
    assert(!result.logs.join('').includes('test-secret'));
  });
}

test('remote zero coordinates work and duplicate callbacks finish once', () => {
  const { value } = runtime({
    $argument: 'configUrl=https://example.test/loc.json',
    $httpClient: { get: (_, callback) => {
      callback(null, { status: 200 }, '{"latitude":0,"longitude":0}');
      callback('late failure');
    } }
  });
  assert.equal(value.headers['X-Location-Spoofer'], 'active');
});

const context = vm.createContext({ Request, Response, URL, crypto: webcrypto, console });
const modules = new Map();
async function loadModule(relative) {
  const filename = path.resolve(root, relative);
  if (modules.has(filename)) return modules.get(filename);
  const mod = new vm.SourceTextModule(fs.readFileSync(filename, 'utf8'), { context, identifier: filename });
  modules.set(filename, mod);
  await mod.link((specifier, parent) => loadModule(path.relative(root, path.resolve(path.dirname(parent.identifier), specifier))));
  await mod.evaluate();
  return mod;
}
function storage() {
  const map = new Map();
  return { map, get: async key => map.has(key) ? JSON.parse(map.get(key)) : null,
    put: async (key, value) => map.set(key, value) };
}
async function call(file, method = 'GET', data, env, token = 'test', raw = false) {
  const mod = await loadModule('functions/' + file);
  const request = new Request('https://example.test/api?token=' + encodeURIComponent(token),
    { method, ...(data === undefined ? {} : { body: raw ? data : JSON.stringify(data) }) });
  return mod.namespace['onRequest' + method[0] + method.slice(1).toLowerCase()]({
    request, env: env || { TOKEN: 'test', SPOOFER_DATA: storage() }, params: { id: 'x' }
  });
}

test('every API requires TOKEN and storage; invalid token denied', async () => {
  for (const [file, method] of [
    ['set.js', 'POST'], ['loc.json.js', 'GET'], ['verify.js', 'GET'],
    ['favorites/index.js', 'GET'], ['favorites/index.js', 'POST'],
    ['favorites/[id].js', 'DELETE'], ['ios-location-spoofer.sgmodule.js', 'GET']
  ]) {
    assert.equal((await call(file, method, undefined, {})).status, 503, file);
    assert.equal((await call(file, method, undefined, { TOKEN: 'test' })).status, 503, file);
    assert.equal((await call(file, method, undefined, { TOKEN: 'test', SPOOFER_DATA: storage() }, 'wrong')).status, 401, file);
  }
});

test('location validation, zero preservation, partial updates and storage errors', async () => {
  const kv = storage(), env = { TOKEN: 'test', SPOOFER_DATA: kv };
  assert.equal((await call('loc.json.js', 'GET', undefined, env)).status, 404);
  assert.equal((await call('set.js', 'POST', { altitude: 0 }, env)).status, 400);
  for (const data of [null, [], {}, { latitude: 91 }, { longitude: -181 }, { altitude: '0' }, { horizontalAccuracy: 0 }]) {
    assert.equal((await call('set.js', 'POST', data, env)).status, 400);
  }
  assert.equal((await call('set.js', 'POST', '{"latitude":1e999}', env, 'test', true)).status, 400);
  assert.equal((await call('set.js', 'POST', '{', env, 'test', true)).status, 400);
  const response = await call('set.js', 'POST', { latitude: 0, longitude: 0, altitude: 0 }, env);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).latitude, 0);
  assert.equal((await call('set.js', 'POST', { horizontalAccuracy: 10 }, env)).status, 200);
  assert.equal((await (await call('loc.json.js', 'GET', undefined, env)).json()).longitude, 0);
  env.SPOOFER_DATA.put = async () => { throw Error('offline'); };
  assert.equal((await call('set.js', 'POST', { latitude: 1 }, env)).status, 503);
  env.SPOOFER_DATA.get = async () => { throw Error('offline'); };
  assert.equal((await call('loc.json.js', 'GET', undefined, env)).status, 503);
});

test('favorites validate inputs and report failed writes', async () => {
  const kv = storage(), env = { TOKEN: 'test', SPOOFER_DATA: kv };
  for (const data of [null, {}, { latitude: 100, longitude: 0 }, { latitude: 0, longitude: 0, name: 123 }]) {
    assert.equal((await call('favorites/index.js', 'POST', data, env)).status, 400);
  }
  const good = await call('favorites/index.js', 'POST', { latitude: 0, longitude: 0, altitude: 0, name: 'test' }, env);
  assert.equal(good.status, 200);
  assert.equal((await good.json()).altitude, 0);
  kv.put = async () => { throw Error('offline'); };
  assert.equal((await call('favorites/index.js', 'POST', { latitude: 0, longitude: 0 }, env)).status, 503);
  assert.equal((await call('favorites/[id].js', 'DELETE', undefined, env)).status, 503);
});

test('module token is encoded literally and response cannot be cached', async () => {
  const token = '$&\n&other=true';
  const env = { TOKEN: token, SPOOFER_DATA: storage(),
    ASSETS: { fetch: async () => new Response('https://你的域名/loc.json?token=你的Token') } };
  const response = await call('ios-location-spoofer.sgmodule.js', 'GET', undefined, env, token);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(await response.text(), 'https://example.test/loc.json?token=' + encodeURIComponent(token));
});

test('page refuses unconfigured service and injected config escapes script terminator', async () => {
  assert.equal((await call('index.js', 'GET', undefined, {})).status, 503);
  let injected = '';
  context.HTMLRewriter = class {
    on(_, handler) { handler.element({ append: s => { injected = s; } }); return this; }
    transform(r) { return r; }
  };
  const env = { TOKEN: 'test', SPOOFER_DATA: storage(), AMAP_KEY: '</script><img src=x>',
    ASSETS: { fetch: async () => new Response('<html></html>') } };
  assert.equal((await call('index.js', 'GET', undefined, env)).status, 200);
  assert(!injected.includes('</script><img'));
  assert(injected.includes('\\u003c'));
});

test('lock uses saved response, ignores double click and recovers after failure', async () => {
  const lockSource = html.slice(html.indexOf('var savingLocation=false;'), html.indexOf("elBtnLock.addEventListener('click',lockLocation)"));
  const validate = html.slice(html.indexOf('function validCoords(d)'), html.indexOf('/* ─── Init:'));
  const classes = { add() {}, remove() {} };
  let pending, requests = 0, pinned;
  const ctx = vm.createContext({
    WGS: { lat: 10, lng: 20 }, lockedWGS: null, altitude: 0, hacc: 39, vacc: 1000,
    elBtnLock: { classList: classes }, elBtnLockLabel: {},
    $id: () => ({ value: '', classList: classes }), API: p => p,
    fetch: () => { requests++; return new Promise(resolve => { pending = resolve; }); },
    toast() {}, updateStatus() {}, updateLockedPin: (lat, lng) => { pinned = [lat, lng]; },
    setTimeout: callback => callback()
  });
  vm.runInContext(validate + lockSource, ctx);
  ctx.lockLocation(); ctx.lockLocation();
  assert.equal(requests, 1);
  ctx.WGS = { lat: 30, lng: 40 };
  pending({ ok: true, json: async () => ({ latitude: 10, longitude: 20 }) });
  await new Promise(setImmediate);
  assert.deepEqual(pinned, [10, 20]);
  assert.equal(ctx.elBtnLock.disabled, false);
  ctx.lockLocation();
  pending({ ok: false, status: 503 });
  await new Promise(setImmediate);
  assert.deepEqual(pinned, [10, 20]);
  assert.equal(ctx.elBtnLock.disabled, false);
});

test('search escaping, Esri favorite coordinates and zero-coordinate init are retained', () => {
  const src = html.slice(html.indexOf('function escHtml(s)'), html.indexOf('/* Favorites panel'));
  const ctx = vm.createContext({});
  vm.runInContext(src, ctx);
  assert.equal(ctx.escHtml('<img src=x onerror="bad">'), '&lt;img src=x onerror=&quot;bad&quot;&gt;');
  assert(html.includes("escHtml(parts[0])") && html.includes("escHtml(parts.slice(1,3).join(','))"));
  assert(html.includes("(currentLayer==='osm'||currentLayer==='esri')?[f.latitude,f.longitude]"));
  assert(html.includes('WGS={lat:d.latitude,lng:d.longitude}'));
  assert(!html.includes('updateLockedPin(39.90872,116.39748)'));
});
