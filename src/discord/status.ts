import type { JobStatus } from '../db/jobs.js';
import { log } from '../log.js';

/** Job statuses plus 'duplicate' (a post that resolved to an existing job; no job row). */
export type EmojiStatus = JobStatus | 'duplicate';

export const STATUS_EMOJI: Record<EmojiStatus, string | null> = {
  queued: '👀',
  duplicate: '🔁',
  filling: '⏳',
  ready: '🟢',
  needs_you: '⚠️',
  submitted: '📨',
  skipped: '⏭️',
  failed: '❌',
  abandoned: null, // emoji removed; ✅ again to requeue
};

// Discord may report emoji with or without the U+FE0F variation selector.
const bare = (s: string) => s.replace(/️/g, '');
const STATUS_SET = new Set(
  Object.values(STATUS_EMOJI)
    .filter((e): e is string => e !== null)
    .map(bare),
);

// Minimal shapes so tests can pass fakes; discord.js channels satisfy them.
export interface ReactionLike {
  emoji: { name: string | null };
  me: boolean;
  users: { remove(userId: string): Promise<unknown> };
}
export interface MessageForEmoji {
  reactions: { cache: { values(): Iterable<ReactionLike> } };
  react(emoji: string): Promise<unknown>;
}
export interface ChannelForEmoji {
  messages: { fetch(messageId: string): Promise<MessageForEmoji> };
}

export type SetStatusEmoji = (messageId: string, status: EmojiStatus | null) => Promise<void>;

/**
 * Returns `setStatusEmoji(messageId, status)`: removes the bot's previous status
 * emoji from the post and adds the new one (`null` / 'abandoned' → none).
 * Never touches the owner's ✅. Failures are logged, never thrown.
 */
export function createStatusEmoji(channel: ChannelForEmoji, botUserId: string): SetStatusEmoji {
  return async (messageId, status) => {
    const target = status ? STATUS_EMOJI[status] : null;
    try {
      const msg = await channel.messages.fetch(messageId);
      let hasTarget = false;
      for (const r of [...msg.reactions.cache.values()]) {
        const name = r.emoji.name ? bare(r.emoji.name) : null;
        if (!r.me || !name || !STATUS_SET.has(name)) continue;
        if (target && name === bare(target)) hasTarget = true;
        else await r.users.remove(botUserId);
      }
      if (target && !hasTarget) await msg.react(target);
    } catch (err) {
      log.warn({ messageId, status, err: String(err) }, 'status emoji update failed');
    }
  };
}
