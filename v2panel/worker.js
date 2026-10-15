import { connect } from 'cloudflare:sockets';

const DEF = {
  wsPath: '/ws',
  addresses: [],
  ports: [443],
  sni: '',
  fp: 'chrome',
  proxyIP: '',
  ai: { provider: 'workers', baseUrl: 'https://api.openai.com/v1', apiKey: '', model: '' },
};
const enc = new TextEncoder();
let cache = { t: 0, v: null };

const SYS =
  'You help configure a Cloudflare Workers VLESS panel. Settings keys: addresses (array of clean IPs/domains), ports (array; TLS ports: 443,2053,2083,2087,2096,8443), fp (chrome|firefox|safari|ios|android|randomized), sni (string, blank = worker domain), proxyIP (string), wsPath (string). When recommending settings, include a single JSON object with only those keys. Be concise. Reply in the language of the user.';

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const p = url.pathname;
    if (p === '/panel') return new Response(PANEL, { headers: { 'content-type': 'text/html;charset=utf-8' } });
    if (p === '/') return Response.redirect(url.origin + '/panel', 302);
    if (!env.DB) return new Response('KV binding "DB" missing', { status: 500 });

    const { cfg, users, uuids } = await load(env);
    if (req.headers.get('upgrade') === 'websocket' && p === cfg.wsPath) return vless(cfg, uuids);

    const sm = p.match(/^\/sub\/([0-9a-f-]{36})$/);
    if (sm) {
      const u = users.find((x) => x.uuid === sm[1]);
      if (!u || !u.on || (u.exp && u.exp < Date.now())) return new Response('not found', { status: 404 });
      const txt = links(u.uuid, u.name, cfg, url.hostname).join('\n');
      return new Response(url.searchParams.has('raw') ? txt : btoa(txt), {
        headers: {
          'content-type': 'text/plain;charset=utf-8',
          'subscription-userinfo': 'upload=0; download=0; total=0; expire=' + Math.floor((u.exp || 0) / 1000),
          'profile-update-interval': '12',
        },
      });
    }
    if (p.startsWith('/api/')) return api(req, env, url);
    return new Response('not found', { status: 404 });
  },
};

async function load(env, force) {
  if (!force && cache.v && Date.now() - cache.t < 20000) return cache.v;
  const [raw, list] = await Promise.all([env.DB.get('settings', 'json'), env.DB.list({ prefix: 'u:' })]);
  const cfg = { ...DEF, ...raw, ai: { ...DEF.ai, ...(raw && raw.ai) } };
  const users = list.keys.map((k) => ({ uuid: k.name.slice(2), ...k.metadata }));
  const now = Date.now();
  const uuids = new Set(users.filter((u) => u.on && (!u.exp || u.exp > now)).map((u) => u.uuid));
  cache = { t: now, v: { cfg, users, uuids } };
  return cache.v;
}

function links(uuid, name, cfg, host) {
  const sni = cfg.sni || host;
  const addrs = cfg.addresses.length ? cfg.addresses : [host];
  const ports = cfg.ports.length ? cfg.ports : [443];
  const out = [];
  for (const a of addrs) {
    const h = a.includes(':') ? '[' + a + ']' : a;
    for (const port of ports) {
      out.push(
        `vless://${uuid}@${h}:${port}?encryption=none&security=tls&sni=${sni}&fp=${cfg.fp}&alpn=http%2F1.1&type=ws&host=${sni}&path=${encodeURIComponent(cfg.wsPath)}#${encodeURIComponent(name + '-' + a + '-' + port)}`
      );
    }
  }
  return out;
}

/* ---------- auth ---------- */
async function sign(env, msg) {
  const k = await crypto.subtle.importKey('raw', enc.encode('v2panel:' + env.ADMIN_PASSWORD), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const s = await crypto.subtle.sign('HMAC', k, enc.encode(msg));
  return [...new Uint8Array(s)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function authed(req, env) {
  if (!env.ADMIN_PASSWORD) return false;
  const m = (req.headers.get('cookie') || '').match(/(?:^|; )t=(\d+)\.([0-9a-f]+)/);
  return !!m && +m[1] > Date.now() && (await sign(env, m[1])) === m[2];
}

/* ---------- panel API ---------- */
async function api(req, env, url) {
  const p = url.pathname;
  const m = req.method;
  const j = (d, s = 200, h = {}) =>
    new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json', ...h } });

  if (p === '/api/login' && m === 'POST') {
    const { password = '' } = await req.json().catch(() => ({}));
    if (!env.ADMIN_PASSWORD) return j({ error: 'nopass' }, 401);
    if ((await sign(env, 'pw:' + password)) !== (await sign(env, 'pw:' + env.ADMIN_PASSWORD))) return j({ error: 'bad' }, 401);
    const exp = Date.now() + 6048e5;
    return j({ ok: 1 }, 200, {
      'set-cookie': `t=${exp}.${await sign(env, String(exp))}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=604800`,
    });
  }
  if (p === '/api/logout') return j({ ok: 1 }, 200, { 'set-cookie': 't=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0' });
  if (!(await authed(req, env))) return j({ error: 'auth' }, 401);

  const body = m === 'GET' || m === 'DELETE' ? {} : await req.json().catch(() => ({}));
  const { cfg, users } = await load(env, true);

  if (p === '/api/me') return j({ ok: 1 });

  if (p === '/api/users' && m === 'GET') return j(users);
  if (p === '/api/users' && m === 'POST') {
    const uuid = crypto.randomUUID();
    const days = Math.max(0, +body.days || 0);
    const meta = {
      name: String(body.name || 'user').slice(0, 40),
      exp: days ? Date.now() + days * 864e5 : 0,
      on: true,
      created: Date.now(),
    };
    await env.DB.put('u:' + uuid, '1', { metadata: meta });
    cache.t = 0;
    return j({ uuid, ...meta });
  }
  const um = p.match(/^\/api\/users\/([0-9a-f-]{36})$/);
  if (um) {
    const key = 'u:' + um[1];
    if (m === 'DELETE') {
      await env.DB.delete(key);
      cache.t = 0;
      return j({ ok: 1 });
    }
    if (m === 'PATCH') {
      const { metadata } = await env.DB.getWithMetadata(key);
      if (!metadata) return j({ error: 'nf' }, 404);
      const meta = { ...metadata };
      if ('on' in body) meta.on = !!body.on;
      if ('name' in body) meta.name = String(body.name).slice(0, 40);
      if ('days' in body) meta.exp = +body.days ? Date.now() + +body.days * 864e5 : 0;
      await env.DB.put(key, '1', { metadata: meta });
      cache.t = 0;
      return j({ ok: 1 });
    }
  }

  if (p === '/api/settings' && m === 'GET')
    return j({ ...cfg, ai: { ...cfg.ai, apiKey: cfg.ai.apiKey ? '***' : '' }, hasWorkersAI: !!env.AI });
  if (p === '/api/settings' && m === 'PUT') {
    await env.DB.put('settings', JSON.stringify(clean(body, cfg)));
    cache.t = 0;
    return j({ ok: 1 });
  }

  if (p === '/api/ai' && m === 'POST') {
    try {
      return j({ reply: await ai(env, cfg.ai, body.messages) });
    } catch (e) {
      return j({ error: String((e && e.message) || e).slice(0, 500) }, 502);
    }
  }
  return j({ error: 'nf' }, 404);
}

function clean(b, old) {
  const list = (v) =>
    (Array.isArray(v) ? v : String(v || '').split(/[\s,]+/)).map((s) => String(s).trim()).filter(Boolean);
  const a = b.ai || {};
  let wp = '/' + String(b.wsPath || 'ws').replace(/[^\w\-\/]/g, '').replace(/^\/+/, '');
  if (wp === '/' || /^\/(panel|sub|api)(\/|$)/.test(wp)) wp = '/ws';
  const ports = list(b.ports).map(Number).filter((n) => n > 0 && n < 65536).slice(0, 10);
  return {
    wsPath: wp,
    addresses: list(b.addresses).slice(0, 50),
    ports: ports.length ? ports : [443],
    sni: String(b.sni || '').trim(),
    fp: String(b.fp || 'chrome'),
    proxyIP: String(b.proxyIP || '').trim(),
    ai: {
      provider: ['workers', 'openai', 'anthropic'].includes(a.provider) ? a.provider : 'workers',
      baseUrl: String(a.baseUrl || '').trim(),
      model: String(a.model || '').trim(),
      apiKey: a.apiKey === '***' ? old.ai.apiKey : String(a.apiKey || '').trim(),
    },
  };
}

/* ---------- AI ---------- */
async function ai(env, c, msgs) {
  msgs = (Array.isArray(msgs) ? msgs : []).slice(-20).map((m) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: String(m.content).slice(0, 4000),
  }));
  if (!msgs.length) throw new Error('empty');
  if (c.provider === 'workers') {
    if (!env.AI) throw new Error('Workers AI binding missing');
    const r = await env.AI.run(c.model || '@cf/meta/llama-3.1-8b-instruct', {
      messages: [{ role: 'system', content: SYS }, ...msgs],
    });
    return r.response;
  }
  if (!c.apiKey) throw new Error('API key not set');
  if (c.provider === 'anthropic') {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': c.apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: c.model || 'claude-sonnet-5-5', max_tokens: 1000, system: SYS, messages: msgs }),
    });
    if (!r.ok) throw new Error(await r.text());
    const d = await r.json();
    return d.content.map((x) => x.text || '').join('');
  }
  const r = await fetch((c.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '') + '/chat/completions', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + c.apiKey, 'content-type': 'application/json' },
    body: JSON.stringify({ model: c.model, messages: [{ role: 'system', content: SYS }, ...msgs] }),
  });
  if (!r.ok) throw new Error(await r.text());
  const d = await r.json();
  return d.choices[0].message.content;
}

/* ---------- VLESS ---------- */
const concat = (a, b) => {
  const o = new Uint8Array(a.length + b.length);
  o.set(a);
  o.set(b, a.length);
  return o;
};

function parse(b) {
  if (b.length < 24) return null;
  const hex = [...b.subarray(1, 17)].map((x) => x.toString(16).padStart(2, '0')).join('');
  const uuid = hex.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');
  let o = 18 + b[17];
  const cmd = b[o++];
  if (cmd !== 1 && cmd !== 2) return null;
  const port = (b[o] << 8) | b[o + 1];
  o += 2;
  const t = b[o++];
  let addr;
  if (t === 1) {
    addr = [...b.subarray(o, o + 4)].join('.');
    o += 4;
  } else if (t === 2) {
    const l = b[o++];
    addr = new TextDecoder().decode(b.subarray(o, o + l));
    o += l;
  } else if (t === 3) {
    const s = [];
    for (let i = 0; i < 8; i++) s.push(((b[o + i * 2] << 8) | b[o + i * 2 + 1]).toString(16));
    addr = s.join(':');
    o += 16;
  } else return null;
  return { ver: b[0], uuid, port, addr, off: o, udp: cmd === 2 };
}

function vless(cfg, uuids) {
  const [client, ws] = Object.values(new WebSocketPair());
  ws.accept();
  let st = null;
  let udp = null;
  let q = Promise.resolve();
  const kill = () => {
    try {
      ws.close();
    } catch {}
  };
  const onData = async (d) => {
    if (typeof d === 'string') return;
    const b = new Uint8Array(d);
    if (udp) return udp(b);
    if (st) {
      await st.ready;
      return st.w && st.w.write(b);
    }
    const h = parse(b);
    if (!h || !uuids.has(h.uuid)) return kill();
    const resp = new Uint8Array([h.ver, 0]);
    const payload = b.subarray(h.off);
    if (h.udp) {
      if (h.port !== 53) return kill();
      udp = dns(ws, resp);
      return udp(payload);
    }
    st = { got: false, w: null };
    st.ready = tcp(h, payload, ws, resp, cfg, st, kill);
  };
  ws.addEventListener('message', (e) => {
    q = q.then(() => onData(e.data)).catch(kill);
  });
  ws.addEventListener('close', kill);
  ws.addEventListener('error', kill);
  return new Response(null, { status: 101, webSocket: client });
}

function tcp(h, payload, ws, resp, cfg, st, kill) {
  let sent = false;
  const dial = async (host) => {
    const s = connect({ hostname: host, port: h.port });
    st.w = s.writable.getWriter();
    await st.w.write(payload);
    return s;
  };
  const pipe = (s) =>
    s.readable.pipeTo(
      new WritableStream({
        write(c) {
          st.got = true;
          ws.send(sent ? c : ((sent = true), concat(resp, c)));
        },
      })
    );
  const run = async (host, ready) => {
    const s = await dial(host);
    ready();
    await pipe(s);
  };
  return new Promise((ready) => {
    (async () => {
      try {
        await run(h.addr, ready);
      } catch {}
      if (!st.got && cfg.proxyIP) {
        try {
          await run(cfg.proxyIP, ready);
        } catch {}
      }
      ready();
      kill();
    })();
  });
}

function dns(ws, resp) {
  let sent = false;
  return async (data) => {
    for (let i = 0; i + 2 <= data.length; ) {
      const len = (data[i] << 8) | data[i + 1];
      const qy = data.subarray(i + 2, i + 2 + len);
      i += 2 + len;
      const r = await fetch('https://1.1.1.1/dns-query', {
        method: 'POST',
        headers: { 'content-type': 'application/dns-message' },
        body: qy,
      });
      const a = new Uint8Array(await r.arrayBuffer());
      const out = concat(new Uint8Array([a.length >> 8, a.length & 255]), a);
      ws.send(sent ? out : ((sent = true), concat(resp, out)));
    }
  };
}

/* ---------- panel UI ---------- */
const PANEL = String.raw`<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>V2 Panel</title><style>
:root{--bg:#0f1115;--fg:#e8e8ea;--card:#1a1d24;--bd:#2a2e38;--ac:#3b82f6;--mut:#8b90a0}
@media(prefers-color-scheme:light){:root{--bg:#f5f6f8;--fg:#1a1c20;--card:#fff;--bd:#dfe2e8;--mut:#667085}}
*{box-sizing:border-box}[hidden]{display:none!important}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.6 system-ui,Tahoma,sans-serif}
main{max-width:860px;margin:0 auto;padding:16px}
.card{background:var(--card);border:1px solid var(--bd);border-radius:12px;padding:16px;margin-bottom:16px}
input,select,textarea,button{font:inherit;color:inherit;background:transparent;border:1px solid var(--bd);border-radius:8px;padding:8px 10px}
input,select,textarea{width:100%;margin:4px 0 12px;direction:ltr;text-align:left}
select option{background:var(--card)}
button{cursor:pointer;background:var(--ac);border-color:var(--ac);color:#fff;margin:2px}
button.g{background:transparent;color:var(--fg);border-color:var(--bd)}
nav{display:flex;gap:6px;margin-bottom:16px;flex-wrap:wrap}
table{width:100%;border-collapse:collapse}td,th{padding:8px;border-bottom:1px solid var(--bd);text-align:right}
label{color:var(--mut);font-size:12px}
.m{padding:8px 12px;border-radius:10px;margin:6px 0;white-space:pre-wrap;unicode-bidi:plaintext}
.m.user{background:var(--ac);color:#fff}.m.assistant{background:var(--bg);border:1px solid var(--bd)}
.row{display:flex;gap:8px;flex-wrap:wrap}.row>*{flex:1;min-width:140px}
</style></head><body><main>
<div id="login" class="card" hidden><h3>ورود</h3><label>رمز عبور</label><input id="pw" type="password"><button onclick="login()">ورود</button></div>
<div id="app" hidden>
<nav><button class="g" onclick="tab('users')">کاربران</button><button class="g" onclick="tab('settings')">تنظیمات</button><button class="g" onclick="tab('ai')">دستیار هوش مصنوعی</button><button class="g" onclick="logout()">خروج</button></nav>
<section id="t-users"><div class="card"><div class="row"><div><label>نام</label><input id="un" placeholder="user"></div><div><label>مدت (روز، 0 = نامحدود)</label><input id="ud" type="number" value="30"></div></div><button onclick="addUser()">ساخت کاربر</button></div>
<div class="card" style="overflow:auto"><table><thead><tr><th>نام</th><th>انقضا</th><th></th></tr></thead><tbody id="ub"></tbody></table><textarea id="cfg" rows="6" hidden readonly></textarea></div></section>
<section id="t-settings" hidden><div class="card">
<label>آدرس‌ها (IP تمیز / دامنه، هر خط یکی؛ خالی = دامنه ورکر)</label><textarea id="addresses" rows="4"></textarea>
<div class="row"><div><label>پورت‌ها (با کاما)</label><input id="ports"></div><div><label>مسیر WebSocket</label><input id="wsPath"></div></div>
<div class="row"><div><label>SNI / Host (خالی = دامنه ورکر)</label><input id="sni"></div><div><label>Proxy IP (برای سایت‌های پشت Cloudflare)</label><input id="proxyIP"></div></div>
<label>Fingerprint</label><select id="fp"><option>chrome</option><option>firefox</option><option>safari</option><option>ios</option><option>android</option><option>randomized</option></select>
<h4>هوش مصنوعی</h4>
<div class="row"><div><label>Provider</label><select id="provider"><option value="workers">Cloudflare Workers AI</option><option value="openai">OpenAI-compatible</option><option value="anthropic">Anthropic</option></select></div><div><label>Model (اختیاری)</label><input id="model"></div></div>
<label>Base URL (فقط OpenAI-compatible)</label><input id="baseUrl"><label>API Key</label><input id="apiKey" type="password">
<button onclick="saveSettings()">ذخیره</button></div></section>
<section id="t-ai" hidden><div class="card"><div id="log"></div><textarea id="q" rows="3" placeholder="مثلا: بهترین تنظیمات برای اینترنت همراه ایرانسل؟"></textarea><button onclick="send()">ارسال</button><button id="apply" class="g" hidden onclick="applyAI()">اعمال پیشنهاد در تنظیمات</button></div></section>
</div></main><script>
var $=function(s){return document.querySelector(s)};
function api(p,m,b){return fetch(p,{method:m||'GET',headers:{'content-type':'application/json'},body:b?JSON.stringify(b):undefined}).then(function(r){if(r.status===401&&p!=='/api/login'){view(false);throw new Error('auth')}return r.json()})}
function view(on){$('#login').hidden=on;$('#app').hidden=!on}
function tab(n){['users','settings','ai'].forEach(function(t){$('#t-'+t).hidden=t!==n})}
function init(){api('/api/me').then(function(){view(true);tab('users');loadUsers();loadSettings()}).catch(function(){view(false)})}
function login(){api('/api/login','POST',{password:$('#pw').value}).then(function(r){if(r.ok)init();else alert(r.error==='nopass'?'ADMIN_PASSWORD تنظیم نشده':'رمز اشتباه')})}
function logout(){api('/api/logout').then(function(){view(false)})}
function cell(tr,t){var td=document.createElement('td');td.textContent=t;tr.appendChild(td)}
function btn(t,f){var b=document.createElement('button');b.className='g';b.textContent=t;b.onclick=f;return b}
function copy(t){navigator.clipboard.writeText(t).then(function(){alert('کپی شد')})}
function addUser(){api('/api/users','POST',{name:$('#un').value||'user',days:+$('#ud').value||0}).then(function(){$('#un').value='';loadUsers()})}
function loadUsers(){api('/api/users').then(function(us){
var tb=$('#ub');tb.textContent='';
us.sort(function(a,b){return b.created-a.created});
us.forEach(function(u){
var tr=document.createElement('tr');
var dead=u.exp&&u.exp<Date.now();
cell(tr,u.name);cell(tr,(u.exp?new Date(u.exp).toLocaleDateString('fa-IR'):'نامحدود')+(dead?' (منقضی)':''));
var td=document.createElement('td');
td.appendChild(btn(u.on?'فعال':'غیرفعال',function(){api('/api/users/'+u.uuid,'PATCH',{on:!u.on}).then(loadUsers)}));
td.appendChild(btn('لینک اشتراک',function(){copy(location.origin+'/sub/'+u.uuid)}));
td.appendChild(btn('کانفیگ‌ها',function(){fetch('/sub/'+u.uuid+'?raw=1').then(function(r){return r.text()}).then(function(t){$('#cfg').value=t;$('#cfg').hidden=false})}));
td.appendChild(btn('تمدید ۳۰ روز',function(){api('/api/users/'+u.uuid,'PATCH',{days:30}).then(loadUsers)}));
td.appendChild(btn('حذف',function(){if(confirm('حذف؟'))api('/api/users/'+u.uuid,'DELETE').then(loadUsers)}));
tr.appendChild(td);tb.appendChild(tr)})})}
function loadSettings(){api('/api/settings').then(function(s){
$('#addresses').value=s.addresses.join('\n');$('#ports').value=s.ports.join(',');
$('#sni').value=s.sni;$('#proxyIP').value=s.proxyIP;$('#wsPath').value=s.wsPath;$('#fp').value=s.fp;
$('#provider').value=s.ai.provider;$('#baseUrl').value=s.ai.baseUrl;$('#apiKey').value=s.ai.apiKey;$('#model').value=s.ai.model})}
function saveSettings(){api('/api/settings','PUT',{addresses:$('#addresses').value,ports:$('#ports').value,sni:$('#sni').value,proxyIP:$('#proxyIP').value,wsPath:$('#wsPath').value,fp:$('#fp').value,
ai:{provider:$('#provider').value,baseUrl:$('#baseUrl').value,apiKey:$('#apiKey').value,model:$('#model').value}}).then(function(){alert('ذخیره شد')})}
var hist=[],last=null;
function addMsg(r,t){var d=document.createElement('div');d.className='m '+r;d.textContent=t;$('#log').appendChild(d);d.scrollIntoView()}
function send(){var t=$('#q').value.trim();if(!t)return;$('#q').value='';addMsg('user',t);hist.push({role:'user',content:t});
api('/api/ai','POST',{messages:hist}).then(function(r){
var x=r.reply||('خطا: '+r.error);addMsg('assistant',x);hist.push({role:'assistant',content:x});
var m=/\{[\s\S]*\}/.exec(x);if(m){try{last=JSON.parse(m[0]);$('#apply').hidden=false}catch(e){}}})}
function applyAI(){var s=last||{};
if(s.addresses)$('#addresses').value=[].concat(s.addresses).join('\n');
if(s.ports)$('#ports').value=[].concat(s.ports).join(',');
['sni','proxyIP','wsPath','fp'].forEach(function(k){if(s[k]!=null)$('#'+k).value=s[k]});
$('#apply').hidden=true;tab('settings')}
$('#pw').onkeydown=function(e){if(e.key==='Enter')login()};
init();
</script></body></html>`;
