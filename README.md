# OSINT Resources

A categorized, searchable directory of OSINT (open-source intelligence) tools, shown as an interactive tree. Each resource comes with a short description, tags, a suggested use case (`bestFor`) and a `caution` about legal, ethical or reliability limits.

It is a static directory: no accounts, no backend, no API. The catalog is a single JSON file, and your favorites stay in your browser.

## Live Demo
Visit [Osint](https://osint-myk17.vercel.app) for a live demo.

## Features

- **Tree view:** categories expand into resources, with animated layout (respects `prefers-reduced-motion`).
- **Search:** filters across name, URL, description, tags, `bestFor` and `caution`.
- **Favorites:** star resources and filter to them with the star button or by typing `@favorites` (optionally followed by a search term, e.g. `@favorites phone`).
- **Resource drawer:** details, caution, "Go to Link" and "Copy URL" actions. Only well-formed `https` links are ever opened or copied.
- **Light, dark and system themes.**
- **Keyboard and screen-reader support:** labelled search whose result count is announced, a labelled tree, and focus restored after the drawer closes.

## Tech stack

Next.js (App Router), React, TypeScript, Tailwind CSS, Base UI / shadcn components, d3-hierarchy (tree layout), motion (animation), next-themes, Vitest.

## Getting started

Requires the Node.js version in [`.nvmrc`](.nvmrc).

```bash
npm ci          # install exactly what package-lock.json specifies
npm run dev     # http://localhost:3000
```

### Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Start the development server |
| `npm run build` | Production build |
| `npm start` | Serve the production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | Type-check the app and the tests |
| `npm test` | Run the Vitest suite once |
| `npm run test:watch` | Vitest in watch mode |
| `npm run validate:catalog` | Check `data/osint-resources.json` against the catalog rules (see below) |

CI (`.github/workflows/ci.yml`) validates the catalog, then runs lint, typecheck, test and build on every push to `main` and on every pull request. Dependabot (`.github/dependabot.yml`) opens weekly update PRs, which go through the same checks.

## Project structure

```
app/                       Next.js layout, page, global styles
components/osintTree.tsx   Search, favorites toggle, tree and drawer wiring
components/osint-tree/     Tree logic: build, filter, layout, favorites, search status,
                           catalog validation, URL guard, and the tests for all of it
components/ui/             Shared UI primitives
data/osint-resources.json  The catalog
scripts/ship.sh            One-command branch, PR and squash-merge (see Contributing)
.github/                   CI workflow and Dependabot config
```

## The catalog

All content lives in [`data/osint-resources.json`](data/osint-resources.json). The shape is defined in [`components/osint-tree/osint-types.ts`](components/osint-tree/osint-types.ts):

```jsonc
{
  "title": "OSINT-Resources",
  "version": 1,
  "description": "…",
  "categories": [
    {
      "id": "general-search",            // unique, kebab-case
      "name": "General Search",
      "description": "…",
      "resources": [
        {
          "id": "example-com",           // unique across the whole file
          "name": "Example",
          "url": "https://example.com/", // https only
          "description": "What it is and what it is good for.",
          "tags": ["people-search", "public-records"],
          "bestFor": "The use case it suits best.",
          "caution": "Legal, ethical or accuracy caveats."
        }
      ]
    }
  ]
}
```

The catalog is a **curated starter set**, not an exhaustive list. Some categories are still small, and contributions are welcome.

### Adding a resource

1. Pick the category (or add a new one with a unique `id`).
2. Add the resource with a unique `id` and an `https` URL.
3. Fill in **all** of: `description`, `tags`, `bestFor`, `caution`. A resource without a caution is not accepted.
4. Check that the URL works and is the tool's official address.
5. Run `npm run validate:catalog`. It must pass; CI runs the same check.
6. Run `npm run dev`, search for the new entry, and open its drawer.
7. Open a pull request (see below).

`validate:catalog` checks that:

- every category and resource has a unique, kebab-case `id` (unique across the whole file);
- every URL is a valid `https` URL and is not listed twice (a trailing slash or `#fragment` does not make it a different URL);
- every resource has a non-empty `name`, `description`, `bestFor` and `caution`, and at least one kebab-case tag;
- there are no unknown fields, so a typo like `cuation` fails instead of being silently ignored.

Each problem is reported with the entry it belongs to, for example `categories[0] ("general-search").resources[2] ("example-com"): "caution" is required`.

### Inclusion criteria

- The tool works with **publicly available** information.
- The `caution` says what the tool can be misused for and how reliable its results are.
- Dual-use entries (for example IP loggers, criminal-records search, malware analysis) are listed for awareness and defensive or investigative research. They must be described neutrally, with the legal and ethical limits stated.
- No tools that exist mainly to breach, stalk or harass.

## Favorites and theme

- Favorites are saved in `localStorage` under the key `osint-favorites` as a list of resource ids. They are per browser, never sent anywhere, and sync between open tabs. Clearing site data removes them.
- The theme follows your system by default, with a toggle in the header. The choice is stored by `next-themes`.

## Responsible use

This directory points to third-party tools. Use them lawfully, respect privacy and each service's terms, verify findings against independent sources, and do not use results to harass, stalk or expose private individuals. Laws differ by country; you are responsible for staying within yours.

## Contributing

`main` is protected: changes go through a pull request, and the `verify` CI check must pass. You cannot push to `main` directly.

### Quick way: `git ship`

`scripts/ship.sh` does the whole cycle in one command: branch from `main`, commit, push, open a PR, wait for CI, squash-merge, delete the branch and update your local `main`.

**One-time setup**

1. Install the [GitHub CLI](https://cli.github.com/) and run `gh auth login`.
2. In the repository settings (Settings → General → Pull Requests), enable **Allow auto-merge**.
3. Register the alias in your clone (it is not stored in the repo):
   ```bash
   git config alias.ship '!bash scripts/ship.sh'
   ```

The script needs Bash: Linux, macOS, WSL or Git Bash.

**Usage**, from `main`, with your changes in the working tree:

```bash
git ship <branch-name> "<commit message>" [path ...]

git ship feat/new-tool "feat: add Example to General Search" data/osint-resources.json
git ship docs/typo "docs: fix typo"                 # no paths: stages everything
SKIP_CHECKS=1 git ship fix/hotfix "fix: ..." app/   # skip the local lint/typecheck/test run
```

- With paths, **only those paths** are committed; other local changes stay uncommitted. Without paths, everything is staged (`git add -A`). Either way the script shows what will be shipped and asks for confirmation first.
- It runs `npm run lint`, `typecheck` and `test` before pushing.
- If a check fails in CI, the PR stays open and you stay on the branch. Fix it, push, and auto-merge completes the merge once `verify` is green.
- Use it for your own changes. For a Dependabot PR, use `gh pr merge <number> --squash --auto`.

### Manual way

```bash
git switch main && git pull
git switch -c feature/short-name
# make changes, then:
npm run validate:catalog && npm run lint && npm run typecheck && npm test && npm run build
git add <files> && git commit -m "describe the change"
git push -u origin feature/short-name
gh pr create --fill --base main     # or open the PR on GitHub
# wait for the green check, then squash and merge
git switch main && git pull
git branch -D feature/short-name    # -D: a squash merge looks "unmerged" to git
```

## License

This project is licensed under the terms of the MIT [license](/LICENSE.md).
