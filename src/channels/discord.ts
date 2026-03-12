import {
  Client,
  Events,
  GatewayIntentBits,
  Message,
  TextChannel,
} from 'discord.js';
import { ProxyAgent, setGlobalDispatcher } from 'undici';

// Set up proxy at module load time so all undici requests (including discord.js REST) use it
const _proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
if (_proxyUrl) {
  setGlobalDispatcher(new ProxyAgent(_proxyUrl));
}

import { ASSISTANT_NAME, TRIGGER_PATTERN } from '../config.js';
import { readEnvFile } from '../env.js';
import { logger } from '../logger.js';
import { registerChannel, ChannelOpts } from './registry.js';
import {
  broadcastStatus,
  recordReconnect,
  setDiscordConnected,
} from '../status-tracker.js';
import {
  Channel,
  OnChatMetadata,
  OnInboundMessage,
  RegisteredGroup,
} from '../types.js';

export interface DiscordChannelOpts {
  onMessage: OnInboundMessage;
  onChatMetadata: OnChatMetadata;
  registeredGroups: () => Record<string, RegisteredGroup>;
}

// Fatal Discord WebSocket close codes — do NOT reconnect on these
const FATAL_CLOSE_CODES = new Set([4004, 4010, 4011, 4012, 4013, 4014]);

export class DiscordChannel implements Channel {
  name = 'discord';

  private client: Client | null = null;
  private opts: DiscordChannelOpts;
  private botToken: string;
  private destroyed = false;
  private reconnecting = false; // guard against concurrent reconnect loops

  constructor(botToken: string, opts: DiscordChannelOpts) {
    this.botToken = botToken;
    this.opts = opts;
  }

  private async attemptReconnect(attempt: number): Promise<void> {
    if (this.destroyed || this.reconnecting) return;
    this.reconnecting = true;

    try {
      const maxAttempts = 20;
      if (attempt >= maxAttempts) {
        logger.error(
          { attempt },
          'Discord max reconnect attempts reached, giving up',
        );
        return;
      }

      // Exponential backoff: 5s, 10s, 20s, 40s... capped at 5 minutes
      const delay = Math.min(5000 * Math.pow(2, attempt), 5 * 60 * 1000);
      logger.warn(
        { attempt, delaySec: Math.round(delay / 1000) },
        'Discord scheduling reconnect',
      );

      await new Promise((resolve) => setTimeout(resolve, delay));
      if (this.destroyed) return;

      if (this.client) {
        this.client.removeAllListeners();
        this.client.destroy();
        this.client = null;
      }

      this.reconnecting = false; // reset so connect() can set up fresh listeners
      recordReconnect();
      await this.connect();
      logger.info({ attempt }, 'Discord reconnected successfully');
    } catch (err) {
      logger.error({ err, attempt }, 'Discord reconnect attempt failed');
      this.reconnecting = false;
      if (!this.destroyed) {
        void this.attemptReconnect(attempt + 1);
      }
    }
  }

  async connect(): Promise<void> {
    this.destroyed = false;
    const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
    const clientOptions: ConstructorParameters<typeof Client>[0] = {
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
      ],
    };
    if (proxyUrl) {
      // undici proxy already set at module load time
      // tls.connect is patched by scripts/setup-proxy.cjs for ws WebSocket
    }
    this.client = new Client(clientOptions);
    this.client.on(Events.MessageCreate, async (message: Message) => {
      // Ignore bot messages (including own)
      if (message.author.bot) return;

      const channelId = message.channelId;
      const chatJid = `dc:${channelId}`;
      let content = message.content;
      const timestamp = message.createdAt.toISOString();
      const senderName =
        message.member?.displayName ||
        message.author.displayName ||
        message.author.username;
      const sender = message.author.id;
      const msgId = message.id;

      // Determine chat name
      let chatName: string;
      if (message.guild) {
        const textChannel = message.channel as TextChannel;
        chatName = `${message.guild.name} #${textChannel.name}`;
      } else {
        chatName = senderName;
      }

      // Translate Discord @bot mentions into TRIGGER_PATTERN format.
      // Discord mentions look like <@botUserId> — these won't match
      // TRIGGER_PATTERN (e.g., ^@Andy\b), so we prepend the trigger
      // when the bot is @mentioned.
      if (this.client?.user) {
        const botId = this.client.user.id;
        const isBotMentioned =
          message.mentions.users.has(botId) ||
          content.includes(`<@${botId}>`) ||
          content.includes(`<@!${botId}>`);

        if (isBotMentioned) {
          // Strip the <@botId> mention to avoid visual clutter
          content = content
            .replace(new RegExp(`<@!?${botId}>`, 'g'), '')
            .trim();
          // Prepend trigger if not already present
          if (!TRIGGER_PATTERN.test(content)) {
            content = `@${ASSISTANT_NAME} ${content}`;
          }
        }
      }

      // Handle attachments — store placeholders so the agent knows something was sent
      if (message.attachments.size > 0) {
        const attachmentDescriptions = [...message.attachments.values()].map(
          (att) => {
            const contentType = att.contentType || '';
            if (contentType.startsWith('image/')) {
              return `[Image: ${att.name || 'image'}]`;
            } else if (contentType.startsWith('video/')) {
              return `[Video: ${att.name || 'video'}]`;
            } else if (contentType.startsWith('audio/')) {
              return `[Audio: ${att.name || 'audio'}]`;
            } else {
              return `[File: ${att.name || 'file'}]`;
            }
          },
        );
        if (content) {
          content = `${content}\n${attachmentDescriptions.join('\n')}`;
        } else {
          content = attachmentDescriptions.join('\n');
        }
      }

      // Handle reply context — include who the user is replying to
      if (message.reference?.messageId) {
        try {
          const repliedTo = await message.channel.messages.fetch(
            message.reference.messageId,
          );
          const replyAuthor =
            repliedTo.member?.displayName ||
            repliedTo.author.displayName ||
            repliedTo.author.username;
          content = `[Reply to ${replyAuthor}] ${content}`;
        } catch {
          // Referenced message may have been deleted
        }
      }

      // Store chat metadata for discovery
      const isGroup = message.guild !== null;
      this.opts.onChatMetadata(
        chatJid,
        timestamp,
        chatName,
        'discord',
        isGroup,
      );

      // Only deliver full message for registered groups
      const group = this.opts.registeredGroups()[chatJid];
      if (!group) {
        logger.debug(
          { chatJid, chatName },
          'Message from unregistered Discord channel',
        );
        return;
      }

      // Deliver message — startMessageLoop() will pick it up
      this.opts.onMessage(chatJid, {
        id: msgId,
        chat_jid: chatJid,
        sender,
        sender_name: senderName,
        content,
        timestamp,
        is_from_me: false,
      });

      logger.info(
        { chatJid, chatName, sender: senderName },
        'Discord message stored',
      );
    });

    // Handle errors gracefully
    this.client.on(Events.Error, (err) => {
      logger.error({ err: err.message }, 'Discord client error');
    });

    // Handle shard errors (e.g. TLS reset, ECONNRESET) — trigger reconnection
    this.client.on(Events.ShardError, (err, shardId) => {
      if (this.destroyed) return;
      logger.warn(
        { err: err.message, shardId },
        'Discord shard error, scheduling reconnect',
      );
      setDiscordConnected(false);
      broadcastStatus();
      void this.attemptReconnect(0);
    });

    // Handle shard disconnects — trigger reconnection unless fatal close code
    this.client.on(Events.ShardDisconnect, (closeEvent, shardId) => {
      if (this.destroyed) return;
      if (FATAL_CLOSE_CODES.has(closeEvent.code)) {
        logger.error(
          { code: closeEvent.code, shardId },
          'Discord fatal close code, not reconnecting (check token/intents)',
        );
        setDiscordConnected(false);
        broadcastStatus();
        return;
      }
      logger.warn(
        { code: closeEvent.code, shardId },
        'Discord shard disconnected, scheduling reconnect',
      );
      setDiscordConnected(false);
      broadcastStatus();
      void this.attemptReconnect(0);
    });

    // Login with a 60-second timeout to avoid hanging on network issues
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Discord login timed out after 60 seconds'));
      }, 60000);

      this.client!.once(Events.ClientReady, (readyClient) => {
        clearTimeout(timeout);
        logger.info(
          { username: readyClient.user.tag, id: readyClient.user.id },
          'Discord bot connected',
        );
        setDiscordConnected(true, readyClient.user.tag);
        broadcastStatus();
        console.log(`\n  Discord bot: ${readyClient.user.tag}`);
        console.log(
          `  Use /chatid command or check channel IDs in Discord settings\n`,
        );
        resolve();
      });

      this.client!.login(this.botToken).catch((err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  async sendMessage(jid: string, text: string): Promise<void> {
    if (!this.client) {
      logger.warn('Discord client not initialized');
      return;
    }

    try {
      const channelId = jid.replace(/^dc:/, '');
      const channel = await this.client.channels.fetch(channelId);

      if (!channel || !('send' in channel)) {
        logger.warn({ jid }, 'Discord channel not found or not text-based');
        return;
      }

      const textChannel = channel as TextChannel;

      // Discord has a 2000 character limit per message — split if needed
      const MAX_LENGTH = 2000;
      if (text.length <= MAX_LENGTH) {
        await textChannel.send(text);
      } else {
        for (let i = 0; i < text.length; i += MAX_LENGTH) {
          await textChannel.send(text.slice(i, i + MAX_LENGTH));
        }
      }
      logger.info({ jid, length: text.length }, 'Discord message sent');
    } catch (err) {
      logger.error({ jid, err }, 'Failed to send Discord message');
    }
  }

  isConnected(): boolean {
    return this.client !== null && this.client.isReady();
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith('dc:');
  }

  async disconnect(): Promise<void> {
    this.destroyed = true;
    if (this.client) {
      this.client.removeAllListeners();
      this.client.destroy();
      this.client = null;
      logger.info('Discord bot stopped');
    }
  }

  async setTyping(jid: string, isTyping: boolean): Promise<void> {
    if (!this.client || !isTyping) return;
    try {
      const channelId = jid.replace(/^dc:/, '');
      const channel = await this.client.channels.fetch(channelId);
      if (channel && 'sendTyping' in channel) {
        await (channel as TextChannel).sendTyping();
      }
    } catch (err) {
      logger.debug({ jid, err }, 'Failed to send Discord typing indicator');
    }
  }
}

registerChannel('discord', (opts: ChannelOpts) => {
  const envVars = readEnvFile(['DISCORD_BOT_TOKEN']);
  const token =
    process.env.DISCORD_BOT_TOKEN || envVars.DISCORD_BOT_TOKEN || '';
  if (!token) {
    logger.warn('Discord: DISCORD_BOT_TOKEN not set');
    return null;
  }
  return new DiscordChannel(token, opts);
});
