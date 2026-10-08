/**
 * The "My access" page, rendered inside EmDash's admin shell with Kumo components. The passkey
 * section only explains and links to EmDash's Security page: passkeys are never created or
 * deleted here. Reached from the menu, from the reset email (`?reset=1`) and from the invite
 * button (`?welcome=1`).
 */
import { Banner, Button, Input, LinkButton, Loader } from "@cloudflare/kumo";
import * as React from "react";
import { BASE_PATH, PASSKEY_API_PATH, PASSWORD_MIN, SECURITY_PAGE_PATH } from "./lib/config.js";
import { AccessPage } from "./access-admin.js";
import { clientLocale, strings, type Strings } from "./lib/i18n.js";

interface Status {
	hasPassword: boolean;
	updatedAt: string | null;
	name: string | null;
	email: string;
	temporary: boolean;
	passkeyOfferDismissed: boolean;
}

const ME = `${BASE_PATH}/me`;
const HEADERS = { "X-EmDash-Request": "1" };

function errorText(t: Strings, code: string | undefined, message: string | undefined): string {
	// VALIDATION_ERROR carries the server's message in the site language; any other code gets our text.
	if (code === "VALIDATION_ERROR" && message) return message;
	if (code === "RATE_LIMITED") return t.rateLimited;
	if (code === "NOT_AUTHENTICATED" || code === "SESSION_REQUIRED") return t.sessionEnded;
	if (code === "NO_PASSKEY") return t.needPasskey;
	return t.genericError;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
	return (
		<section className="space-y-4 rounded-xl border border-kumo-line bg-kumo-base px-4 py-4">
			<h2 className="text-lg font-semibold">{title}</h2>
			{children}
		</section>
	);
}

function MyAccessPage() {
	const locale = clientLocale();
	const t = strings(locale);
	const query = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams();
	const welcome = query.has("welcome");
	const fromReset = query.has("reset");

	const [status, setStatus] = React.useState<Status | null>(null);
	const [passkeys, setPasskeys] = React.useState<number | null>(null);
	const [loadError, setLoadError] = React.useState<string | null>(null);
	const [name, setName] = React.useState("");
	const [password, setPassword] = React.useState("");
	const [repeat, setRepeat] = React.useState("");
	const [busy, setBusy] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);
	const [notice, setNotice] = React.useState<string | null>(null);
	const [confirmRemove, setConfirmRemove] = React.useState(false);
	const [offerHidden, setOfferHidden] = React.useState(false);

	const load = React.useCallback(async () => {
		try {
			const res = await fetch(ME, { credentials: "same-origin", headers: HEADERS });
			const json = (await res.json()) as { data?: Status };
			if (!res.ok || !json.data) throw new Error(res.status === 401 ? t.sessionEnded : t.genericError);
			setStatus(json.data);
		} catch (err) {
			setLoadError(err instanceof Error ? err.message : t.genericError);
		}
		try {
			const res = await fetch(PASSKEY_API_PATH, { credentials: "same-origin", headers: HEADERS });
			const json = (await res.json()) as { data?: { items?: unknown[] } };
			setPasskeys(res.ok && Array.isArray(json.data?.items) ? json.data.items.length : null);
		} catch {
			setPasskeys(null);
		}
	}, [t.genericError, t.sessionEnded]);

	React.useEffect(() => {
		void load();
	}, [load]);

	const save = async (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		setError(null);
		setNotice(null);
		if (password.length < PASSWORD_MIN) return setError(t.tooShort(PASSWORD_MIN));
		if (password !== repeat) return setError(t.mismatch);
		setBusy(true);
		try {
			const res = await fetch(ME, {
				method: "POST",
				credentials: "same-origin",
				headers: { ...HEADERS, "Content-Type": "application/json" },
				body: JSON.stringify({ password, repeat, name: status?.name ? undefined : name.trim() || undefined }),
			});
			const json = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
			if (!res.ok) {
				setError(errorText(t, json.error?.code, json.error?.message));
				setBusy(false);
				return;
			}
			setPassword("");
			setRepeat("");
			// Update the card at once (no "you have no password yet" flash); load() confirms after.
			setStatus((prev) => (prev ? { ...prev, hasPassword: true, updatedAt: new Date().toISOString(), name: prev.name || name.trim() || null } : prev));
			setNotice(t.passwordSaved);
			setBusy(false);
			await load();
		} catch {
			setError(t.genericError);
			setBusy(false);
		}
	};

	const remove = async () => {
		setError(null);
		setNotice(null);
		setBusy(true);
		try {
			const res = await fetch(ME, { method: "DELETE", credentials: "same-origin", headers: HEADERS });
			const json = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
			if (!res.ok) {
				setError(errorText(t, json.error?.code, json.error?.message));
			} else {
				setStatus((prev) => (prev ? { ...prev, hasPassword: false, updatedAt: null } : prev));
				setNotice(t.passwordRemoved);
			}
		} catch {
			setError(t.genericError);
		} finally {
			setConfirmRemove(false);
			setBusy(false);
		}
	};

	const since = status?.updatedAt
		? new Date(status.updatedAt).toLocaleDateString(locale, { day: "2-digit", month: "2-digit", year: "numeric" })
		: "";
	const canRemove = !!status?.hasPassword && (passkeys ?? 0) >= 1;
	// Offered once: no passkey yet and never answered "Not now".
	const offerPasskey = !!status && passkeys === 0 && !status.passkeyOfferDismissed && !offerHidden;
	const dismissOffer = async () => {
		setOfferHidden(true);
		await fetch(ME, {
			method: "PATCH",
			credentials: "same-origin",
			headers: { ...HEADERS, "Content-Type": "application/json" },
			body: JSON.stringify({ passkeyOffer: "dismissed" }),
		}).catch(() => undefined);
	};

	return (
		<div className="max-w-4xl pb-6">
			<h1 className="text-2xl font-semibold">{t.pageTitle}</h1>
			<p className="mt-1 text-sm text-kumo-subtle">{t.pageIntro}</p>

			<div className="mt-6 space-y-4">
				{welcome && !notice && <Banner variant="secondary" description={t.welcome} />}
				{fromReset && !notice && <Banner variant="secondary" description={t.fromReset} />}
				{status?.temporary && !notice && <Banner variant="secondary" description={t.tempSuggestion} />}
				{notice && <Banner variant="default" description={notice} />}
				{loadError && <Banner variant="error" description={loadError} />}

				{!status && !loadError && (
					<div role="status" className="flex items-center gap-2 rounded-xl border border-kumo-line bg-kumo-base px-4 py-4 text-sm text-kumo-subtle">
						<Loader size="sm" />
						{t.loading}
					</div>
				)}

				{offerPasskey && (
					<Section title={t.passkeyOfferTitle}>
						<p className="text-sm text-kumo-subtle">{t.passkeyOfferText}</p>
						<div className="flex flex-wrap gap-2">
							<LinkButton href={SECURITY_PAGE_PATH} variant="primary">
								{t.passkeyOfferYes}
							</LinkButton>
							<Button type="button" variant="ghost" onClick={dismissOffer}>
								{t.passkeyOfferNo}
							</Button>
						</div>
					</Section>
				)}

				{status && (
					<Section title={t.passwordSection}>
						<form onSubmit={save} className="space-y-4">
							<p className="text-sm text-kumo-subtle">{status.hasPassword ? t.hasPassword(since) : t.noPassword}</p>
							{/* The account the password belongs to, as autocomplete="username": without it the
							    browser offers to save the new password with an empty username. */}
							<Input label={t.email} type="email" autoComplete="username" value={status.email} readOnly />
							{!status.name && (
								<Input label={t.yourName} type="text" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} disabled={busy} />
							)}
							<Input
								label={t.newPassword}
								type="password"
								autoComplete="new-password"
								value={password}
								onChange={(e) => setPassword(e.target.value)}
								disabled={busy}
								required
							/>
							<Input
								label={t.repeatPassword}
								type="password"
								autoComplete="new-password"
								value={repeat}
								onChange={(e) => setRepeat(e.target.value)}
								disabled={busy}
								required
							/>
							<p className="text-sm text-kumo-subtle">{t.passwordRule(PASSWORD_MIN)}</p>
							{error && <Banner variant="error" description={error} />}
							<div className="flex flex-wrap items-center gap-2">
								<Button type="submit" variant="primary" loading={busy && !confirmRemove} disabled={busy || !password || !repeat}>
									{busy && !confirmRemove ? t.saving : t.savePassword}
								</Button>
								{canRemove && !confirmRemove && (
									<Button type="button" variant="ghost" disabled={busy} onClick={() => setConfirmRemove(true)}>
										{t.removePassword}
									</Button>
								)}
							</div>
							{canRemove && confirmRemove && (
								<div role="alert" className="space-y-3 rounded-lg border border-kumo-line p-3">
									<p className="text-sm">{t.removeConfirm}</p>
									<div className="flex flex-wrap gap-2">
										<Button type="button" variant="primary" loading={busy} disabled={busy} onClick={remove}>
											{t.removeYes}
										</Button>
										<Button type="button" variant="ghost" disabled={busy} onClick={() => setConfirmRemove(false)}>
											{t.cancel}
										</Button>
									</div>
								</div>
							)}
							{status.hasPassword && passkeys === 0 && <p className="text-sm text-kumo-subtle">{t.needPasskey}</p>}
						</form>
					</Section>
				)}

				{status && (
					<Section title={t.passkeySection}>
						<p className="text-sm text-kumo-subtle">{t.passkeyIntro}</p>
						{passkeys !== null && <p className="text-sm">{passkeys > 0 ? t.passkeyCount(passkeys) : t.passkeyNone}</p>}
						<LinkButton href={SECURITY_PAGE_PATH} variant={passkeys ? "outline" : "primary"}>
							{passkeys ? t.managePasskeys : t.createPasskey}
						</LinkButton>
					</Section>
				)}
			</div>
		</div>
	);
}

export const pages = {
	"/": MyAccessPage,
	"/team": AccessPage,
};
