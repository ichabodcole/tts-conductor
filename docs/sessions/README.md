Sessions README

Purpose

- Sessions capture a concise, chronological record of focused work (e.g., upgrades, bug hunts, refactors, feature slices).
- They make it easy to resume work later and audit changes without reading commits or logs.

When to Create a Session

- At the start of a new, non‑trivial task that will involve multiple steps or touch several files.
- If a same‑day session with the same topic exists, continue there instead of creating a new one.

File Naming

- `YYYY-MM-DD-short-topic.md`
- Examples:
  - `2025-09-06-upgrade-test-fix-session.md`
  - `2025-08-15-job-queue-stability-session.md`

Recommended Structure

- Context — Background and what changed.
- Scope & Objectives — Boundaries and goals.
- Plan — Short, verifiable steps (5–7 words each).
- Environment — Runners, configs, cautions (e.g., cleanup commands).
- Findings Log — Timestamped notes as you learn things.
- Fixes Applied — Concrete changes made.
- Open Questions — Decisions or clarifications needed.
- Lessons Learned — Tips for future similar work.
- Next Steps — Optional checklist for handoff/continuation.

Starter Template

```
# <Topic> — YYYY-MM-DD

Context

- <why this session exists>

Scope & Objectives

- <what’s in>
- <what’s out>

Plan

1. <step>
2. <step>
3. <step>

Environment

- Test runner: <tool>
- Notes: <any important cautions>

Findings Log

- YYYY-MM-DD HH:MM — <note>

Fixes Applied

- <change summary>

Open Questions

- <question>

Lessons Learned

- <lesson>

Next Steps

- <action>
```

Agent Duties (TL;DR)

- Create a new session file at the start of qualifying work (see naming above).
- Keep it updated as you proceed; don’t wait until the end.
- Use the plan tool to reflect current steps and status.
- Prefer minimal, high‑signal notes and actionable bullets.

Tips

- Link to relevant files with repository‑relative paths for quick navigation.
- Record deviations (e.g., updated tests to new API behavior) under “Fixes Applied” with rationale.
- When tests are involved, include a short summary of pass/fail counts and any skipped areas.
