/**
 * "Team access" (administrators): create someone's access with a generated temporary password,
 * or issue a new one, and copy the ready message. The password is shown once.
 */
import { Banner, Button, Input, Loader } from "@cloudflare/kumo";
import * as React from "react";
import { ADMIN_PATH, BASE_PATH, ROLES } from "./lib/config.js";
import { clientLocale, strings, type Strings } from "./lib/i18n.js";

const ADMIN_API = `${BASE_PATH}/admin`;
const HEADERS = { "X-EmDash-Request": "1" };

interface Person {
	id: string;
	email: string;
	name: string | null;
	role: number;
	disabled: boolean;
	password: "set" | "temporary" | "none";
	passkeys: number;
}

interface Ready {
	email: string;
	name: string | null;
	password: string;
	loginUrl: string | null;
}

function message(t: Strings, ready: Ready): string {
	const url = ready.loginUrl ?? `${window.location.origin}${ADMIN_PATH}/login`;
	return t.handover(new URL(url).host, url, ready.email, ready.password);
}

function ReadyCard({ t, ready }: { t: Strings; ready: Ready }) {
	const [copied, setCopied] = React.useState(false);
	const text = message(t, ready);
	return (
		<section className="space-y-3 rounded-xl border border-kumo-line bg-kumo-base px-4 py-4" aria-live="polite">
			<Banner variant="default" description={t.readyTitle} />
			<pre className="whitespace-pre-wrap rounded-lg border border-kumo-line p-3 text-sm">{text}</pre>
			<Button
				type="button"
				variant="primary"
				onClick={async () => {
					await navigator.clipboard.writeText(text);
					setCopied(true);
				}}
			>
				{copied ? t.copied : t.copyMessage}
			</Button>
		</section>
	);
}

async function call(body: unknown): Promise<{ ok: boolean; code?: string; data?: Ready }> {
	const res = await fetch(ADMIN_API, {
		method: "POST",
		credentials: "same-origin",
		headers: { ...HEADERS, "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	const json = (await res.json().catch(() => ({}))) as { data?: Ready; error?: { code?: string } };
	return res.ok ? { ok: true, data: json.data } : { ok: false, code: json.error?.code };
}

export function AccessPage() {
	const t = strings(clientLocale());
	const [people, setPeople] = React.useState<Person[] | null>(null);
	const [forbidden, setForbidden] = React.useState(false);
	const [email, setEmail] = React.useState("");
	const [name, setName] = React.useState("");
	const [role, setRole] = React.useState(40);
	const [busy, setBusy] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);
	const [ready, setReady] = React.useState<Ready | null>(null);
	const [confirming, setConfirming] = React.useState<string | null>(null);

	const load = React.useCallback(async () => {
		const res = await fetch(ADMIN_API, { credentials: "same-origin", headers: HEADERS });
		if (res.status === 403 || res.status === 401) return setForbidden(true);
		const json = (await res.json().catch(() => ({}))) as { data?: { items?: Person[] } };
		setPeople(json.data?.items ?? []);
	}, []);

	React.useEffect(() => {
		void load();
	}, [load]);

	const explain = (code?: string) =>
		code === "USER_EXISTS" ? t.userExists : code === "RATE_LIMITED" ? t.rateLimited : code === "VALIDATION_ERROR" ? t.genericError : t.genericError;

	const create = async (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		setBusy(true);
		setError(null);
		setReady(null);
		const r = await call({ action: "create", email: email.trim(), name: name.trim(), role });
		setBusy(false);
		if (!r.ok || !r.data) return setError(explain(r.code));
		setReady(r.data);
		setEmail("");
		setName("");
		await load();
	};

	const reset = async (id: string) => {
		setBusy(true);
		setError(null);
		setReady(null);
		const r = await call({ action: "reset", userId: id });
		setBusy(false);
		setConfirming(null);
		if (!r.ok || !r.data) return setError(explain(r.code));
		setReady(r.data);
		await load();
	};

	if (forbidden) {
		return (
			<div className="max-w-4xl pb-6">
				<h1 className="text-2xl font-semibold">{t.accessTitle}</h1>
				<div className="mt-6">
					<Banner variant="error" description={t.adminOnly} />
				</div>
			</div>
		);
	}

	const passwordLabel = (p: Person["password"]) => (p === "set" ? t.pwSet : p === "temporary" ? t.pwTemp : t.pwNone);

	return (
		<div className="max-w-4xl pb-6">
			<h1 className="text-2xl font-semibold">{t.accessTitle}</h1>
			<p className="mt-1 text-sm text-kumo-subtle">
				{t.accessIntro}{" "}
				<a className="underline" href={`${ADMIN_PATH}/users`}>
					{t.usersLink}
				</a>
			</p>

			<div className="mt-6 space-y-4">
				{error && <Banner variant="error" description={error} />}
				{ready && <ReadyCard t={t} ready={ready} />}

				<section className="space-y-4 rounded-xl border border-kumo-line bg-kumo-base px-4 py-4">
					<h2 className="text-lg font-semibold">{t.newAccess}</h2>
					<form onSubmit={create} className="space-y-4">
						<Input label={t.email} type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy} required />
						<Input label={t.nameLabel} type="text" autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} disabled={busy} />
						<label className="flex flex-col gap-1 text-sm font-medium">
							{t.roleLabel}
							<select
								className="rounded-lg border border-kumo-line bg-kumo-base px-3 py-2 text-sm"
								value={role}
								onChange={(e) => setRole(Number(e.target.value))}
								disabled={busy}
							>
								{ROLES.map((r) => (
									<option key={r} value={r}>
										{t.roles[r]}
									</option>
								))}
							</select>
						</label>
						<Button type="submit" variant="primary" loading={busy} disabled={busy || !email.trim()}>
							{busy ? t.creating : t.createAccess}
						</Button>
					</form>
				</section>

				<section className="space-y-3 rounded-xl border border-kumo-line bg-kumo-base px-4 py-4">
					<h2 className="text-lg font-semibold">{t.people}</h2>
					{!people && (
						<div role="status" className="flex items-center gap-2 text-sm text-kumo-subtle">
							<Loader size="sm" />
							{t.loading}
						</div>
					)}
					{people && (
						<ul className="divide-y divide-kumo-line">
							{people.map((p) => (
								<li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
									<div className="min-w-0">
										<div className="font-medium">{p.name || p.email}</div>
										<div className="text-sm text-kumo-subtle">
											{p.email} · {t.roles[p.role] ?? p.role} · {passwordLabel(p.password)}
											{p.passkeys > 0 ? ` · ${t.passkeysCount(p.passkeys)}` : ""}
										</div>
									</div>
									{confirming === p.id ? (
										<div className="flex flex-wrap items-center gap-2">
											<span className="text-sm">{t.resetConfirm(p.name || p.email)}</span>
											<Button type="button" variant="primary" loading={busy} disabled={busy} onClick={() => reset(p.id)}>
												{t.resetYes}
											</Button>
											<Button type="button" variant="ghost" disabled={busy} onClick={() => setConfirming(null)}>
												{t.cancel}
											</Button>
										</div>
									) : (
										<Button type="button" variant="outline" disabled={busy} onClick={() => setConfirming(p.id)}>
											{t.newPasswordFor}
										</Button>
									)}
								</li>
							))}
						</ul>
					)}
				</section>
			</div>
		</div>
	);
}
