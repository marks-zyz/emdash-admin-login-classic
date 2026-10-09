# Changelog

## 0.5.1

- Accepts EmDash 1.2.0: the peer ranges of `emdash` and `@emdash-cms/auth` are now `>=1.1.0 <1.3.0`. No code change. Unit tests (32) and the type check pass against `emdash` and `@emdash-cms/auth` 1.2.0. The end-to-end flows were last run on 1.1.0; run them on a 1.2.0 site before relying on a flow that sends email. The 1.2.0 issue where the first-user passkey registration does not open a session (emdash-cms/emdash#3998, fixed in #4000) is in the setup wizard and does not touch this package.

## 0.5.0

First public release. The package was built privately as `emdash-auth-password` (0.1.0 to 0.4.1, never published to npm) and is now **EmDash Admin Login Classic**, `emdash-admin-login-classic`.

- Renamed, and every identifier in a namespace shared with other packages now derives from the slug `admin-login-classic` (the npm name without `emdash-`): provider and plugin id (were `password` and `auth-password`), API routes under `/_emdash/api/auth/admin-login-classic/` (the admin route is `/_emdash/api/auth/admin-login-classic/admin`), storage `auth:admin-login-classic`, Worker secret `EMDASH_ADMIN_LOGIN_CLASSIC_SECRET` (was `EMDASH_AUTH_PASSWORD_SECRET`) and the rate-limit keys. Site rules keyed by the plugin id or by `/plugins/auth-password/` must change.
- Rate-limit keys now hold a hash of the client IP, as the README says. Before, the address sat in clear in the shared table and in its backups.
- Upgrading a site that ran the private 0.4.x, in this order: (1) set `EMDASH_ADMIN_LOGIN_CLASSIC_SECRET` to the SAME value as the old secret, because it is the key of every stored hash and a fresh value makes every password fail; (2) before the first request on 0.5.0 run `UPDATE OR IGNORE _plugin_storage SET plugin_id = 'auth:admin-login-classic' WHERE plugin_id = 'auth:password'; DELETE FROM _plugin_storage WHERE plugin_id = 'auth:password';` (run it again after restoring an older backup); (3) reset links emailed before the upgrade open the old page path, so the person should use My access.
- One file per language in `src/locales` (English, Brazilian Portuguese) behind a single registry. `Accept-Language` and `<html lang>` match by exact tag, then by base language. A test fails when a translation misses a key or drops a placeholder.
- Temporary passwords are drawn from the language's own word list (English words for `en`).
- Menu labels and the provider label come from the locale files instead of a hard-coded `pt-BR` check.
- The Team access page moved from `/acessos` to `/team`, and the first-sign-in redirect uses `?first=1` instead of `?primeiro=1`. A site that hides the page by path must update the rule.
- Source comments cut to the ones that explain a decision. The end-to-end test is in English and reads its texts from the locale files.
- CONTRIBUTING, SECURITY, CODE_OF_CONDUCT, issue and pull request templates. The publish workflow runs the tests first and publishes when the version changes on main.

## 0.4.1

- A temporary password lands on "My access" only on the first sign-in with it. Later sign-ins go to the home screen; the suggestion to replace it waits on "My access". A new temporary password from "Team access" starts over.
- The login button carries `data-auth-provider="password"`, the hook `emdash-admin-theme-classic` 0.3+ uses to put the password first on the sign-in card.

## 0.4.0

- "Team access" page ("Acessos"), administrators only: create someone's access with a generated temporary password (four words and a number) or give an existing person a new one, then copy a ready message with the address, email and password. The password is shown once.
- First sign-in with a temporary password opens "My access" with a suggestion to replace it (not mandatory) and a one-time passkey offer: "Turn on for this device" goes to EmDash's Security page, "Not now" hides it for good.
- Private route `POST/GET /_emdash/api/auth/password/admin`, moved to `/_emdash/api/auth/admin-login-classic/admin` in 0.5.0 (session or API token with the `admin` scope), so a script can create the access when a site is delivered.

## 0.3.2

- Sign-in button back to the outline style (the ghost style of 0.3.1 read as plain text).

## 0.3.1

- pt-BR button text in EmDash's own voice: "Entre com e-mail e senha" (next to "Entre com chave de acesso" and "Entre com link de e-mail") and "Voltar ao acesso".

## 0.3.0

- The plugin page is now "My access" ("Meu acesso"): a Password section and a Passkey section.
- Passkey section: explains what a passkey is, shows how many the person has (EmDash's own list route) and links to EmDash's Security page to create or manage them. Passkeys are never created or removed by this package.
- "Remove my password", for people who want to sign in only with a passkey. Offered and accepted only with at least one passkey (checked on the server), with an email notice.

## 0.2.0

- Removed the reset and invite pages the package served itself. They looked foreign next to the admin, and in production the reset form failed: the page sent `Referrer-Policy: no-referrer`, so browsers posted `Origin: null` and EmDash answered `CSRF_REJECTED`.
- Forgot password now emails a link to EmDash's own email-link confirmation screen (token in EmDash's `auth_tokens`, type `recovery`), which signs the person in and opens "My password".
- New native plugin `passwordPlugin()`: a "My password" page inside the admin, built with the admin's own components, backed by a private route (session and `X-EmDash-Request` required, API tokens refused).
- Invites: the button on EmDash's invite page accepts the invite and opens "My password".
- Sign-in limits per account and IP, plus a higher per-account ceiling, so a stranger cannot lock the owner out.
- "My password" shows the account email in a read-only `autocomplete="username"` field, so password managers save the new password under the right account.
- Arriving from the reset email, the page says the link signed the person in and what to do next.
- Email notice when a password is set or changed. Reset links use only the site's configured URL, never the request host.
- Proven end to end in Chromium and WebKit.

## 0.1.0

- First version.
