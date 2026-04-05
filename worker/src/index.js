import { RoomDO } from './room.js';
export { RoomDO };

// ── Vocab cache ───────────────────────────────────────────────
let vocabSet = null;
async function getVocab(env) {
  if (!vocabSet) {
    const list = await env.KV.get('wordlist', 'json') || [];
    vocabSet = new Set(list);
  }
  return vocabSet;
}

// ── CORS ──────────────────────────────────────────────────────
function cors(req, res) {
  const origin = req.headers.get('Origin') || '';
  const allowed = [
    'https://cemultix.games',
    'https://www.cemultix.games',
    'https://cemultix.pages.dev',
    'http://localhost:3000',
    'http://localhost:8787',
    'http://127.0.0.1:5500',
  ];
  const allowedOrigin = allowed.includes(origin) ? origin : allowed[0];
  const h = new Headers(res.headers);
  h.set('Access-Control-Allow-Origin', allowedOrigin);
  h.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  h.set('Access-Control-Allow-Headers', 'Content-Type');
  h.set('Access-Control-Allow-Credentials', 'true');
  h.set('Vary', 'Origin');
  return new Response(res.body, { status: res.status, headers: h });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}

// ── Rate limit ────────────────────────────────────────────────
const rl = new Map();
function rateLimit(ip, max = 60, ms = 60000) {
  const now = Date.now();
  let e = rl.get(ip);
  if (!e || now > e.reset) { e = { count: 0, reset: now + ms }; rl.set(ip, e); }
  return ++e.count > max;
}

// ── Session cookie ────────────────────────────────────────────
function getSession(req) {
  const id = req.headers.get('Cookie')?.match(/cemSess=([a-f0-9-]+)/)?.[1];
  return id ? { sessionId: id, isNew: false } : { sessionId: crypto.randomUUID(), isNew: true };
}
function withSession(res, id) {
  const h = new Headers(res.headers);
  h.append('Set-Cookie', `cemSess=${id}; Path=/; HttpOnly; SameSite=None; Secure; Max-Age=86400`);
  return new Response(res.body, { status: res.status, headers: h });
}

// ── Date Paris ────────────────────────────────────────────────
function todayKey() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Paris' }).format(new Date());
}

// ── Mots ─────────────────────────────────────────────────────
async function getRandomWord(env) {
  const list = await env.KV.get('secrets', 'json') || [];
  if (!list.length) throw new Error('Secrets vide — upload tes données KV');
  return list[Math.floor(Math.random() * list.length)];
}

async function getDailyWord(env) {
  const key = `daily:${todayKey()}`;
  let d = await env.KV.get(key, 'json');
  if (!d) {
    const word = await getRandomWord(env);
    const n = parseInt(await env.KV.get('word:counter') || '0') + 1;
    await env.KV.put('word:counter', String(n));
    d = { word, date: todayKey(), number: n };
    await env.KV.put(key, JSON.stringify(d), { expirationTtl: 172800 });
  }
  return d;
}

// ── Validation ────────────────────────────────────────────────
async function validateWord(env, word) {
  if (!/^[a-zàâäéèêëîïôùûüœæç-]{2,40}$/.test(word))
    return { ok: false, error: 'Mot invalide (lettres uniquement, 2-40 caractères)', code: 'INVALID_FORMAT' };
  const vocab = await getVocab(env);
  if (vocab.size > 0 && !vocab.has(word))
    return { ok: false, error: `"${word}" n'est pas dans le dictionnaire`, code: 'UNKNOWN_WORD' };
  return { ok: true };
}

// ── Proximité ─────────────────────────────────────────────────
async function getProximity(env, word, secret) {
  if (word === secret) return { rank: 1, proximity: 1.0, found: true };
  const nb = await env.KV.get(`neighbors:${secret}`, 'json');
  if (!nb) return { rank: null, proximity: 0.0001, found: false };
  const idx = nb.indexOf(word);
  if (idx === -1) return { rank: null, proximity: 0.0001, found: false };
  if (idx < 1000) return { rank: idx + 1, proximity: +((1000 - idx) / 1000).toFixed(4), found: false };
  // Entre 1001 et N : score décroissant linéaire
  const total = nb.length;
  return { rank: null, proximity: +((total - idx) / total * 0.1).toFixed(5), found: false };
}

// ── D1 scores ─────────────────────────────────────────────────
async function saveScore(env, sessionId, username, word, tries, date) {
  try {
    await env.DB.prepare(
      `INSERT OR REPLACE INTO scores (session_id, username, word, tries, date, solved_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))`
    ).bind(sessionId, username, word, tries, date).run();
  } catch(e) { console.error('D1 insert error:', e); }
}

async function getGlobalRank(env, tries, date) {
  try {
    const r = await env.DB.prepare(
      `SELECT COUNT(*) as c FROM scores WHERE date=? AND tries<=?`
    ).bind(date, tries).first();
    return (r?.c || 0) + 1;
  } catch { return null; }
}

// ── Sanitize ────────────────────────────────────────────────
function sanitize(str) {
  return String(str || '').replace(/[<>"'&]/g, '').trim().slice(0, 20);
}

// ── Room DO ───────────────────────────────────────────────────
function roomStub(env, code) {
  return env.ROOM_DO.get(env.ROOM_DO.idFromName(code));
}

// ── Main ─────────────────────────────────────────────────────
export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return cors(req, new Response(null, { status: 204 }));
    const url = new URL(req.url);
    const ip  = req.headers.get('CF-Connecting-IP') || 'local';
    let res;
    try { res = await route(req, env, url, ip); }
    catch (e) { console.error(e); res = json({ error: e.message || 'Erreur interne' }, 500); }
    return cors(req, res);
  },
};

async function route(req, env, url, ip) {
  const p = url.pathname;
  const m = req.method;

  if (p === '/health') return json({ ok: true, date: todayKey() });

  if (p === '/api/daily' && m === 'GET') {
    const d = await getDailyWord(env);
    return json({ wordNumber: d.number, date: d.date });
  }

  // POST /api/guess — solo, mot du jour, avec score D1
  if (p === '/api/guess' && m === 'POST') {
    if (rateLimit(ip)) return json({ error: 'Trop de requêtes' }, 429);
    const { word, username } = await req.json();
    if (!word || !username) return json({ error: 'Paramètres manquants' }, 400);
    const clean = word.toLowerCase().trim().normalize('NFC');
    const check = await validateWord(env, clean);
    if (!check.ok) return json({ error: check.error, code: check.code }, 422);

    const daily = await getDailyWord(env);
    const result = await getProximity(env, clean, daily.word);

    if (result.found) {
      // Enregistre le score dans D1
      const { sessionId, isNew } = getSession(req);
      // Compte les essais de cette session aujourd'hui
      let tries = 1;
      try {
        const prev = await env.DB.prepare(
          `SELECT tries FROM scores WHERE session_id=? AND date=?`
        ).bind(sessionId, daily.date).first();
        tries = (prev?.tries || 0) + 1;
      } catch {}
      await saveScore(env, sessionId, username, daily.word, tries, daily.date);
      const globalRank = await getGlobalRank(env, tries, daily.date);
      let res = json({ ...result, globalRank });
      if (isNew) res = withSession(res, sessionId);
      return res;
    }
    return json(result);
  }

  // POST /api/room
  if (p === '/api/room' && m === 'POST') {
    if (rateLimit(ip, 10)) return json({ error: 'Trop de requêtes' }, 429);
    const body = await req.json();
    const username = sanitize(body.username);
    const { roomName, maxPlayers = 4, mode = 'race', showOtherWords = false } = body;
    if (!username) return json({ error: 'Pseudo requis' }, 400);
    const code = Array.from(crypto.getRandomValues(new Uint8Array(4)))
      .map(b => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('');
    const secret = await getRandomWord(env);
    const r = await roomStub(env, code).fetch(new Request('http://do/init', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code,
        roomName: roomName || 'Salle',
        maxPlayers,
        mode,
        showOtherWords: mode === 'race' ? !!showOtherWords : true,
        secret,
        wordNumber: 0,
      }),
    }));
    return json({ roomCode: code, ...(await r.json()) });
  }

  const joinM = p.match(/^\/api\/room\/([A-Z0-9]{4,8})\/join$/);
  if (joinM && m === 'POST') {
    const username = sanitize((await req.json()).username);
    if (!username) return json({ error: 'Pseudo requis' }, 400);
    const r = await roomStub(env, joinM[1]).fetch(new Request('http://do/join', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username }),
    }));
    if (!r.ok) return json({ error: 'Salle introuvable ou pleine' }, r.status);
    return json(await r.json());
  }

  const hbM = p.match(/^\/api\/room\/([A-Z0-9]{4,8})\/heartbeat$/);
  if (hbM && m === 'POST') {
    const username = sanitize((await req.json()).username);
    await roomStub(env, hbM[1]).fetch(new Request('http://do/heartbeat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username }),
    }));
    return json({ ok: true });
  }

  const stateM = p.match(/^\/api\/room\/([A-Z0-9]{4,8})\/state$/);
  if (stateM && m === 'GET') {
    const since = url.searchParams.get('since') || '0';
    const r = await roomStub(env, stateM[1]).fetch(new Request(`http://do/state?since=${since}`));
    if (!r.ok) return json({ error: 'Salle introuvable' }, 404);
    return json(await r.json());
  }

  const guessM = p.match(/^\/api\/room\/([A-Z0-9]{4,8})\/guess$/);
  if (guessM && m === 'POST') {
    if (rateLimit(ip)) return json({ error: 'Trop de requêtes' }, 429);
    const body2 = await req.json();
    const word = body2.word;
    const username = sanitize(body2.username);
    if (!word || !username) return json({ error: 'Paramètres manquants' }, 400);
    const clean = word.toLowerCase().trim().normalize('NFC');
    const check = await validateWord(env, clean);
    if (!check.ok) return json({ error: check.error, code: check.code }, 422);
    const stub = roomStub(env, guessM[1]);
    const secretR = await stub.fetch(new Request('http://do/secret'));
    if (!secretR.ok) return json({ error: 'Salle introuvable' }, 404);
    const { secret } = await secretR.json();
    const result = await getProximity(env, clean, secret);
    await stub.fetch(new Request('http://do/guess', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ word: clean, username, ...result }),
    }));
    return json(result);
  }

  if (p === '/api/leaderboard' && m === 'GET') {
    const date = url.searchParams.get('date') || todayKey();
    try {
      const rows = await env.DB.prepare(
        `SELECT username, tries, solved_at FROM scores WHERE date=? ORDER BY tries ASC LIMIT 20`
      ).bind(date).all();
      return json({ date, scores: rows.results });
    } catch { return json({ date, scores: [] }); }
  }

  // GET /admin/room/:code — voir le mot secret d'une salle (protégé par clé)
  const adminM = p.match(/^\/admin\/room\/([A-Z0-9]{4,8})$/);
  if (adminM && m === 'GET') {
    const key = url.searchParams.get('key');
    if (!key || key !== env.ADMIN_KEY) return json({ error: 'Non autorisé' }, 401);
    const stub = roomStub(env, adminM[1]);
    const r = await stub.fetch(new Request('http://do/secret'));
    if (!r.ok) return json({ error: 'Salle introuvable' }, 404);
    const { secret } = await r.json();
    return json({ roomCode: adminM[1], secret });
  }

  // GET /admin/daily — voir le mot du jour (protégé par clé)
  if (p === '/admin/daily' && m === 'GET') {
    const key = url.searchParams.get('key');
    if (!key || key !== env.ADMIN_KEY) return json({ error: 'Non autorisé' }, 401);
    const d = await getDailyWord(env);
    return json({ word: d.word, date: d.date, number: d.number });
  }

  return json({ error: 'Route introuvable' }, 404);
}