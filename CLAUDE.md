# ClaudeTerm

## Overview

A lightweight web terminal that lets you run Claude Code sessions from a mobile browser over WiFi — no app installation required.

```
Mac :7681  ←WebSocket→  Mobile Browser
```

## Start / Stop

```bash
# Start (must be run from the web-terminal directory)
chmod +x node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper
SHELL=/bin/zsh nohup node server.js > /tmp/web-terminal.log 2>&1 &

# Stop
kill $(lsof -ti:7681)

# View logs
tail -f /tmp/web-terminal.log
```

Connection URL: `http://<your-local-ip>:7681` (phone must be on the same WiFi as Mac)
Default credentials: `admin / admin`

---

## Architecture

| Layer | Technology |
|-------|------------|
| Shell bridge | `node-pty` — real pseudo-terminal |
| Transport | WebSocket (`ws`) — bidirectional input/output |
| Frontend | `xterm.js` v5.3 + `xterm-addon-fit` |
| Server | `express` + Node.js |

### Known Issues & Fixes

**`posix_spawnp failed`**
- Cause: `node-pty`'s `spawn-helper` binary is missing execute permission
- Fix: `chmod +x node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper`
- May need to be re-run after each `npm install`

**WebSocket fails to establish terminal**
- Cause: Browsers do not send Basic Auth headers on WebSocket upgrade
- Fix: WS connections skip auth check; rely on HTTP-layer Basic Auth instead

**Terminal displays garbage chars `^[]11;rgb:...`**
- Cause: xterm.js responds to OSC color queries / CPR queries via `onData`, which gets forwarded back to the PTY causing an echo
- Fix: Client-side `isTerminalResponse()` filter intercepts these sequences and does not forward them to the server

**nohup environment missing `$SHELL`**
- Fix: Always start with `SHELL=/bin/zsh` prefix

---

## Session Management

### Persistence

Sessions are stored per subfolder:

```
sessions/
├── project-a/
│   └── sessions.json
├── project-b/
│   └── sessions.json
└── project-c/
    └── sessions.json
```

Each `sessions.json` format:

```json
{
  "sessions": [
    {
      "id": "1",
      "name": "myproject",
      "type": "claude",
      "cwd": "/home/user/git/myproject",
      "claudeSessionId": "6c2fdae6-2555-40ed-9eb1-bd495c1d99f7"
    }
  ]
}
```

- All sessions are automatically restored after server restart
- Shell sessions: respawned directly
- Claude sessions: pre-typed with `claude --resume <id>` for the user to press Enter

### Claude Session Resume Logic

1. `claudeSessionId` has a value → use it to resume
2. `claudeSessionId` is null → strip leading non-word prefix from session name (e.g. `✳ `, `⠐ `) and use the remainder as the resume ID
3. Manual override: edit `claudeSessionId` in `sessions.json` and restart

Auto-detection: if PTY output contains a UUID or `conv_`-prefixed ID, it is automatically saved to `claudeSessionId`.

### Session Type Detection

- Typing `claude` and pressing Enter → session is automatically tagged as `type: "claude"`

---

## URL Routing

Each subdirectory maps to a URL:

| URL | Behavior |
|-----|----------|
| `http://<IP>:7681/` | Shows dir picker modal; navigate to a subdir URL after selection |
| `http://<IP>:7681/project-a` | Auto-attaches to (or creates) a `project-a` session; only shows `project-a` tabs |
| `http://<IP>:7681/project-b` | Auto-attaches to `project-b` session; only shows `project-b` tabs |

- Navigating to root URL → dir picker opens automatically (lists all subdirs of `~/git`, sorted alphabetically)
- Selecting a directory → URL updates to `/<dirname>`, session is auto-attached or created
- Session tab bar only shows sessions belonging to the current URL's directory
- Switching session tabs → URL updates automatically
- Browser back/forward navigates between sessions
- Base directory: `~/git` (controlled by `BASE_DIR`)

---

## Frontend Toolbar

| Button | Sends |
|--------|-------|
| Tab | `\t` |
| Enter | `\r` |
| ls | `ls\r` |
| cd | `cd ` (no Enter) |
| clear | `clear\r` |
| ⌫ | `\x7f` (backspace) |
| ^C | `\x03` (SIGINT) |
| 1 / 2 / 3 | digit characters |
| claude | `claude\r` + rename session to "Claude" |
| ▲▼◀▶ | ANSI arrow sequences |

The session `×` close button has double-confirm protection: first click turns it `?` (orange), a second click within 2 seconds confirms the kill.

---

## Session Naming

- New sessions created via `+` are auto-named `session_1`, `session_2`, etc.
- Name changes to the Claude session name only after the user renames it (via the `claude` button or by typing the command).

---

## Directory Structure

```
claudeterm/
├── CLAUDE.md
├── sessions/               # Persisted session state (auto-managed)
│   ├── project-a/
│   │   └── sessions.json
│   └── <subfolder>/
│       └── sessions.json
└── web-terminal/
    ├── server.js           # Express + WebSocket + node-pty server
    ├── package.json
    ├── package-lock.json
    └── public/
        └── index.html      # Frontend: xterm.js + session bar + toolbar + dir picker
```

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `WEB_TERM_USER` | `admin` | Basic Auth username |
| `WEB_TERM_PASS` | `admin` | Basic Auth password |
| `PORT` | `7681` | Listening port |
