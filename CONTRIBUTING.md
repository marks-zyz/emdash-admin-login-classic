# Contributing

Thanks for looking. This package is small on purpose, so the first thing to know is its scope.

## Scope

EmDash Admin Login Classic brings the classic WordPress login to the EmDash **admin**: email and password, forgot password by email, a page to manage your own password, and a way for an administrator to hand over an access. That is the whole job.

Pull requests and issues that add public sign-up, social login, 2FA, organizations, API keys or pages outside the admin will be declined, kindly and with a pointer to a full plugin such as [emdash-better-auth](https://www.npmjs.com/package/emdash-better-auth). Changes that make the existing flows safer, clearer, better translated or easier to test are very welcome, and so are bug reports with a way to reproduce.

If you are unsure, open a [discussion](https://github.com/marks-zyz/emdash-admin-login-classic/discussions) before writing code.

## Naming

Anything that lives in a namespace shared with other packages (plugin and provider ids, API routes, Worker secrets, keys in shared tables) derives from `SLUG` in `src/lib/config.ts` (the npm name without `emdash-`; never start it with `login`, `register`, `dev-bypass` or `setup`, which the core treats as public route prefixes). Never write one by hand: the rate-limit keys come from `rateKey()` and the e2e test imports the constants. A new shared identifier follows the same rule, and a page path under `/_emdash/admin/plugins/<plugin id>/` needs no prefix.

## Setup

You need [Bun](https://bun.sh).

```sh
bun install
bun run typecheck
bun run test
```

CI runs the same two commands on every pull request.

## Trying a change in a real site

Pack the package and install the tarball in an EmDash site:

```sh
bun pm pack
# in the site:
bun add /path/to/emdash-admin-login-classic-<version>.tgz
```

Do not use `npm link` or `bun link`. The Cloudflare dev runner refuses to read files outside the project root, a symlink puts the sources there, and the site answers 500 with `Denied ID` and nothing in the message points at the symlink. A tarball is also closer to what users install.

## End-to-end test

`test/e2e` drives every flow in a real browser (Chromium or WebKit) against a local EmDash dev site that uses the package. It writes tokens straight into the site's local D1, so it only ever runs against a dev database.

```sh
cd test/e2e
bun install
SITE=/path/to/site D1=/path/to/local.sqlite LOCALE=en bun run.mjs chromium
```

| Variable | Meaning |
| --- | --- |
| `SITE` | the site project path (used to load `@emdash-cms/auth`) |
| `D1` | the site's local D1 sqlite file, under `.wrangler/state/v3/d1` |
| `BASE` | dev server URL, default `http://localhost:4321` |
| `LOCALE` | the `locale` the site passes to the package, default `en`; texts are read from `src/locales` |
| `ONLY` | comma list of flows, for example `F3,F8`; each flow brings the ones it builds on |

The site needs the `dev@emdash.local` user that EmDash creates for its dev bypass. Run it before a release and whenever sign-in, reset, invite or Team access changes. A form tested only with curl once passed and then failed for the first real person, so this test exists.

## Adding a language

1. Copy `src/locales/en.ts` to `src/locales/<tag>.ts` (for example `es.ts`, or `pt-PT.ts`). Type it as `Strings`, as `pt-BR.ts` does.
2. Translate every value. Keep the placeholders of the functions (`site`, `url`, `email`, `password`, `n`, ...): a test fails if one is dropped.
3. Replace the `words` list with 256 or more short common words of your language, lowercase, ASCII only, so every keyboard can type them, and easy to dictate over the phone. Four of them plus a number become a temporary password.
4. Register it in `src/lib/i18n.ts`: add the import and one entry to `LOCALES`.
5. Run `bun run test`. It checks the keys, the placeholders, the roles, the word list and that no em or en dash is used in user-facing text.
6. If the e2e test should run in your language, also add the wording of EmDash's own screens to `CORE` at the top of `test/e2e/run.mjs`.

## Pull requests

- Say what changes and why, and how you tested it. The template has a checklist.
- Keep the change small. One idea per pull request.
- Add a line to `CHANGELOG.md`.
- Comments explain a decision or a trap, never what the next line does.
- AI-assisted contributions are welcome. Say so in the description and read every line before you send it.

## Security

Do not open public issues for vulnerabilities. Follow [SECURITY.md](SECURITY.md).

## Releases (maintainers)

The version in `package.json` is the release. Bumping it on `main`, with its `CHANGELOG.md` entry, makes the publish workflow run the tests and publish to npm through trusted publishing (OIDC, with provenance). A push that does not change the version publishes nothing.

The very first publish of a package is manual, because npm only links a trusted publisher to a package that exists: `npm login`, `npm publish --access public`, then `npm trust github emdash-admin-login-classic --file publish.yml --repo marks-zyz/emdash-admin-login-classic --allow-publish -y`. Until then the workflow only leaves a notice. After that, do not publish from a laptop.
