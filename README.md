# OSINT Resources

A categorized, searchable directory of OSINT (open-source intelligence) tools, shown as an interactive tree. Each resource comes with a short description, tags, a suggested use case (`bestFor`) and a `caution` about legal, ethical or reliability limits.

It is a static directory: no accounts, no backend, no API. The catalog is a single JSON file, and your favorites stay in your browser.

## Features

- **Tree view:** categories expand into resources, with animated layout (respects `prefers-reduced-motion`).
- **Search:** filters across name, URL, description, tags, `bestFor` and `caution`.
- **Favorites:** star resources and filter to them with the star button or by typing `@favorites` (optionally followed by a search term, e.g. `@favorites phone`).
- **Resource drawer:** details, caution, "Go to Link" and "Copy URL" actions. Only well-formed `https` links are ever opened or copied.
- **Light, dark and system themes.**
- **Keyboard and screen-reader support:** labelled search and tree, focus restored after the drawer closes.

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

CI (`.github/workflows/ci.yml`) runs lint, typecheck, test and build on every push to `main` and on every pull request.

## Project structure

```
app/                       Next.js layout, page, global styles
components/osintTree.tsx   Search, favorites toggle, tree and drawer wiring
components/osint-tree/     Tree logic: build, filter, layout, favorites, URL guard, tests
components/ui/             Shared UI primitives
data/osint-resources.json  The catalog
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
5. Run `npm run dev`, search for the new entry, and open its drawer.
6. Open a pull request (see below).

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

`main` is protected: changes go through a pull request, and the `verify` CI check must pass.

```bash
git switch main && git pull
git switch -c feature/short-name
# make changes, then:
npm run lint && npm run typecheck && npm test && npm run build
git add -A && git commit -m "describe the change"
git push -u origin feature/short-name
# open a PR into main, wait for the green check, squash and merge
```

## License

Not yet specified. Add a `LICENSE` file before accepting outside contributions.
