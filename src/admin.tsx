/**
 * Auth provider UI, bundled by EmDash through `virtual:emdash/auth-providers` and rendered inside
 * its own pages. On the sign-in page the core wraps `LoginButton` in a clickable div that opens
 * `LoginForm`; on the invite page it passes `inviteToken` and the button accepts the invite.
 */
import { Button, Input } from "@cloudflare/kumo";
import * as React from "react";
import { ADMIN_PATH, BASE_PATH } from "./lib/config.js";
import { clientLocale, strings, type Strings } from "./lib/i18n.js";

/** Only paths inside the admin; anything else (other host, protocol-relative, control chars) falls back. */
export function safeRedirect(raw: string | null): string {
	if (!raw) return ADMIN_PATH;
	if (!raw.startsWith(ADMIN_PATH)) return ADMIN_PATH;
	if (/[\\\u0000-\u001f\u007f]/.test(raw) || raw.startsWith("//")) return ADMIN_PATH;
	return raw;
}

interface PostResult {
	ok: boolean;
	code?: string;
	data?: Record<string, unknown>;
}

async function post(path: string, body: unknown): Promise<PostResult> {
	try {
		const res = await fetch(`${BASE_PATH}/${path}`, {
			method: "POST",
			credentials: "same-origin",
			headers: { "Content-Type": "application/json", "X-EmDash-Request": "1" },
			body: JSON.stringify(body),
		});
		const json = (await res.json().catch(() => ({}))) as { data?: Record<string, unknown>; error?: { code?: string } };
		return res.ok ? { ok: true, data: json.data } : { ok: false, code: json.error?.code };
	} catch {
		return { ok: false };
	}
}

function explain(t: Strings, code?: string): string {
	switch (code) {
		case "INVALID_CREDENTIALS":
			return t.invalidCredentials;
		case "RATE_LIMITED":
			return t.rateLimited;
		case "ACCOUNT_DISABLED":
			return t.accountDisabled;
		case "NOT_CONFIGURED":
			return t.notConfigured;
		case "EMAIL_NOT_CONFIGURED":
			return t.emailUnavailable;
		case "INVALID_TOKEN":
			return t.inviteInvalid;
		case "USER_EXISTS":
			return t.inviteUserExists;
		default:
			return t.genericError;
	}
}

function ErrorBox({ text }: { text: string | null }) {
	if (!text) return null;
	return (
		<div role="alert" className="rounded-lg bg-kumo-danger/10 p-3 text-sm text-kumo-danger">
			{text}
		</div>
	);
}

function InviteButton({ inviteToken, t }: { inviteToken: string; t: Strings }) {
	const [busy, setBusy] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);
	const accept = async () => {
		setBusy(true);
		setError(null);
		const result = await post("invite", { token: inviteToken });
		const target = typeof result.data?.redirect === "string" ? result.data.redirect : null;
		if (result.ok && target) {
			window.location.href = target;
			return;
		}
		setError(explain(t, result.code));
		setBusy(false);
	};
	return (
		<div className="space-y-2">
			<Button type="button" variant="outline" className="w-full justify-center" loading={busy} disabled={busy} onClick={accept}>
				{busy ? t.accepting : t.acceptWithPassword}
			</Button>
			<ErrorBox text={error} />
		</div>
	);
}

export function LoginButton({ inviteToken }: { inviteToken?: string }) {
	const t = strings(clientLocale());
	if (inviteToken) return <InviteButton inviteToken={inviteToken} t={t} />;
	// data-auth-provider is the contract with emdash-admin-theme-classic: when this button is on the
	// login page, the theme puts it first (that package's skin.css, "Login with a password").
	return (
		<Button type="button" variant="outline" className="w-full justify-center" data-auth-provider="password">
			{t.signInWithPassword}
		</Button>
	);
}

export function LoginForm() {
	const t = strings(clientLocale());
	const [view, setView] = React.useState<"login" | "forgot" | "sent">("login");
	const [email, setEmail] = React.useState("");
	const [password, setPassword] = React.useState("");
	const [busy, setBusy] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);

	const signIn = async (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		setBusy(true);
		setError(null);
		const result = await post("login", { email: email.trim(), password });
		if (result.ok) {
			// A temporary password lands on "My access" (the server says where); otherwise the usual target.
			const target = typeof result.data?.redirect === "string" ? result.data.redirect : new URLSearchParams(window.location.search).get("redirect");
			window.location.href = safeRedirect(target);
			return;
		}
		setPassword("");
		setError(explain(t, result.code));
		setBusy(false);
	};

	const sendLink = async (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		setBusy(true);
		setError(null);
		const result = await post("forgot", { email: email.trim() });
		setBusy(false);
		if (result.ok) setView("sent");
		else setError(explain(t, result.code));
	};

	if (view === "sent") {
		return (
			<div className="space-y-3">
				<p className="text-sm text-kumo-subtle">{t.sent}</p>
				<Button type="button" variant="ghost" className="w-full justify-center" onClick={() => setView("login")}>
					{t.backToSignIn}
				</Button>
			</div>
		);
	}

	if (view === "forgot") {
		return (
			<form onSubmit={sendLink} className="space-y-3">
				<Input
					label={t.email}
					type="email"
					autoComplete="username"
					value={email}
					onChange={(e) => setEmail(e.target.value)}
					disabled={busy}
					required
				/>
				<ErrorBox text={error} />
				<Button type="submit" className="w-full" loading={busy} disabled={busy || !email.trim()}>
					{busy ? t.sending : t.sendLink}
				</Button>
				<Button type="button" variant="ghost" className="w-full justify-center" onClick={() => setView("login")}>
					{t.backToSignIn}
				</Button>
			</form>
		);
	}

	return (
		<form onSubmit={signIn} className="space-y-3">
			<Input
				label={t.email}
				type="email"
				autoComplete="username"
				value={email}
				onChange={(e) => setEmail(e.target.value)}
				disabled={busy}
				required
			/>
			<Input
				label={t.password}
				type="password"
				autoComplete="current-password"
				value={password}
				onChange={(e) => setPassword(e.target.value)}
				disabled={busy}
				required
			/>
			<ErrorBox text={error} />
			<Button type="submit" className="w-full" loading={busy} disabled={busy || !email.trim() || !password}>
				{busy ? t.signingIn : t.signIn}
			</Button>
			<Button
				type="button"
				variant="ghost"
				className="w-full justify-center"
				onClick={() => {
					setError(null);
					setView("forgot");
				}}
			>
				{t.forgot}
			</Button>
		</form>
	);
}
