---
name: compact-skill-rewriter
description: "[rp] Rewrite a skill into compact bullet-point instructions while preserving behavior and constraints. User-initiated only; do not trigger on generic mentions of compact-skill-rewriter."
---

# Compact Skill Rewriter

## Inputs

- Target: read it fully before rewriting.
- Sample style: read `compact-skill-rewriter-sample.md` from the same directory as this `SKILL.md`; abort if missing.
- Mode: `draft` by default; `edit` only when the user explicitly asks to write in place.

## Preserve

- YAML frontmatter unless the user explicitly requests frontmatter or trigger metadata changes.
- Meaning and behavior.
- Hard constraints and bans.
- Tool rules.
- Safety rules.
- Workflow and resume order.
- Output contracts and syntax/behavior-defining examples.
- Resource references and when to read them.
- Interaction rules — when to ask, act, report, and stop.

## Remove

- Roleplay and motivational framing.
- Repeated rationale once the rule is clear.
- Long prose explanations that do not change execution.
- Incidental adjectives and filler.
- Duplicate caveats or warnings.
- Broad expertise claims.
- Filler transitions.
- Overgrown non-contractual examples.

## Rewrite Style

- Bullets over prose.
- Use concrete imperative verbs.
- Put one rule per bullet.
- Nested bullets are allowed one level deep when needed for compact decision tables or subcases.
- Collapse comma-list synonyms to one umbrella term.
- Use prose only for nuance.
- Keep only format-defining examples.
- Use operational headings.
- Keep contractual strings, commands, paths, keys, and labels.
- Do not invent rules, behavior, tools, or files.

## Workflow

1. Read target and sample files; abort if sample is missing.
2. Identify contractual material per Preserve list.
3. Draft the rewrite: apply Rewrite Style, strip items matching Remove, preserve broad rules semantically, and keep exact contractual strings verbatim.
4. Preserve YAML frontmatter exactly unless frontmatter or trigger metadata changes were explicitly requested.
5. Compare draft against the Preserve list; flag any rule that couldn't be compressed safely.
6. Validate draft YAML frontmatter before delivery; abort on parse failure.
7. Deliver per mode.

## Output

- Draft mode (default):
  - Validate draft YAML frontmatter before returning; abort on parse failure.
  - Return the rewritten content.
  - Add notes in chat only: preserved constraints, removals, rules flagged unsafe to compress.
- Edit mode (only when explicitly requested):
  - Validate draft YAML frontmatter before asking to write; abort on parse failure.
  - Show unified diff and ask `y/n/q`.
  - Write only the rewritten content in place on `y`; never write notes into the file.
  - Re-read the file after writing; confirm YAML frontmatter parses.
  - Report: file path, character-count reduction as `old chars -> new chars (delta chars)`, rules flagged unsafe to compress.

## Avoid

- Do not summarize instead of rewriting.
- Do not loosen prohibitions.
- Do not collapse separate workflow steps when order matters.
- Do not paraphrase exact output contracts.
- Do not remove examples that define syntax or behavior.
- Do not add files unless the user asks.
