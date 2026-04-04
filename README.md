# ClaudeTerm

A lightweight web terminal that lets you run [Claude Code](https://claude.ai/code) sessions from a mobile browser over WiFi — no app installation required.

```
Mac :7681  ←WebSocket→  Mobile Browser
```

## Features

- Run Claude Code from your phone while your Mac does the work
- Multiple named sessions with persistent state (survives server restarts)
- Per-project URL routing (`/project-a`, `/project-b`, ...)
- Mobile-friendly toolbar with common keys (Tab, Ctrl+C, arrows, etc.)
- Basic Auth protection

## Requirements

- macOS (uses `node-pty` with darwin prebuilds)
- Node.js
- [Claude Code](https://claude.ai/code) installed (`npm install -g @anthropic-ai/claude-code`)

## Install

```bash
cd web-terminal
npm install
chmod +x node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper
```

## Start / Stop

```bash
# Start (from the web-terminal directory)
SHELL=/bin/zsh nohup node server.js > /tmp/web-terminal.log 2>&1 &

# Stop
kill $(lsof -ti:7681)

# View logs
tail -f /tmp/web-terminal.log
```

Open `http://<your-local-ip>:7681` on your phone (same WiFi).  
Default credentials: `admin / admin`

Change via environment variables:

```bash
WEB_TERM_USER=myuser WEB_TERM_PASS=mypass SHELL=/bin/zsh nohup node server.js ...
```

## URL Routing

Each project maps to a URL path based on subdirectory name under `~/git`:

| URL | Behavior |
|-----|----------|
| `http://<IP>:7681/` | Directory picker — select a project to open |
| `http://<IP>:7681/my-project` | Opens (or resumes) sessions for `my-project` |

Sessions are stored in `sessions/<project>/sessions.json` and auto-restored on restart.

## Frontend Toolbar

| Button | Sends |
|--------|-------|
| Tab | `\t` |
| Enter | `\r` |
| ls | `ls\r` |
| cd | `cd ` |
| clear | `clear\r` |
| ⌫ | Backspace |
| ^C | SIGINT |
| 1 / 2 / 3 | digit |
| claude | `claude\r` |
| ▲▼◀▶ | Arrow keys |

## Architecture

| Layer | Technology |
|-------|------------|
| Shell bridge | `node-pty` — real pseudo-terminal |
| Transport | WebSocket (`ws`) |
| Frontend | `xterm.js` v5.3 + `xterm-addon-fit` |
| Server | `express` + Node.js |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `WEB_TERM_USER` | `admin` | Basic Auth username |
| `WEB_TERM_PASS` | `admin` | Basic Auth password |
| `PORT` | `7681` | Listening port |
| `BASE_DIR` | `~/git` | Root directory for project listing |

## Known Issues

**`posix_spawnp failed`** — `spawn-helper` missing execute bit  
Fix: `chmod +x node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper`

**Terminal shows garbage `^[]11;rgb:...`** — OSC/CPR echo loop  
Fixed client-side: `isTerminalResponse()` filter blocks these from reaching the PTY.

**WebSocket auth fails** — browsers don't send Basic Auth on WS upgrade  
Fixed: WS connections bypass auth; HTTP layer handles it.

## License

MIT
