import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Setting } from '../settings/entities/setting.entity';

@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);

  constructor(
    @InjectRepository(Setting)
    private settingRepo: Repository<Setting>,
  ) {}

  private async getConfig(): Promise<{
    token: string;
    chatId: string;
    topicId: string;
    notifyOnError: boolean;
    notifyOnSuccess: boolean;
    notifyOnScriptError: boolean;
  }> {
    const rows = await this.settingRepo.find({
      where: [
        { key: 'telegram_bot_token' },
        { key: 'telegram_chat_id' },
        { key: 'telegram_topic_id' },
        { key: 'telegram_notify_on_error' },
        { key: 'telegram_notify_on_success' },
        { key: 'telegram_notify_on_script_error' },
      ],
    });
    const get = (k: string) => rows.find((r) => r.key === k)?.value || '';
    return {
      token: get('telegram_bot_token'),
      chatId: get('telegram_chat_id'),
      topicId: get('telegram_topic_id'),
      notifyOnError: get('telegram_notify_on_error') === 'true',
      notifyOnSuccess: get('telegram_notify_on_success') === 'true',
      notifyOnScriptError: get('telegram_notify_on_script_error') === 'true',
    };
  }

  async isConfigured(): Promise<boolean> {
    const { token, chatId } = await this.getConfig();
    return !!(token && chatId);
  }

  async sendMessage(text: string): Promise<void> {
    const { token, chatId, topicId } = await this.getConfig();
    if (!token || !chatId) return;

    const body: Record<string, any> = { chat_id: chatId, text, parse_mode: 'HTML' };
    if (topicId) body.message_thread_id = parseInt(topicId, 10);

    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.text();
        this.logger.warn(`Telegram sendMessage failed: ${res.status} ${err}`);
      }
    } catch (e) {
      this.logger.warn(`Telegram sendMessage error: ${e?.message}`);
    }
  }

  async notifyRotation(profileName: string, status: 'success' | 'error', message: string): Promise<void> {
    const { notifyOnError, notifyOnSuccess } = await this.getConfig();
    if (status === 'error' && !notifyOnError) return;
    if (status === 'success' && !notifyOnSuccess) return;

    const icon = status === 'success' ? '✅' : '❌';
    const text = `${icon} <b>Ротация профиля</b>\n<b>${profileName}</b>\n${message}`;
    await this.sendMessage(text);
  }

  async notifyScriptExecution(
    scriptName: string,
    status: 'success' | 'error',
    successCount: number,
    totalCount: number,
  ): Promise<void> {
    const { notifyOnScriptError } = await this.getConfig();
    if (!notifyOnScriptError) return;
    if (status === 'success') return;

    const text = `❌ <b>Выполнение скрипта</b>\n<b>${scriptName}</b>\n${successCount}/${totalCount} нод успешно`;
    await this.sendMessage(text);
  }
}
