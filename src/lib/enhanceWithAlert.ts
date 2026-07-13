import type { SubmitFunction } from '@sveltejs/kit';

/**
 * use:enhance 用の SubmitFunction ラッパー。
 * サーバーが ActionResult の error（CSRF拒否・想定外の例外など）を返した場合に
 * alert で通知する。素の use:enhance は error 時に画面へ何も出さないため、
 * 全フォームでこれを噛ませて失敗を可視化する。
 *
 * @param inner 既存のカスタム SubmitFunction（cancel() や成功時処理を持つもの）。省略可。
 */
export function withErrorAlert(inner?: SubmitFunction): SubmitFunction {
	return (input) => {
		// inner の cancel() 呼び出し等を壊さないよう、同じ引数でそのまま呼ぶ
		const maybeCallback = inner?.(input);

		return async (opts) => {
			const { result, update } = opts;
			if (result.type === 'error') {
				alert('操作に失敗しました: ' + (result.error?.message ?? '不明なエラー'));
				return; // applyAction はしない（画面状態を維持する）
			}
			// inner が Promise を返す可能性も考慮して await する
			const innerCallback = await maybeCallback;
			if (innerCallback) {
				await innerCallback(opts);
			} else {
				await update();
			}
		};
	};
}
