/**
 * epoch ミリ秒から JST 基準の業務日付（YYYY-MM-DD）を算出する。
 *
 * 業務日付の境界時刻（boundaryHour, 例: 5 = 05:00 JST）より前の時刻は前日に帰属する。
 * サーバーのタイムゾーンに依存しないよう、UTC 変換のみで計算する:
 *   - JST は UTC+9 なので 9 時間分ずらす
 *   - 境界時刻分をさらに戻すことで「境界を 00:00 に平行移動」した日付を得る
 *
 * @param epochMs      対象時刻（epoch ミリ秒, UTC）
 * @param boundaryHour 業務日付の境界時刻（0〜23 の時。デフォルト運用は 5）
 * @returns YYYY-MM-DD 形式の業務日付文字列
 */
export function toWorkDate(epochMs: number, boundaryHour: number): string {
	const shifted = epochMs + 9 * 3600e3 - boundaryHour * 3600e3;
	return new Date(shifted).toISOString().slice(0, 10);
}
