## Compact skill rewriter sample

### Target style

- Start with operational content; no introductions.
- Prefer headings such as `Goal`, `Rules`, `Workflow`, `Output`, and `Avoid`.
- A synthesized `Goal` is allowed when it summarizes the source's stated purpose; do not introduce new scope.

### Example 1: frontmatter preservation

#### Before

```
---
name: config-review
description: Review configuration files for risky settings and secret exposure.
---

# Config Review

This skill helps the assistant carefully review configuration files. The assistant
should read the whole file before giving advice and should not print secret values
in full.
```

#### After

```
---
name: config-review
description: Review configuration files for risky settings and secret exposure.
---

# Config Review

## Goal

- Review configuration files without exposing secrets.

## Rules

- Read the full target file before advising.
- Never print secret values in full.
```

### Example 2: rule-heavy skill

#### Before

```
---
name: example-verbose-skill
description: Review or edit configuration files without exposing secrets.
---

# Example Verbose Skill

This skill helps the assistant carefully review a configuration file. It is important
to be very careful because configuration files can be sensitive, and it is also
important to remember that changes should not be made unless the user clearly asked
for them. The assistant should bring strong judgment to the task and act like an
experienced operator who understands configuration systems.

When the user asks for a review, the assistant should read the whole file before
giving advice. If the file references another local configuration file, the assistant
should also read that referenced file because otherwise it may miss an important
constraint. The assistant should not modify any files during review mode. This is
important because the user asked for a review, not an edit. If the user asks for an
edit, then the assistant may update the file, but it should preserve comments that
explain security or deployment constraints.

The final answer should explain any risks. For example, if a setting named
`allow_remote_admin: true` appears, the assistant should call out that risk and cite
the line. The assistant should not give a vague answer. The assistant should never
print secret values in full, even if they are present in the file, because secrets
are sensitive and should not be repeated in chat.
```

#### After

```
---
name: example-verbose-skill
description: Review or edit configuration files without exposing secrets.
---

# Example Verbose Skill

## Goal

- Review or edit configuration files without exposing secrets.

## Rules

- Read the full target file before advising or editing.
- Read each local config file referenced by the target.
- Review mode: do not edit files.
- Edit mode: preserve comments that explain security or deployment constraints.
- Never print secret values in full.

## Workflow

1. Determine whether the user requested review or edit mode.
2. Read the target and required referenced files.
3. Identify risks with line references.
4. Edit only when explicitly requested.

## Output

- Cite risky settings by file and line.
- For `allow_remote_admin: true`, call out remote admin exposure.
- Keep secret values redacted.
```

### Example 3: workflow-ordered skill

#### Before

```
---
name: export-cleaner
description: Remove old archived exported reports without deleting audit-held exports.
---

# Export Cleaner

When the user wants to remove old exported reports, this skill walks through
them and deletes only the safe ones. Some exports may still be needed for audits,
so the assistant should be careful. The workflow goes like this:

1. First the assistant should run `reports exports list --older-than 30d` to list
   old exports.
2. Then for each export, check its status using `reports exports inspect <id>`.
   If the export is marked `archived`, it is safe to delete.
3. For exports that are not archived, the assistant should check whether they
   are marked `audit_hold`. If yes, the export is unsafe and must be skipped.
4. Show the list of safe-to-delete exports to the user.
5. Ask the user to confirm each deletion individually. No batch mode.
6. Delete only after the user explicitly types `y` for each export.

Never delete exports marked `audit_hold`. Always delete by exact export ID so
similarly named exports are not affected.
```

#### After

```
---
name: export-cleaner
description: Remove old archived exported reports without deleting audit-held exports.
---

# Export Cleaner

## Goal

- Delete old archived exports without removing audit-held exports.

## Workflow

1. List old exports: `reports exports list --older-than 30d`.
2. Classify each export with `reports exports inspect <id>`:
   - `audit_hold` → unsafe; skip.
   - `archived` and not `audit_hold` → safe.
   - Neither status → unsafe; skip.
3. Show the safe list to the user.
4. Ask `y/n` per export.
5. Delete the export on `y`, using the exact export ID.

## Rules

- Never delete exports marked `audit_hold`.
- Delete by exact export ID.
- Confirm per export; no batch mode.
```
