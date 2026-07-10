/**
 * ステータスIDから表示色を決定的に割り当てる。
 * 設定不要で、ステータスを追加しても自動的に別色が付く（IDベースなので
 * 追加・削除で既存ステータスの色は変わらない）。
 */
export const STATUS_PALETTE = [
	'#4d8dff', // 青
	'#3fb950', // 緑
	'#d29922', // 黄
	'#a371f7', // 紫
	'#db61a2', // ピンク
	'#39c5cf', // シアン
	'#f0883e', // オレンジ
	'#e5484d' // 赤
] as const;

export function statusColor(statusId: number): string {
	// DB上のIDは正の整数だが、不正値でも undefined 参照にならないよう先頭色に倒す
	if (!Number.isInteger(statusId) || statusId < 1) return STATUS_PALETTE[0];
	return STATUS_PALETTE[(statusId - 1) % STATUS_PALETTE.length];
}
