# applypipe specs

| File | What's in it |
|---|---|
| `01-product.md` | Pitch, user, core loop, features with acceptance criteria, out of scope |
| `02-architecture.md` | Stack, system diagram, directory layout, data model, module contracts, external services, config |
| `03-screens.md` | Every surface the owner sees: Discord, the in-page review aid, the CLI — with states |
| `04-build-plan.md` | Nine ordered phases, each with tasks, files and how to verify |
| `05-decisions.md` | Decision log, rejected alternatives, defaults, open questions |

## How to build from these specs

1. Read `../CLAUDE.md` (rules) and `01-product.md` (what and why).
2. Read `02-architecture.md` fully before writing code — the data model and the adapter/answer-provider contracts are shared by every phase.
3. Build one phase from `04-build-plan.md` at a time. Each phase ends with something runnable; check its acceptance criteria, then commit.
4. Where a spec says **Default**, implement the default. Where `05-decisions.md` lists an **Open question**, use the stated interim default and leave a `// OPEN:` comment pointing to it.

Scope covered here: **MVP (Phases 1–6)** and **V2 answer brain (Phases 7–9)**. V3 items are listed in `01-product.md` → Out of scope; don't build them.
