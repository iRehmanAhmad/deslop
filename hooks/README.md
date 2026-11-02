# deslop as a Claude Code hook

The skill asks the agent to run deslop before calling UI work done. A
**PostToolUse hook** makes that automatic: every time Claude edits or
writes a UI file, deslop scans just that file and any findings are printed
into the tool result, where the agent sees them immediately.

The hook **never blocks**: it always exits 0, stays silent on clean
files, and does nothing when the edited file is not a UI file deslop
understands (`.css .scss .html .jsx .tsx .vue .astro .svelte`).

## Setup (2 minutes)

1. Make the script executable:

   ```bash
   chmod +x /path/to/deslop/hooks/deslop-hook.sh
   ```

2. Add the snippet from
   [`post-tool-use.example.json`](post-tool-use.example.json) to your
   Claude Code settings — `.claude/settings.json` for one project, or
   `~/.claude/settings.json` for everywhere — replacing
   `/absolute/path/to/deslop` with the real path of this repo:

   ```json
   {
     "hooks": {
       "PostToolUse": [
         {
           "matcher": "Edit|Write",
           "hooks": [
             {
               "type": "command",
               "command": "/path/to/deslop/hooks/deslop-hook.sh"
             }
           ]
         }
       ]
     }
   }
   ```

3. Done. Edit a UI file with Claude and watch for a
   `deslop findings in <file>` note in the tool result.

## How it works

`deslop-hook.sh` reads the hook's JSON from stdin, extracts
`tool_input.file_path`, and runs `bin/deslop.js` on that single file. By
default it uses the `bin/deslop.js` from the repo the script lives in. If
you keep the hook somewhere else, point it at your scanner:

```bash
DESLOP_BIN=/path/to/deslop/bin/deslop.js
```

(set it in the `command` line: `DESLOP_BIN=... /path/to/deslop-hook.sh`).

If a finding is deliberate, waive it inline with a reason —
`deslop-ignore: <rule-id> — <why>` — and the hook stays quiet about it
(see "Config & waivers" in the root README).
