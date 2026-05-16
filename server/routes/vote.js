import os from 'node:os';
import * as db from '../lib/db.js';

/** Returns non-loopback IPv4 addresses for QR code URL construction. */
function localIPs() {
  const addrs = [];
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) addrs.push(iface.address);
    }
  }
  return addrs;
}

/** In-memory active session for voting; reset when a new arena run starts. */
let activeVoteSession = { sessionId: null, slots: ['A', 'B', 'C', 'D'] };

export function setVoteSession(sessionId, slots = ['A', 'B', 'C', 'D']) {
  activeVoteSession = { sessionId, slots };
}

export function getActiveVoteSession() {
  return activeVoteSession;
}

/** Minimal self-contained voting page served to phone browsers. */
function votePage(port) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Arena Vote</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#0f1117;color:#e2e8f0;font-family:system-ui,sans-serif;min-height:100dvh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:1rem}
  h1{font-size:1.5rem;font-weight:800;color:#34d399;letter-spacing:.05em;margin-bottom:.25rem;text-align:center}
  p{color:#94a3b8;font-size:.85rem;text-align:center;margin-bottom:1.5rem}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:.75rem;width:100%;max-width:380px;margin-bottom:1.5rem}
  button{padding:1.5rem .5rem;font-size:2rem;font-weight:900;border:2px solid #334155;border-radius:1rem;background:#1e293b;color:#e2e8f0;cursor:pointer;transition:all .15s;position:relative}
  button:active{transform:scale(.95)}
  button.selected{border-color:#34d399;background:#064e3b;color:#6ee7b7}
  button.disabled{opacity:.4;cursor:not-allowed}
  .count{display:block;font-size:.7rem;font-weight:500;color:#64748b;margin-top:.5rem}
  .result{text-align:center;font-size:1.1rem;font-weight:700;color:#fbbf24;padding:1rem;background:#1e293b;border-radius:.75rem;max-width:380px;width:100%;line-height:1.6}
  .badge{display:inline-block;padding:.1em .4em;border-radius:.3em;background:#064e3b;color:#34d399;font-size:.8em}
</style>
</head>
<body>
<h1>⚡ ARENA VOTE</h1>
<p>Pick the model you think will win</p>
<div class="grid" id="grid">Loading…</div>
<div id="status"></div>
<script>
const API = '';
let myVote = localStorage.getItem('arena_vote_pick');
let myVoteSession = localStorage.getItem('arena_vote_session');
let tallies = {A:0,B:0,C:0,D:0};
let sessionId = null;
let voted = false;

async function load() {
  try {
    const r = await fetch(API + '/api/vote');
    const j = await r.json();
    sessionId = j.sessionId;
    tallies = j.tallies || {A:0,B:0,C:0,D:0};
    if (myVoteSession !== sessionId) { myVote = null; localStorage.removeItem('arena_vote_pick'); }
    voted = !!myVote;
    render(j.slots || ['A','B','C','D']);
  } catch(e) {
    document.getElementById('grid').textContent = 'Cannot reach Arena server';
  }
}

function render(slots) {
  const grid = document.getElementById('grid');
  const total = Math.max(1, Object.values(tallies).reduce((a,b)=>a+b,0));
  grid.innerHTML = slots.map(s => {
    const pct = Math.round((tallies[s]||0)/total*100);
    const sel = myVote === s ? ' selected' : '';
    const dis = voted && myVote !== s ? ' disabled' : '';
    return \`<button class="\${sel}\${dis}" onclick="pick('\${s}')" id="btn\${s}">
      Slot \${s}
      <span class="count">\${tallies[s]||0} vote\${tallies[s]===1?'':'s'} · \${pct}%</span>
    </button>\`;
  }).join('');
}

async function pick(slot) {
  if (voted) return;
  try {
    const r = await fetch(API + '/api/vote', {
      method:'POST',
      headers:{'content-type':'application/json'},
      body: JSON.stringify({slot, sessionId})
    });
    const j = await r.json();
    if (j.ok) {
      myVote = slot; voted = true;
      localStorage.setItem('arena_vote_pick', slot);
      localStorage.setItem('arena_vote_session', sessionId || '');
      tallies = j.tallies;
      render(j.slots || ['A','B','C','D']);
      document.getElementById('status').innerHTML = '<p style="margin-top:.5rem;color:#34d399">✓ Vote recorded!</p>';
    } else {
      document.getElementById('status').innerHTML = '<p style="color:#f87171">' + (j.error||'Error') + '</p>';
    }
  } catch { document.getElementById('status').textContent = 'Network error'; }
}

load();
setInterval(load, 3000);
</script>
</body>
</html>`;
}

export default async function voteRoutes(fastify) {
  const port = parseInt(process.env.PORT || '5175', 10);

  fastify.get('/vote', async (_req, reply) => {
    reply.header('Content-Type', 'text/html; charset=utf-8');
    return reply.send(votePage(port));
  });

  fastify.get('/api/server-info', async () => {
    return { ips: localIPs(), port };
  });

  fastify.get('/api/vote', async () => {
    const { sessionId, slots } = activeVoteSession;
    const tallies = sessionId ? db.getVoteTallies(sessionId) : { A: 0, B: 0, C: 0, D: 0 };
    return { sessionId, slots, tallies };
  });

  fastify.post('/api/vote', async (request, reply) => {
    const { slot, sessionId: reqSession, voterId } = request.body || {};
    const { sessionId, slots } = activeVoteSession;

    if (!sessionId) return reply.code(409).send({ error: 'No active arena round' });
    if (reqSession && reqSession !== sessionId) {
      return reply.code(409).send({ error: 'Round has changed — please reload' });
    }
    if (!slots.includes(slot)) {
      return reply.code(400).send({ error: 'Invalid slot' });
    }

    const vid = String(voterId || request.ip || 'anon').slice(0, 64);
    if (db.hasVoted(sessionId, vid)) {
      const tallies = db.getVoteTallies(sessionId);
      return { ok: true, already: true, tallies, slots };
    }

    db.insertVote({ session_id: sessionId, slot, voter_id: vid, created_at: Date.now() });
    const tallies = db.getVoteTallies(sessionId);
    return { ok: true, tallies, slots };
  });
}
