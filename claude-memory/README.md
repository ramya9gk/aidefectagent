# Claude Project Memory (backup)

This folder is a **backup** of the Claude Code project-memory files for BugForge AI.
It exists so the accumulated project knowledge is version-controlled and survives a
machine change. The `.md` files here are notes Claude wrote about this project
(deployment, credential model, gotchas, etc.).

## ⚠️ Claude does NOT auto-load memory from this folder

Claude Code only reads project memory from a per-machine location **outside the repo**:

```
<user-home>/.claude/projects/<sanitized-cwd>/memory/
```

- `<user-home>` = your home dir (e.g. `C:\Users\<you>` or `~`)
- `<sanitized-cwd>` = the project's working-directory path with `\`, `/`, and `:`
  replaced by `-` (e.g. `C:\Users\RamyaBIN` → `C--Users-RamyaBIN`)

Nothing in the repo is loaded automatically. Committing these files makes them
**portable**, not **active**.

## Activating on a new machine (one-time copy)

After cloning the repo on a new machine, copy these files **once** into the
per-machine memory path so Claude will load them:

**PowerShell (Windows)**
```powershell
$dst = "$HOME\.claude\projects\C--Users-RamyaBIN\memory"   # adjust sanitized-cwd to your path
New-Item -ItemType Directory -Force -Path $dst | Out-Null
Copy-Item .\claude-memory\*.md $dst -Force
```

**bash (macOS/Linux)**
```bash
dst="$HOME/.claude/projects/<sanitized-cwd>/memory"
mkdir -p "$dst"
cp ./claude-memory/*.md "$dst"/
```

> Adjust `<sanitized-cwd>` to match the working directory you launch Claude from
> on that machine. Then start Claude Code — it will pick up `MEMORY.md` (the index)
> and the linked memory files automatically.

## Keeping the backup in sync

When Claude updates its memory during a session, re-run the copy in the **other**
direction to refresh this backup, then commit:

```powershell
Copy-Item "$HOME\.claude\projects\C--Users-RamyaBIN\memory\*.md" .\claude-memory\ -Force
```

## Files

- `MEMORY.md` — the index Claude loads each session (one line per memory).
- `bugforgeai-deploy-and-credentials.md` — deploy mechanism + credential model notes.
