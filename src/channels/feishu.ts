import express, { Request, Response } from 'express';
import axios from 'axios';

import { readEnvFile } from '../env.js';
import { logger } from '../logger.js';
import { ASSISTANT_NAME } from '../config.js';
import { registerChannel, ChannelOpts } from './registry.js';
import {
  Channel,
  OnChatMetadata,
  OnInboundMessage,
  RegisteredGroup,
} from '../types.js';

const FEISHU_API_BASE = 'https://open.xfchat.iflytek.com';

export class FeishuChannel implements Channel {
  name = 'feishu';

  private appId: string;
  private appSecret: string;
  private opts: ChannelOpts;
  private accessToken: string | null = null;
  private tokenExpireTime = 0;
  private server: ReturnType<typeof express> | null = null;
  private httpServer: any = null;
  private port: number;
  private connected = false;
  private lastMessageId: Map<string, string> = new Map();
  private botOpenId: string | null = null;

  constructor(
    appId: string,
    appSecret: string,
    port: number,
    opts: ChannelOpts,
  ) {
    this.appId = appId;
    this.appSecret = appSecret;
    this.port = port;
    this.opts = opts;
  }

  private async getBotOpenId(): Promise<string | null> {
    if (this.botOpenId) return this.botOpenId;
    const token = await this.getAccessToken();
    if (!token) return null;
    try {
      const res = await axios.get(`${FEISHU_API_BASE}/open-apis/bot/v3/info`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.data.code === 0) {
        this.botOpenId = res.data.bot?.open_id || null;
        logger.info(
          { botOpenId: this.botOpenId },
          'Feishu: bot open_id fetched',
        );
        return this.botOpenId;
      }
    } catch (err) {
      logger.error({ err }, 'Feishu: error fetching bot open_id');
    }
    return null;
  }

  private async getAccessToken(): Promise<string | null> {
    if (this.accessToken && Date.now() < this.tokenExpireTime) {
      return this.accessToken;
    }
    try {
      const res = await axios.post(
        `${FEISHU_API_BASE}/open-apis/auth/v3/tenant_access_token/internal`,
        { app_id: this.appId, app_secret: this.appSecret },
      );
      if (res.data.code === 0) {
        this.accessToken = res.data.tenant_access_token;
        this.tokenExpireTime = Date.now() + (res.data.expire - 300) * 1000;
        logger.info('Feishu: access_token refreshed');
        return this.accessToken;
      } else {
        logger.error({ data: res.data }, 'Feishu: failed to get access_token');
        return null;
      }
    } catch (err) {
      logger.error({ err }, 'Feishu: error getting access_token');
      return null;
    }
  }

  async connect(): Promise<void> {
    const app = express();
    app.use(express.json());

    app.post('/webhook/event', async (req: Request, res: Response) => {
      const body = req.body;

      logger.info(
        { body: JSON.stringify(body).slice(0, 200) },
        'Feishu: incoming request',
      );

      if (body.type === 'url_verification' || body.challenge) {
        logger.info('Feishu: URL verification request');
        return res.json({ challenge: body.challenge });
      }

      const isV2 = body.schema === '2.0';
      const eventType = isV2 ? body.header?.event_type : body.event?.type;
      const event = body.event;
      const type = body.type;

      const isMessageEvent =
        (isV2 && eventType === 'im.message.receive_v1') ||
        (!isV2 &&
          type === 'event_callback' &&
          eventType === 'im.message.receive_v1');

      if (isMessageEvent) {
        res.json({ code: 0 });

        try {
          const { sender, message } = event;
          const openId = sender?.sender_id?.open_id;
          const chatId = message?.chat_id;
          const messageType = message?.message_type;
          const chatType = message?.chat_type;

          if (messageType !== 'text' || !openId) return;

          const content = JSON.parse(message.content);
          let text: string = content.text || '';

          const isGroupChat = chatType === 'group';
          if (isGroupChat) {
            const botId = await this.getBotOpenId();
            const mentions: any[] = message.mentions || [];
            logger.info(
              { botId, mentions: JSON.stringify(mentions) },
              'Feishu: group message mentions',
            );
            if (!botId) {
              logger.warn(
                'Feishu: cannot determine bot open_id, ignoring group message',
              );
              return;
            }
            const botMentioned = mentions.some(
              (m: any) => m.id?.open_id === botId,
            );
            if (!botMentioned) return;
          }

          text = text.replace(/@\S+/g, '').trim();
          text = `@${ASSISTANT_NAME} ${text}`.trim();

          if (!text) return;

          const chatJid = `feishu:${chatId || openId}`;
          const timestamp = new Date().toISOString();

          this.lastMessageId.set(chatJid, message.message_id);

          logger.info({ openId, chatJid, text }, 'Feishu: message received');

          const chatName = chatId ? `飞书群聊-${chatId}` : `飞书私聊-${openId}`;
          this.opts.onChatMetadata(
            chatJid,
            timestamp,
            chatName,
            'feishu',
            !!chatId,
          );

          this.opts.onMessage(chatJid, {
            id: message.message_id || `feishu-${Date.now()}`,
            chat_jid: chatJid,
            sender: openId,
            sender_name: sender?.sender_id?.user_id || openId,
            content: text,
            timestamp,
          });
        } catch (err) {
          logger.error({ err }, 'Feishu: error handling message event');
        }
        return;
      }

      res.json({ code: 0 });
    });

    app.get('/health', (_req: Request, res: Response) => {
      res.json({ status: 'ok', channel: 'feishu' });
    });

    await new Promise<void>((resolve) => {
      this.httpServer = app.listen(this.port, () => {
        logger.info({ port: this.port }, 'Feishu: webhook server started');
        resolve();
      });
    });

    await this.getAccessToken();
    this.connected = true;
    logger.info('Feishu channel connected');
  }

  private stripMarkdown(text: string): string {
    return text
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/\*(.+?)\*/g, '$1')
      .replace(/`{3}[\s\S]*?`{3}/g, (m) => m.replace(/`{3}\w*\n?/g, '').trim())
      .replace(/`(.+?)`/g, '$1')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/^\s*[-*+]\s+/gm, '• ')
      .replace(/^\s*\d+\.\s+/gm, (m) => m)
      .replace(/\[(.+?)\]\((.+?)\)/g, '$1: $2')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  async sendMessage(jid: string, text: string): Promise<void> {
    const token = await this.getAccessToken();
    if (!token) {
      logger.error('Feishu: no access token, cannot send message');
      return;
    }

    text = this.stripMarkdown(text);

    const id = jid.replace(/^feishu:/, '');
    const isOpenId = id.startsWith('ou_');
    const receiveIdType = isOpenId ? 'open_id' : 'chat_id';

    const replyMessageId = this.lastMessageId.get(jid);

    const MAX_LENGTH = 4000;
    const chunks = [];
    for (let i = 0; i < text.length; i += MAX_LENGTH) {
      chunks.push(text.slice(i, i + MAX_LENGTH));
    }

    for (const chunk of chunks) {
      try {
        let res;
        if (replyMessageId) {
          res = await axios.post(
            `${FEISHU_API_BASE}/open-apis/im/v1/messages/${replyMessageId}/reply`,
            {
              msg_type: 'text',
              content: JSON.stringify({ text: chunk }),
            },
            {
              headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
              },
            },
          );
        } else {
          res = await axios.post(
            `${FEISHU_API_BASE}/open-apis/im/v1/messages`,
            {
              receive_id: id,
              msg_type: 'text',
              content: JSON.stringify({ text: chunk }),
            },
            {
              headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
              },
              params: { receive_id_type: receiveIdType },
            },
          );
        }
        if (res.data.code === 0) {
          logger.info({ jid }, 'Feishu: message sent');
        } else {
          logger.error(
            { jid, data: res.data },
            'Feishu: failed to send message',
          );
        }
      } catch (err) {
        logger.error({ jid, err }, 'Feishu: error sending message');
      }
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith('feishu:');
  }

  async disconnect(): Promise<void> {
    if (this.httpServer) {
      this.httpServer.close();
      this.httpServer = null;
    }
    this.connected = false;
    logger.info('Feishu channel disconnected');
  }
}

registerChannel('feishu', (opts: ChannelOpts) => {
  const envVars = readEnvFile([
    'FEISHU_APP_ID',
    'FEISHU_APP_SECRET',
    'FEISHU_WEBHOOK_PORT',
  ]);
  const appId = process.env.FEISHU_APP_ID || envVars.FEISHU_APP_ID || '';
  const appSecret =
    process.env.FEISHU_APP_SECRET || envVars.FEISHU_APP_SECRET || '';
  const port = parseInt(
    process.env.FEISHU_WEBHOOK_PORT || envVars.FEISHU_WEBHOOK_PORT || '3000',
    10,
  );

  if (!appId || !appSecret) {
    logger.warn('Feishu: FEISHU_APP_ID or FEISHU_APP_SECRET not set, skipping');
    return null;
  }

  return new FeishuChannel(appId, appSecret, port, opts);
});
