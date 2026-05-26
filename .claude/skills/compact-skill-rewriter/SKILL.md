---
name: compact-skill-rewriter
description: "[rp] Rewrite a skill in place into compact bullet-point instructions while preserving behavior and constraints. User-initiated only; do not trigger on generic mentions of compact-skill-rewriter."
---

# Compact Skill Rewriter

## Inputs

- Target skill: read its `SKILL.md` fully before rewriting.
- Sample style: read `compact-skill-rewriter-sample.md` from the same directory as this `SKILL.md`; abort if missing.
- Edit policy: write the rewrite directly to the target `SKILL.md`; rely on git version control for review or revert.

## Preserve

- YAML frontmatter — leave it exactly as-is unless the user explicitly asks to change it (e.g. to update the trigger description).
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
3. Rewrite the target: apply Rewrite Style and follow the sample as a worked example, strip items matching Remove, preserve broad rules semantically, keep exact contractual strings verbatim, and leave YAML frontmatter unchanged unless the user asked for frontmatter changes.
4. Compare rewritten content against the Preserve list; flag any rule that couldn't be compressed safely.
5. Validate rewritten YAML frontmatter before writing; abort on parse failure.
6. Write only the rewritten content in place; never write notes into the file.
7. Re-read the file after writing; confirm YAML frontmatter parses.

## Output

- Report: file path, character-count reduction as `old chars -> new chars (delta chars)`, rules flagged unsafe to compress.
- Do not return the full rewritten file unless the user explicitly asks.

## Avoid

- Do not summarize instead of rewriting.
- Do not loosen prohibitions.
- Do not collapse separate workflow steps when order matters.
- Do not paraphrase exact output contracts.
- Do not remove examples that define syntax or behavior.
- Do not add files unless the user asks.
