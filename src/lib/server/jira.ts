/**
 * Jira 連携（サーバーサイド専用）。
 *
 * `~/.config/jira/config`（KEY=VALUE 形式）を実行時に読み、チケットのタイトルを取得する。
 * 移植元: (移植元スクリプト) の load_config() / resolve_base()。
 *
 * セキュリティ最重要:
 *   - メールアドレス・API トークンを、クライアントへのレスポンス・例外メッセージ・
 *     ログ・console 出力に一切含めない。
 *   - エラーログに出してよいのは HTTP ステータスのみ。
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CONFIG_PATH = join(homedir(), '.config', 'jira', 'config');
const DEFAULT_SITE = 'example.atlassian.net';

export type JiraErrorCode = 'not_configured' | 'fetch_failed';

/** Jira 連携エラー。code と HTTP ステータス（あれば）だけを保持し、認証情報は一切含めない。 */
export class JiraError extends Error {
	code: JiraErrorCode;
	status: number | null;
	constructor(code: JiraErrorCode, status: number | null = null) {
		super(code);
		this.name = 'JiraError';
		this.code = code;
		this.status = status;
	}
}

/** 設定ファイル（KEY=VALUE、`#` コメント行と `=` を含まない行はスキップ）をパースする。 */
function parseConfigFile(): Record<string, string> {
	const conf: Record<string, string> = {};
	if (!existsSync(CONFIG_PATH)) return conf;
	let text: string;
	try {
		text = readFileSync(CONFIG_PATH, 'utf8');
	} catch {
		return conf;
	}
	for (const raw of text.split('\n')) {
		const line = raw.trim();
		if (!line || line.startsWith('#') || !line.includes('=')) continue;
		const idx = line.indexOf('=');
		const key = line.slice(0, idx).trim();
		const value = line.slice(idx + 1).trim();
		if (key) conf[key] = value;
	}
	return conf;
}

type Credentials =
	| { available: false; configExists: boolean }
	| { available: true; configExists: boolean; site: string; authHeader: string };

/**
 * 認証情報を解決する。環境変数 > 設定ファイルの優先順。
 * email / token のいずれかが欠ければ `{ available: false }`。
 * 返り値の authHeader は Basic 認証ヘッダ。呼び出し側でログ・レスポンスに出さないこと。
 */
function resolveCredentials(): Credentials {
	const configExists = existsSync(CONFIG_PATH);
	const conf = parseConfigFile();
	const site = process.env.JIRA_SITE || conf.JIRA_SITE || DEFAULT_SITE;
	const email = process.env.JIRA_EMAIL || process.env.JIRA_USER_EMAIL || conf.JIRA_EMAIL;
	const token = process.env.JIRA_API_TOKEN || conf.JIRA_API_TOKEN;
	if (!email || !token) return { available: false, configExists };
	const authHeader = 'Basic ' + Buffer.from(`${email}:${token}`).toString('base64');
	return { available: true, configExists, site, authHeader };
}

/** 解決済み API ベース URL のプロセス内キャッシュ。 */
let cachedBase: string | null = null;

/**
 * API のベース URL を決める。
 * まず `https://<site>/rest/api/2/myself` で認証確認し、非 2xx（401/404 等）なら
 * `/_edge/tenant_info` から cloudId を引いて `https://api.atlassian.com/ex/jira/<cloudId>` へフォールバック。
 * 解決結果はプロセス内キャッシュする。
 */
async function resolveBase(site: string, authHeader: string): Promise<string> {
	if (cachedBase) return cachedBase;

	// サイト直下で認証確認（クラシックトークンならここで通る）
	const probe = await fetch(`https://${site}/rest/api/2/myself`, {
		headers: { Authorization: authHeader }
	});
	if (probe.ok) {
		cachedBase = `https://${site}`;
		return cachedBase;
	}

	// スコープ付きトークンの可能性 → ゲートウェイへフォールバック。cloudId は認証不要。
	const infoRes = await fetch(`https://${site}/_edge/tenant_info`);
	if (!infoRes.ok) throw new JiraError('fetch_failed', infoRes.status);
	const info = (await infoRes.json()) as { cloudId?: string };
	if (!info.cloudId) throw new JiraError('fetch_failed', infoRes.status);
	cachedBase = `https://api.atlassian.com/ex/jira/${info.cloudId}`;
	return cachedBase;
}

/**
 * チケットキーから summary（タイトル）を取得する。
 * 設定なし（email/token 欠落）は JiraError('not_configured')、
 * 取得失敗は JiraError('fetch_failed', status) を投げる。
 */
export async function fetchIssueTitle(key: string): Promise<string> {
	const cred = resolveCredentials();
	if (!cred.available) throw new JiraError('not_configured');

	let base: string;
	try {
		base = await resolveBase(cred.site, cred.authHeader);
	} catch (e) {
		const status = e instanceof JiraError ? e.status : null;
		console.warn(`[jira] base resolve failed: HTTP ${status ?? 'network-error'}`);
		throw new JiraError('fetch_failed', status);
	}

	let res: Response;
	try {
		res = await fetch(`${base}/rest/api/2/issue/${encodeURIComponent(key)}?fields=summary`, {
			headers: { Authorization: cred.authHeader }
		});
	} catch {
		console.warn('[jira] issue fetch failed: network-error');
		throw new JiraError('fetch_failed', null);
	}
	if (!res.ok) {
		console.warn(`[jira] issue fetch failed: HTTP ${res.status}`);
		throw new JiraError('fetch_failed', res.status);
	}
	const data = (await res.json()) as { fields?: { summary?: unknown } };
	const summary = data.fields?.summary;
	if (typeof summary !== 'string') {
		throw new JiraError('fetch_failed', res.status);
	}
	return summary;
}

/** 疎通確認の結果。email/token は一切含めない。 */
export interface JiraProbeResult {
	/** `~/.config/jira/config` が存在するか。 */
	configExists: boolean;
	/** email/token が揃っているか。 */
	available: boolean;
	/** myself プローブ結果。available=false のときは null。status は network 失敗時 null。 */
	probe: { ok: boolean; status: number | null } | null;
}

/**
 * Jira への疎通を確認する（設定画面の「疎通確認」用）。
 * 設定ファイルの有無と myself プローブの OK/NG・HTTP ステータスのみを返す。
 */
export async function probeConnection(): Promise<JiraProbeResult> {
	const cred = resolveCredentials();
	if (!cred.available) {
		return { configExists: cred.configExists, available: false, probe: null };
	}
	try {
		const base = await resolveBase(cred.site, cred.authHeader);
		const res = await fetch(`${base}/rest/api/2/myself`, {
			headers: { Authorization: cred.authHeader }
		});
		return { configExists: cred.configExists, available: true, probe: { ok: res.ok, status: res.status } };
	} catch (e) {
		const status = e instanceof JiraError ? e.status : null;
		return { configExists: cred.configExists, available: true, probe: { ok: false, status } };
	}
}
