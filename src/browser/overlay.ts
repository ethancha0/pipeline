import type { Page } from 'playwright';

export type BadgeTone = 'filling' | 'ready' | 'needs_you' | 'submitted';

const COLORS: Record<BadgeTone, string> = {
  filling: '#6b7280',
  ready: '#16a34a',
  needs_you: '#d97706',
  submitted: '#2563eb',
};

/**
 * Phase 3 review aid: a small fixed badge, bottom right ("applypipe · Acme · ready").
 * Lives in a Shadow DOM root, ignores the mouse, and holds no buttons.
 */
export async function showBadge(page: Page, text: string, tone: BadgeTone): Promise<void> {
  const script = `(() => {
    const id = 'applypipe-overlay';
    let host = document.getElementById(id);
    if (!host) {
      host = document.createElement('div');
      host.id = id;
      host.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;pointer-events:none;';
      host.attachShadow({ mode: 'open' });
      document.documentElement.appendChild(host);
    }
    const badge = document.createElement('div');
    badge.textContent = ${JSON.stringify(text)};
    badge.style.cssText = 'font:600 13px/1.3 -apple-system,system-ui,sans-serif;color:#fff;background:${COLORS[tone]};' +
      'padding:8px 12px;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.25);max-width:420px;';
    host.shadowRoot.replaceChildren(badge);
  })()`;
  await page.evaluate(script).catch(() => {
    // the page may be navigating; the badge is cosmetic
  });
}
