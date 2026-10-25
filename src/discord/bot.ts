import {
  Client,
  Events,
  GatewayIntentBits,
  Partials,
  type Message,
  type MessageReaction,
  type PartialMessage,
  type PartialMessageReaction,
  type PartialUser,
  type User,
} from 'discord.js';
import type { Env } from '../config.js';
import type { Db } from '../db/db.js';
import { getMeta, setMeta } from '../db/meta.js';
import { dequeueMessage, enqueueFromMessage, type FeedMessage } from '../jobs/enqueue.js';
import { resolve } from '../jobs/resolve.js';
import { log } from '../log.js';
import { catchUp, type CatchupMessage } from './catchup.js';
import { createStatusEmoji, type ChannelForEmoji, type SetStatusEmoji } from './status.js';

export const TRIGGER_EMOJI = '✅';

export interface Bot {
  stop(): Promise<void>;
}

export class DiscordLoginError extends Error {
  override name = 'DiscordLoginError';
}

/** Log in, catch up on missed ✅ reactions, then handle live ones until `stop()`. */
export async function startBot(env: Env, db: Db): Promise<Bot> {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildMessageReactions,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
    ],
    // Partials so reactions on uncached (webhook) messages still fire.
    partials: [Partials.Message, Partials.Reaction, Partials.Channel, Partials.User],
  });

  let setStatusEmoji: SetStatusEmoji = async () => {};
  const deps = () => ({ db, resolve: (url: string) => resolve(url), setStatusEmoji });

  // Catch-up and live reactions share one queue so a message is never enqueued twice concurrently.
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const next = chain.then(task);
    chain = next.catch(() => {});
    return next;
  };

  const isTrigger = (reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser) =>
    reaction.message.channelId === env.DISCORD_CHANNEL_ID &&
    user.id === env.DISCORD_OWNER_ID &&
    reaction.emoji.name === TRIGGER_EMOJI;

  client.once(Events.ClientReady, async (ready) => {
    log.info(`Discord connected as ${ready.user.tag}`);
    try {
      const channel = await ready.channels.fetch(env.DISCORD_CHANNEL_ID);
      if (!channel?.isTextBased() || channel.isDMBased()) {
        log.error(`can't read channel ${env.DISCORD_CHANNEL_ID}: check DISCORD_CHANNEL_ID and the bot's channel permissions`);
        return;
      }
      setStatusEmoji = createStatusEmoji(channel as unknown as ChannelForEmoji, ready.user.id);

      const result = await serial(() =>
        catchUp(
          {
            async fetchPage(before) {
              const page = await channel.messages.fetch({ limit: 100, before, cache: false });
              return [...page.values()].map((m) => toCatchupMessage(m, env.DISCORD_OWNER_ID));
            },
          },
          { db, days: env.CATCHUP_DAYS, enqueue: (msg) => enqueueFromMessage(msg, deps()) },
        ),
      );
      const other = result.other ? `, needs you/failed ${result.other}` : '';
      log.info(`catch-up: queued ${result.queued}, duplicates ${result.duplicates}${other} (${result.scanned} messages scanned)`);
    } catch (err) {
      log.error({ err }, 'catch-up failed; live reactions still work');
    }
  });

  client.on(Events.MessageReactionAdd, (reaction, user) => {
    if (!isTrigger(reaction, user)) return;
    void serial(async () => {
      try {
        const msg = reaction.message.partial ? await reaction.message.fetch() : reaction.message;
        await enqueueFromMessage(toFeedMessage(msg), deps());
        bumpLastProcessed(db, msg.id);
      } catch (err) {
        log.error({ err, messageId: reaction.message.id }, 'enqueue failed');
      }
    });
  });

  client.on(Events.MessageReactionRemove, (reaction, user) => {
    if (!isTrigger(reaction, user)) return;
    void serial(async () => {
      try {
        await dequeueMessage(reaction.message.id, deps());
      } catch (err) {
        log.error({ err, messageId: reaction.message.id }, 'dequeue failed');
      }
    });
  });

  client.on(Events.Error, (err) => log.error({ err }, 'Discord client error'));
  client.on(Events.ShardDisconnect, () => log.warn('Discord disconnected; reconnecting…'));
  client.on(Events.ShardResume, () => log.info('Discord reconnected'));

  try {
    await client.login(env.DISCORD_TOKEN);
  } catch (err) {
    await client.destroy();
    const message = err instanceof Error ? err.message : String(err);
    const hint = /intent/i.test(message)
      ? ' (enable Message Content Intent under Bot → Privileged Gateway Intents in the Discord developer portal)'
      : /token/i.test(message)
        ? ' (check DISCORD_TOKEN)'
        : '';
    throw new DiscordLoginError(`Discord login failed: ${message}${hint}`);
  }

  return {
    async stop() {
      await chain;
      await client.destroy();
    },
  };
}

function toFeedMessage(msg: Message | PartialMessage): FeedMessage {
  return {
    id: msg.id,
    content: msg.content ?? '',
    embeds: msg.embeds.map((e) => ({
      url: e.url,
      title: e.title,
      description: e.description,
      fields: e.fields.map((f) => ({ name: f.name, value: f.value })),
    })),
  };
}

function toCatchupMessage(msg: Message, ownerId: string): CatchupMessage {
  const check = msg.reactions.cache.get(TRIGGER_EMOJI);
  return {
    ...toFeedMessage(msg),
    createdTimestamp: msg.createdTimestamp,
    botMarkedDuplicate: msg.reactions.cache.get('🔁')?.me ?? false,
    async ownerChecked() {
      if (!check) return false;
      const users = await check.users.fetch({ limit: 100 });
      return users.has(ownerId);
    },
  };
}

/** Snowflakes grow over time; keep the larger id. */
function bumpLastProcessed(db: Db, messageId: string): void {
  const current = getMeta(db, 'last_processed_message_id');
  if (!current || BigInt(messageId) > BigInt(current)) setMeta(db, 'last_processed_message_id', messageId);
}
