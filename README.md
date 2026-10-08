# EmDash Admin Login Classic

Email and password sign-in for the [EmDash](https://github.com/emdash-cms/emdash) admin, the way classic WordPress does it. Passkeys and the email link keep working next to it.

[![npm](https://img.shields.io/npm/v/emdash-admin-login-classic)](https://www.npmjs.com/package/emdash-admin-login-classic)
[![ci](https://github.com/marks-zyz/emdash-admin-login-classic/actions/workflows/ci.yml/badge.svg)](https://github.com/marks-zyz/emdash-admin-login-classic/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

## Why this exists

EmDash 1.1 signs people in to the admin with passkeys, an email link or an OAuth provider. That is a sound default. But we hand finished sites to lawyers, shop owners and small agencies who edit a few times a week, switch phones, and expect what WordPress gave them since 2003: an address, a password in their password manager, and "forgot my password" by email. A passkey made on one device is gone with that device, and one made on a staging domain does not follow the site to its final domain. Every one of those ends in a message to whoever built the site.

This package gives those editors the login they already know, and nothing else.

## What it is, and what it is not

It is a small auth provider plus one native plugin:

- **Sign in with email and password**, on EmDash's own login page. A button next to the passkey and email-link buttons opens the form.
- **Forgot my password**, by email, through EmDash's own link-confirmation screen. The link works once, for 30 minutes, and goes out through the email provider the site already uses.
- **My access**: a page inside the admin where any signed-in person sets, changes or removes their own password and sees whether they have a passkey, with a link to EmDash's Security page to create one. A person can have both. Removing the password needs at least one passkey.
- **Team access**: a page for administrators to create someone's access with a generated temporary password (four words and a number) and copy a ready message to send. Nothing for the client to confirm and no passkey to register. On the first sign-in the person is invited, never forced, to choose their own password, and is offered a passkey once.
- **Invites accepted with a password**: EmDash's invite page gets an "Accept and use a password" button.

It is **not** a competitor to full authentication plugins such as [emdash-better-auth](https://www.npmjs.com/package/emdash-better-auth), which is built for public apps and membership sites: sign-up pages, social login, passwordless, 2FA, organizations, billing. If your visitors need accounts, use one of those. This package has no public sign-up, no social login, no 2FA and no pages outside the admin, and it will stay that way. The goal is to be small enough to read in an afternoon and to trust with the keys of a client's site.

## Quick start

```sh
npm install emdash-admin-login-classic
```

```js
// astro.config.mjs
import { passwordAuth, passwordPlugin } from "emdash-admin-login-classic";

emdash({
	siteUrl: "https://example.com", // required: the reset link is built from it
	authProviders: [passwordAuth()], // passwordAuth({ locale: "pt-BR" }) forces a language
	plugins: [passwordPlugin()], // the My access and Team access pages; same locale option
});
```

Set a Worker secret of at least 32 characters. The routes answer `NOT_CONFIGURED` until it exists.

```sh
openssl rand -base64 48 | npx wrangler secret put EMDASH_ADMIN_LOGIN_CLASSIC_SECRET
```

For local development put the same variable in `.dev.vars`. On Node hosts it is read from `process.env`.

Forgot password needs an email provider selected in Settings > Email; without one that route answers `EMAIL_NOT_CONFIGURED` and sign-in still works. The reset link is built from `siteUrl` (or `EMDASH_SITE_URL`), then from the site URL EmDash saved at setup, and never from the request's host. With none of them the link is not sent and the error is logged.

## With the classic admin theme

With [emdash-admin-theme-classic](https://www.npmjs.com/package/emdash-admin-theme-classic) 0.3.1 or newer, the sign-in card puts the password button first and filled, and turns the passkey and email-link options into two buttons of equal weight below "Or continue with". The theme finds this package by the `data-auth-provider="password"` attribute on its button, so there is nothing to configure. Without the theme, EmDash's own layout is untouched.

## Languages

English and Brazilian Portuguese ship with the package. The language is the `locale` option, then the browser's `Accept-Language`, then English. The emails, the admin pages, the menu labels and the temporary-password word list all come from one file per language in [`src/locales`](src/locales). Adding a language is one file and one line, described in [CONTRIBUTING.md](CONTRIBUTING.md#adding-a-language). A test fails if a translation misses a key or drops a placeholder.

## How sign-in is protected

| Area | Decision |
| --- | --- |
| Hash | PBKDF2-SHA256, 100,000 iterations, 16-byte salt per password. 100,000 is the ceiling of Cloudflare's production runtime (`DEFAULT_MAX_PBKDF2_ITERATIONS` in workerd): a local `wrangler dev` accepts more and production rejects it. scrypt was measured and left out: about 32 MB per hash inside a Worker that also serves the public site, against a 128 MB limit. |
| Secret pepper | The password goes through HMAC-SHA256 with `EMDASH_ADMIN_LOGIN_CLASSIC_SECRET` before PBKDF2. EmDash backups include `_plugin_storage`, so the hashes travel with every backup file; without the Worker secret they cannot be attacked offline. Rotating the secret invalidates every password and people use Forgot password again. |
| Sign-in limits | In D1, shared by every isolate: 5 attempts per account from one IP (IPv6 grouped by /64), 30 per account from all IPs, 20 requests per IP, each per 15 minutes. Counted before the password check, so a parallel burst cannot slip through, and cleared by a successful sign-in. Someone on another network cannot lock the owner out with 5 wrong tries. |
| Forgot limits | 10 requests per IP per 15 minutes; per account, 3 emails per hour from one IP and 10 from all IPs, answered silently (a 429 would confirm the address is targeted). |
| No enumeration | An unknown email, an account without a password and a wrong password get the same 401 after the same hashing work. "Account disabled" only appears after the right password. Forgot gives one answer for every email, and on Cloudflare the token and the email go out after the response (`waitUntil`), so timing does not tell accounts apart. |
| Sessions | A new session id on every sign-in, so a cookie planted beforehand cannot be promoted. |
| Private routes | My access and Team access talk to private routes: EmDash's middleware requires the session and the `X-EmDash-Request` header, and these routes also refuse API tokens, so a leaked token cannot plant a password. Team access additionally checks the Administrator role (an API token needs the `admin` scope). Every password change emails a notice to the account. |
| CSRF | Sign-in, forgot and invite are EmDash public routes: the core rejects them when `Origin` is another site, and this package's own requests send `X-EmDash-Request`. |
| Password rule | 10 to 256 characters, no composition rules (NIST SP 800-63B). |
| Temporary passwords | Four words from a fixed list of about 300 plain words per language and a number from 10 to 99, drawn with `crypto.getRandomValues` and rejection sampling: about 39 bits. Online, the per-account limit allows about 2,900 guesses a day; offline, the pepper keeps the hash useless without the Worker secret. Shown once, never stored in clear. |

## What it stores

No migration and no table of its own:

| Where | What |
| --- | --- |
| `_plugin_storage`, `auth:admin-login-classic` / `credentials` | one password hash per user id, plus `temporary` (created by an administrator, not replaced yet), `welcomed` (the first sign-in already happened) and `passkeyOfferDismissed` |
| `auth_tokens` (EmDash), type `recovery` | SHA-256 of each reset token, user id and expiry, consumed by EmDash's own magic-link verification |
| `_emdash_rate_limits` | attempt counters, with the email and IP hashed into the key |

Users, roles, invites and sessions stay in EmDash.

Every identifier that lives in a namespace shared with other packages carries the slug `admin-login-classic` (the npm name without `emdash-`, unique among packages named `emdash-*`): the provider and plugin ids, the API routes under `/_emdash/api/auth/admin-login-classic/`, the storage namespace, the Worker secret `EMDASH_ADMIN_LOGIN_CLASSIC_SECRET` and the rate-limit keys. Page paths such as `/team` need no prefix: they already sit under `/_emdash/admin/plugins/<plugin id>/`. The one deliberate exception is the attribute `data-auth-provider="password"`, which names the kind of sign-in, so a theme can treat any password provider alike.

## Known limits

- Changing a password does not end sessions that are already open, and reset links already sent stay valid until used or expired. EmDash keeps sessions in the Astro session store with no per-user index. Disabling the user in EmDash ends the sessions.
- The email-link confirmation screen is EmDash's own and its POST does not renew the session id.
- On the sign-in page the core prints its own help line under any provider form ("Enter your handle to sign in.").
- EmDash has no setting to hide the passkey button, so it stays first unless you use the classic theme ([discussion #2887](https://github.com/emdash-cms/emdash/discussions/2887)).
- EmDash shows every plugin page to every role, so "Team access" tells non-administrators it is for administrators only. Hiding the menu item needs a role filter on the site side ([discussion #3034](https://github.com/emdash-cms/emdash/discussions/3034)).
- A person who joins by invite also sees EmDash's own welcome dialog over "My access" on the first visit.
- "My access" lives in the sidebar, not in Settings > Security or the profile menu: EmDash 1.1 has no extension point in either.
- EmDash refuses to delete a person's last passkey ("Cannot remove your last passkey"), because it does not know a password exists. Someone with a password who wants to drop passkeys entirely cannot do it from the Security page.
- Only Cloudflare Workers is tested end to end. The Node paths (`process.env`, no `waitUntil`) exist but have not been exercised in a browser.

## Where this should live

We would rather this stayed small and, one day, unnecessary. Most of what the package has to work around is something only EmDash core can fix properly: a way to hide the passkey button, a form slot on the invite page, grouping sign-in methods by kind, a section for providers in Settings > Security, and a minimum role per plugin page. Each of those is discussed in the EmDash repository. If you want email and password to become a first-class option, or this package to be listed as a recommended one, say so in those threads. Pull requests here are welcome too.

## Compatibility

| Package | EmDash | Tested on |
| --- | --- | --- |
| 0.5.x | `>=1.1.0 <1.2.0` | Astro 7, Cloudflare Workers, Chromium and WebKit |

## Testing

- `bun test`: hashing, rate limits, redirect guard, locales, descriptors and temporary passwords.
- `test/e2e`: every flow in a real browser (Chromium and WebKit) against a local EmDash dev site that uses the package. Setup and flags are in [CONTRIBUTING.md](CONTRIBUTING.md#end-to-end-test). A form tested only with curl once passed here and failed for the first real person, so releases go through this.

## Contributing, security, license

[CONTRIBUTING.md](CONTRIBUTING.md) explains the scope and how to run the tests. Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md). [MIT](LICENSE).
