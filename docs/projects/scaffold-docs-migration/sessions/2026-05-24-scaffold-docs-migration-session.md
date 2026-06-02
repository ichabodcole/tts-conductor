# Session — Migrate Docs to Scaffold-Template Structure

**Date:** 2026-05-24
**Branch:** `feature/migrate-to-scaffold-docs`
**Released as:** N/A — documentation restructure only; no code changes, no publish.

## What shipped

Replaced the flat `docs/{proposals,plans,sessions}/<file>.md` layout with the project-docs scaffold-template structure:

```
docs/
  projects/<name>/{proposal.md, plan.md, sessions/, DEV_KICKOFF.md}
  projects/_archive/<name>/
  architecture/  backlog/  briefs/  fragments/  interaction-design/
  investigations/  lessons-learned/  memories/  playbooks/  reports/
  specifications/
  PROJECT_MANIFESTO.md  PROJECT-SUMMARY.md  AGENTS.md  CLAUDE.md  README.md
```

22 file renames (content-preserved by git's rename detection), 38 scaffold additions (READMEs, TEMPLATEs, .gitkeep placeholders), 4 intentional deletions (`PROJECT-SUMMARY.md` regenerated; `lessons-learned.md` template-only not migrated; two obsolete folder READMEs).

## Workflow shape

Skinny middle path per Cole's pick (not a formal proposal, not a blind dive):

1. **Mapping doc inline in chat.** File-by-file destination table, 5 judgment calls named explicitly with my picks (single archived project for 2026-05-23 sessions, similar for bun-biome, top-level for recently-shipped, regenerate PROJECT-SUMMARY, no immediate archive of recently-shipped). Cole reviewed and greenlit.
2. **Execute migration in two checkpoints.** Commit 1: populate `new-docs/docs/` with migrated content from current paths (leaves old `docs/` intact for safety). Commit 2: cut-over — `git rm -r docs/`, `mv new-docs/docs docs`, `rmdir new-docs/`, stage.
3. **Regenerate PROJECT-SUMMARY.md.** Full rebuild via the project-summary skill (existing summary was 2 days old but predated alpha.0/alpha.1 and the migration itself). Skipped sub-explorer dispatch — project is small enough for direct synthesis.
4. **Independent code review.** `feature-dev:code-reviewer` subagent against the mapping table.
5. **Fix review findings.** Two real issues caught: link rot (18 stale paths across 6 active docs) and off-by-one count (10 vs 11 sessions in the alpha-0-publish-prep sprint).
6. **Squash to single commit, fast-forward merge.**

## Surprises and learnings

### Link rot in migrated docs

The biggest miss in my migration planning: I moved files but didn't update cross-references inside the moved files. Reviewer caught 18 stale references across 6 active docs. Active docs (proposal, plan, DEV_KICKOFF, recent session docs) referenced their siblings by old absolute paths (`docs/proposals/foo.md`) that no longer existed post-migration.

The fix shape was straightforward — relative paths within a project folder (`./proposal.md`, `../plan.md`) and corrected absolute paths for cross-project references (`docs/projects/<other-project>/sessions/...`). But the fact that the planning phase didn't surface link rot as a category-of-work is a generalizable lesson.

**Lesson:** when moving files that cross-reference each other, the file-by-file mapping table needs a second pass: "for each file moving, what other files does it reference, and do those references need updating?" Doing it as a third commit post-rename is fine for small migrations; doing it inline during the rename would be cleaner for larger ones.

### Historical artifacts vs. active docs

The reviewer's instinct to NOT flag stale paths in `_archive/` was the right call. The bun-biome session doc and the 11 alpha-0-publish-prep sessions reference `docs/backlog.md` and `docs/sessions/...` paths that were correct at the time of writing. Updating them retroactively would be revisionist — those docs are point-in-time records, not actively-followed paths.

Worth pinning explicitly: **archived docs are frozen history.** Don't update cross-references in them post-restructure. Only update active docs.

### The mapping table needs to count

Off-by-one error in two places (PROJECT-SUMMARY.md line 86 and discovery report's "10 named sessions" enumeration). 11 sessions, not 10 — I missed `docs-polish-pre-publish` in my mental count when drafting both the mapping table and the summary. The reviewer caught both.

**Lesson:** when enumerating file counts in narrative form ("10 sessions"), run the actual count via `ls | wc -l` before committing the prose to disk. Don't trust the mental count, especially when the work itself involves shuffling file lists.

### The skinny middle path worked

Compared to "full proposal first" (which would have added 30-60 minutes of doc-write-then-review) and "blind dive" (which would have skipped the alignment step), the inline-mapping-doc shape was the right move for this scope. Cole could skim a single message, validate the 5 judgment calls explicitly, and greenlight execution in a single exchange. Worth keeping as a pattern for medium-sized work where decisions are concrete and Cole's the only reviewer.

## Hard gates that passed

- `bun run check` clean (no code changed; cached test pass)
- Independent code review by `feature-dev:code-reviewer` subagent
- All review findings (link rot + off-by-one) fixed before merge
- 22 git-detected renames verified by the reviewer against the mapping table — all destinations correct
- Final stale-path sweep across active docs returned zero residual references to old paths

## Related Documents

- Bridge entry / inline mapping: this conversation's inline mapping table (not durable; this session doc is the durable record of the mapping decisions)
- Prior session (publish-build-safety): `docs/projects/publish-build-safety/sessions/2026-05-24-publish-build-safety-session.md` — closed the dist failure mode immediately before this migration
- Scaffold source: `https://github.com/ichabodcole/project-docs-scaffold-template` (Cole's template repo; the `new-docs/docs/` folder was a pre-staged clone of this scaffold)
