const express = require('express');
const { WebSocketServer } = require('ws');
const pty = require('node-pty');
const http = require('http');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);

// ── Auth tokens (WS cannot use Basic Auth — use short-lived tokens) ───────────
const tokens = new Map(); // token → expiry timestamp
const TOKEN_TTL = 5 * 60 * 1000; // 5 minutes

function generateToken() {
  const token = require('crypto').randomBytes(32).toString('hex');
  tokens.set(token, Date.now() + TOKEN_TTL);
  // Clean up expired tokens
  for (const [t, exp] of tokens) if (Date.now() > exp) tokens.delete(t);
  return token;
}

function validateToken(token) {
  if (!token || !tokens.has(token)) return false;
  if (Date.now() > tokens.get(token)) { tokens.delete(token); return false; }
  tokens.delete(token); // single-use
  return true;
}

// ── Rate limiter (max 50 failed attempts per IP per 15 min) ──────────────────
const authFailures = new Map(); // ip → { count, resetAt }
const RATE_LIMIT = 50;
const RATE_WINDOW = 15 * 60 * 1000;

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = authFailures.get(ip);
  if (!entry || now > entry.resetAt) {
    authFailures.set(ip, { count: 0, resetAt: now + RATE_WINDOW });
    return true;
  }
  return entry.count < RATE_LIMIT;
}

function recordFailure(ip) {
  const entry = authFailures.get(ip);
  if (entry) entry.count++;
}

const wss = new WebSocketServer({
  server,
  verifyClient: ({ req }, done) => {
    const ip = req.socket.remoteAddress;
    const url = new URL(req.url, 'http://localhost');
    const token = url.searchParams.get('token');
    if (validateToken(token)) {
      console.log(`${new Date().toISOString()} ${ip} WS connected`);
      done(true);
    } else {
      console.warn(`${new Date().toISOString()} ${ip} WS REJECTED (bad/missing token)`);
      done(false, 401, 'Unauthorized');
    }
  },
});

const BASE_DIR  = process.env.HOME + '/git';

const CONFIG_FILE = path.join(__dirname, 'config.json');
const CONFIG_DEFAULTS = { claudeCommand: 'claude', user: 'admin', pass: 'admin' };
let config = { ...CONFIG_DEFAULTS };
if (!fs.existsSync(CONFIG_FILE)) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(CONFIG_DEFAULTS, null, 2));
  console.log('[config] Created config.json with defaults');
} else {
  try { config = { ...CONFIG_DEFAULTS, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) }; }
  catch (e) { console.error('[config] Failed to parse config.json, using defaults'); }
}
const CLAUDE_CMD = config.claudeCommand || 'claude';
const AUTH_USER  = process.env.WEB_TERM_USER || config.user || 'admin';
const AUTH_PASS  = process.env.WEB_TERM_PASS || config.pass || 'admin';

app.use((req, res, next) => {
  const ip = req.socket.remoteAddress; // never trust X-Forwarded-For — can be spoofed
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    const line = `${new Date().toISOString()} ${ip} ${req.method} ${req.path} ${res.statusCode} ${ms}ms`;
    console.log(line);
    if (res.statusCode === 401 || res.statusCode === 429) {
      console.warn(`[WARN] Auth failure from ${ip}: ${req.method} ${req.path}`);
    }
  });
  if (!checkRateLimit(ip)) {
    return res.status(429).send('Too Many Requests');
  }
  const auth = req.headers.authorization;
  const expected = 'Basic ' + Buffer.from(`${AUTH_USER}:${AUTH_PASS}`).toString('base64');
  if (!auth || auth !== expected) {
    recordFailure(ip);
    res.set('WWW-Authenticate', 'Basic realm="Web Terminal"');
    return res.status(401).send('Unauthorized');
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// ── API ───────────────────────────────────────────────────────────────────────
app.get('/api/token', (req, res) => {
  res.json({ token: generateToken() });
});

app.get('/api/config', (req, res) => {
  res.json({ claudeCommand: CLAUDE_CMD });
});

app.get('/api/dirs', (req, res) => {
  try {
    const entries = fs.readdirSync(BASE_DIR, { withFileTypes: true });
    const dirs = entries
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .map(e => e.name)
      .sort((a, b) => a.localeCompare(b));
    res.json({ base: BASE_DIR, dirs });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.use(express.json({ limit: '2mb' }));

// ── File browser API ──────────────────────────────────────────────────────────
function safePath(p) {
  if (!p) return null;
  const resolved = path.resolve(p);
  // Allow access only under BASE_DIR
  if (!resolved.startsWith(BASE_DIR + path.sep) && resolved !== BASE_DIR) return null;
  return resolved;
}

app.get('/api/files', (req, res) => {
  const dir = safePath(req.query.path) || BASE_DIR;
  if (!dir) return res.status(400).json({ error: 'Invalid path' });
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const items = entries
      .filter(e => !e.name.startsWith('.'))
      .map(e => ({ name: e.name, isDir: e.isDirectory() }))
      .sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
    res.json({ path: dir, items });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/file', (req, res) => {
  const file = safePath(req.query.path);
  if (!file) return res.status(400).json({ error: 'Invalid path' });
  try {
    const stat = fs.statSync(file);
    if (stat.size > 2 * 1024 * 1024) return res.status(413).json({ error: 'File too large' });
    const content = fs.readFileSync(file, 'utf8');
    res.json({ path: file, content });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/file', (req, res) => {
  const { path: filePath, content } = req.body || {};
  const file = safePath(filePath);
  if (!file) return res.status(400).json({ error: 'Invalid path' });
  if (typeof content !== 'string') return res.status(400).json({ error: 'No content' });
  try {
    fs.writeFileSync(file, content, 'utf8');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// SPA catch-all: serve index.html for any non-API, non-asset path
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Persistence — per-folder sessions.json inside server dir ─────────────────
// Stored at: <server_dir>/<sub_folder>/sessions.json
// e.g. /Users/kent/git/claudeterm/web-terminal/claudeterm/sessions.json

const SESSIONS_DIR = path.join(__dirname, '..', 'sessions');  // /Users/kent/git/claudeterm/sessions
fs.mkdirSync(SESSIONS_DIR, { recursive: true });

function sessionsFileFor(cwd) {
  const sub = path.basename(cwd);
  const dir = path.join(SESSIONS_DIR, sub);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'sessions.json');
}

function saveSessions() {
  // Group sessions by cwd
  const byDir = new Map();
  for (const s of sessions.values()) {
    const dir = s.cwd || BASE_DIR;
    if (!byDir.has(dir)) byDir.set(dir, []);
    byDir.get(dir).push({
      id: s.id,
      name: s.name,
      type: s.type,
      cwd: s.cwd,
      claudeSessionId: s.claudeSessionId || null,
    });
  }

  // Write per-folder sessions.json
  for (const [dir, list] of byDir) {
    try {
      fs.writeFileSync(sessionsFileFor(dir), JSON.stringify({ sessions: list }, null, 2));
    } catch (e) {
      console.error(`Failed to save sessions for ${dir}:`, e.message);
    }
  }

  // Remove sessions.json for dirs that no longer have sessions
  try {
    const entries = fs.readdirSync(SESSIONS_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const sub = entry.name;
      const file = path.join(SESSIONS_DIR, sub, 'sessions.json');
      const cwd = path.join(BASE_DIR, sub);
      if (fs.existsSync(file) && !byDir.has(cwd)) fs.unlinkSync(file);
    }
  } catch (e) { /* ignore */ }
}

function loadSavedSessions() {
  const all = [];
  try {
    const entries = fs.readdirSync(SESSIONS_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const file = path.join(SESSIONS_DIR, entry.name, 'sessions.json');
      if (!fs.existsSync(file)) continue;
      try {
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        all.push(...(data.sessions || []));
      } catch (e) {
        console.error(`Failed to load ${file}:`, e.message);
      }
    }
  } catch (e) {
    console.error('Failed to scan sessions dir:', e.message);
  }
  return all;
}

// ── Claude session ID detection ───────────────────────────────────────────────
const CLAUDE_ID_RE = /\b(conv_[A-Za-z0-9]{10,}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/i;

// ── Sessions ──────────────────────────────────────────────────────────────────
const sessions = new Map();
let sessionCounter = 1;

function createSession(name, type = 'shell', autoCmd = null, savedId = null, claudeSessionId = null, cwd = null) {
  const id = savedId || String(sessionCounter++);
  const sessionCwd = cwd || BASE_DIR;

  const shell = pty.spawn('/bin/zsh', [], {
    name: 'xterm-color',
    cols: 80,
    rows: 24,
    cwd: sessionCwd,
    env: { ...process.env, SHELL: '/bin/zsh' },
  });

  const session = {
    id,
    name: name || `Session ${id}`,
    type,
    cwd: sessionCwd,
    claudeSessionId,
    shell,
    clients: new Set(),
    buffer: '',
  };

  shell.onData((data) => {
    session.buffer += data;
    if (session.buffer.length > 50000) session.buffer = session.buffer.slice(-50000);

    if (session.type === 'claude' && !session.claudeSessionId) {
      const match = data.match(CLAUDE_ID_RE);
      if (match) {
        session.claudeSessionId = match[1];
        console.log(`[session ${id}] Detected Claude ID: ${session.claudeSessionId}`);
        saveSessions();
      }
    }

    if (session.type === 'claude' && /too\s+many\s+requests|rate.{0,5}limit/i.test(data)) {
      const retryMatch = data.match(/[Rr]etry(?:ing)?\s+in\s+(\d+)/);
      const retryAfter = retryMatch ? parseInt(retryMatch[1]) : null;
      console.log(`[session ${id}] Rate limited${retryAfter ? ` — retry in ${retryAfter}s` : ''}`);
      for (const client of session.clients) {
        if (client.readyState === client.OPEN) {
          client.send(JSON.stringify({ type: 'rate.limited', retryAfter }));
        }
      }
    }

    for (const client of session.clients) {
      if (client.readyState === client.OPEN) {
        client.send(JSON.stringify({ type: 'output', data }));
      }
    }
  });

  shell.onExit(() => {
    sessions.delete(id);
    saveSessions();
    broadcast({ type: 'session.list', sessions: sessionList() });
  });

  sessions.set(id, session);
  saveSessions();

  if (autoCmd) {
    setTimeout(() => shell.write(autoCmd), 1200);
  }

  return session;
}

function sessionList() {
  return Array.from(sessions.values()).map(s => ({
    id: s.id,
    name: s.name,
    type: s.type,
    dir: path.basename(s.cwd), // only the dirname, not full path
    clients: s.clients.size,
  }));
}

function broadcast(msg) {
  const str = JSON.stringify(msg);
  wss.clients.forEach(client => {
    if (client.readyState === client.OPEN) client.send(str);
  });
}

// ── Restore persisted sessions ────────────────────────────────────────────────
const savedList = loadSavedSessions();

// Compute counter from max existing ID to avoid collisions
sessionCounter = savedList.reduce((max, s) => Math.max(max, parseInt(s.id) || 0), 0) + 1;

for (const s of savedList) {
  let autoCmd = null;
  if (s.type === 'claude') {
    const resumeId = s.claudeSessionId || s.name.replace(/^[^\w]+/, '').trim();
    autoCmd = `${CLAUDE_CMD} --resume ${resumeId}`;
    console.log(`[restore] "${s.name}" (${s.cwd}) → ${autoCmd}`);
  }
  createSession(s.name, s.type || 'shell', autoCmd, s.id, s.claudeSessionId, s.cwd);
}

// Migrate: remove old central sessions.json if it exists
const oldFile = path.join(__dirname, 'sessions.json');
if (fs.existsSync(oldFile)) {
  fs.unlinkSync(oldFile);
  console.log('[migrate] Removed old sessions.json');
}

// ── WebSocket ─────────────────────────────────────────────────────────────────
wss.on('connection', (ws) => {
  let current = null;

  ws.send(JSON.stringify({ type: 'session.list', sessions: sessionList() }));

  ws.on('message', (raw) => {
    try {
      if (raw.length > 64 * 1024) return; // 64 KB max message size
      const msg = JSON.parse(raw);

      if (msg.type === 'session.create') {
        if (current) current.clients.delete(ws);
        const type = msg.sessionType || 'shell';
        const autoCmd = type === 'claude' ? CLAUDE_CMD : null;
        let cwd = null;
        if (msg.cwd) {
          // Support '__BASE__/dirname' shorthand from client
          const raw = msg.cwd.replace('__BASE__', BASE_DIR);
          const resolved = path.resolve(raw);
          if (resolved.startsWith(BASE_DIR)) cwd = resolved;
        }
        current = createSession(msg.name, type, autoCmd, null, null, cwd);
        current.clients.add(ws);
        ws.send(JSON.stringify({ type: 'session.attached', id: current.id, name: current.name, sessionType: current.type, dir: path.basename(current.cwd) }));
        broadcast({ type: 'session.list', sessions: sessionList() });
      }

      if (msg.type === 'session.attach') {
        const session = sessions.get(msg.id);
        if (!session) return;
        if (current) current.clients.delete(ws);
        current = session;
        current.clients.add(ws);
        ws.send(JSON.stringify({ type: 'session.attached', id: current.id, name: current.name, sessionType: current.type, dir: path.basename(current.cwd) }));
        if (current.buffer) ws.send(JSON.stringify({ type: 'output', data: current.buffer }));
        broadcast({ type: 'session.list', sessions: sessionList() });
      }

      if (msg.type === 'session.rename') {
        const session = sessions.get(msg.id);
        if (session) {
          session.name = String(msg.name || '').slice(0, 100);
          if (msg.name === 'Claude' && session.type !== 'claude') session.type = 'claude';
          saveSessions();
          broadcast({ type: 'session.list', sessions: sessionList() });
        }
      }

      if (msg.type === 'session.kill') {
        const session = sessions.get(msg.id);
        if (session) {
          session.shell.kill();
          sessions.delete(msg.id);
          saveSessions();
          broadcast({ type: 'session.list', sessions: sessionList() });
        }
      }

      if (msg.type === 'input' && current) current.shell.write(msg.data);
      if (msg.type === 'resize' && current) current.shell.resize(msg.cols, msg.rows);

    } catch (e) { /* ignore */ }
  });

  ws.on('close', () => {
    if (current) {
      current.clients.delete(ws);
      broadcast({ type: 'session.list', sessions: sessionList() });
    }
  });
});

const PORT = process.env.PORT || 7681;
server.listen(PORT, () => {
  console.log(`Web terminal running at http://localhost:${PORT}`);
  console.log(`Credentials: ${AUTH_USER} / ${'*'.repeat(AUTH_PASS.length)}`);
  console.log(`Base dir: ${BASE_DIR}`);
});
