import { greenhouseAdapter, tokenFromPage } from '../greenhouse/index.js';
import type { AtsAdapter, FillContext, FillOutcome } from '../types.js';

/**
 * Unknown ATS. Phase 3: open the page; if it embeds a Greenhouse board, fill it
 * as Greenhouse. Otherwise leave the tab open for the owner.
 * Phase 6 adds best-effort generic filling here.
 */
export const genericAdapter: AtsAdapter = {
  id: 'unknown',
  async run(ctx: FillContext): Promise<FillOutcome> {
    const url = ctx.job.applyUrl ?? ctx.job.sourceUrl;
    const token = await tokenFromPage(ctx.page, url);
    if (token) return greenhouseAdapter.run({ ...ctx, job: { ...ctx.job, reqId: token } });
    return { status: 'needs_you', reason: 'unsupported ATS — opened for you (auto-fill for other sites lands in Phase 6)' };
  },
};
