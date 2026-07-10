import { describe, it, expect } from 'vitest';
import { computeInitialFinalSeconds } from './closings';

describe('computeInitialFinalSeconds', () => {
	it('前回明細なし（初回〆）は今回measuredをそのまま返す', () => {
		expect(computeInitialFinalSeconds(3600, null)).toBe(3600);
		expect(computeInitialFinalSeconds(0, null)).toBe(0);
	});

	it('前回明細あり: 前回final + max(今回measured − 前回measured, 0)', () => {
		// 前回 measured=3600/final=7200、今回 measured=5400 → 7200 + 1800 = 9000
		expect(
			computeInitialFinalSeconds(5400, { measuredSeconds: 3600, finalSeconds: 7200 })
		).toBe(9000);
	});

	it('今回measuredが前回measured以下なら差分は0（final据え置き）', () => {
		expect(
			computeInitialFinalSeconds(3600, { measuredSeconds: 3600, finalSeconds: 7200 })
		).toBe(7200);
		expect(
			computeInitialFinalSeconds(1800, { measuredSeconds: 3600, finalSeconds: 7200 })
		).toBe(7200);
	});
});
