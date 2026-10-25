import { describe, expect, it, vi } from 'vitest';
import { createStatusEmoji, type ReactionLike } from '../../src/discord/status.js';

function fakeChannel(reactions: { name: string; me: boolean }[]) {
  const removed: string[] = [];
  const added: string[] = [];
  const cache = new Map<string, ReactionLike>(
    reactions.map((r) => [
      r.name,
      { emoji: { name: r.name }, me: r.me, users: { remove: vi.fn(async () => removed.push(r.name)) } },
    ]),
  );
  const message = { reactions: { cache }, react: vi.fn(async (e: string) => added.push(e)) };
  return { channel: { messages: { fetch: vi.fn(async () => message) } }, removed, added };
}

describe('setStatusEmoji', () => {
  it('replaces the previous status emoji and leaves ✅ alone', async () => {
    const f = fakeChannel([
      { name: '✅', me: false },
      { name: '👀', me: true },
    ]);
    await createStatusEmoji(f.channel, 'bot')('m1', 'filling');
    expect(f.removed).toEqual(['👀']);
    expect(f.added).toEqual(['⏳']);
  });

  it('matches emoji with or without the variation selector and skips re-adding', async () => {
    const f = fakeChannel([{ name: '⚠', me: true }]);
    await createStatusEmoji(f.channel, 'bot')('m1', 'needs_you');
    expect(f.removed).toEqual([]);
    expect(f.added).toEqual([]);
  });

  it('only removes the bot’s own reactions; null clears', async () => {
    const f = fakeChannel([
      { name: '👀', me: false },
      { name: '🟢', me: true },
    ]);
    await createStatusEmoji(f.channel, 'bot')('m1', null);
    expect(f.removed).toEqual(['🟢']);
    expect(f.added).toEqual([]);
  });

  it('logs instead of throwing when Discord fails', async () => {
    const channel = { messages: { fetch: vi.fn(async () => Promise.reject(new Error('Missing Access'))) } };
    await expect(createStatusEmoji(channel, 'bot')('m1', 'queued')).resolves.toBeUndefined();
  });
});
