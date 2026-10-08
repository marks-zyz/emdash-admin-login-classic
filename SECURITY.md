# Security policy

This package handles passwords and sessions for an admin panel, so we take reports seriously and we read them first.

## Reporting a vulnerability

Do not open a public issue. Use **Report a vulnerability** in the repository's Security tab, which opens a private advisory only the maintainers can read: https://github.com/marks-zyz/emdash-admin-login-classic/security/advisories/new

Please include:

- the package version and the EmDash version
- what an attacker can do, and what they need to start (an account, network position, a leaked token)
- steps or a proof of concept that works against a local dev site
- anything you already tried to limit the impact

We are a small team. We aim to acknowledge a report within 7 days and to tell you what we plan to do within 14. When there is a fix we publish it with a CHANGELOG entry and an advisory, and we credit you unless you prefer not to be named.

## Supported versions

Only the latest published minor version gets fixes while the package is below 1.0.

## Scope

In scope: the routes, the admin pages and the storage of this package (`/_emdash/api/auth/admin-login-classic/*`, "My access", "Team access"), the hashing, the rate limits, the reset and invite flows.

Out of scope: EmDash itself (report to [emdash-cms/emdash](https://github.com/emdash-cms/emdash)), Cloudflare, your email provider, and findings that need a compromised Worker secret or a compromised administrator account.

## What the design already assumes

The README lists the decisions in "How sign-in is protected": PBKDF2-SHA256 at 100,000 iterations with a secret pepper, rate limits in D1, the same response for unknown and wrong accounts, a new session id on sign-in, private routes that refuse API tokens, and temporary passwords shown once. A report that shows one of those does not hold is exactly what we want.
