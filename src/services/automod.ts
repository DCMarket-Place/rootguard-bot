// src/services/automod.ts
// Intelligent AutoMod Engine for RootGuard

import { storage } from './storage';

export interface AutoModCheckResult {
  triggered: boolean;
  reason?: string;
  action?: 'delete' | 'warn' | 'timeout';
}

// User message history cache for flood and spam detection
interface UserRecentMessage {
  content: string;
  timestamp: number;
}

const recentMessages: Map<string, UserRecentMessage[]> = new Map();

export class AutoModService {
  public static checkMessage(
    guildId: string,
    userId: string,
    content: string
  ): AutoModCheckResult {
    const settings = storage.getGuildSettings(guildId).automod;
    if (!settings.enabled || !content) {
      return { triggered: false };
    }

    const trimmed = content.trim();

    // 1. Anti-Invite Links
    if (settings.antiInvite) {
      const inviteRegex = /(discord\.(gg|io|me|li)|discordapp\.com\/invite|rootapp\.com\/invite|t\.me\/|chat\.whatsapp\.com)/i;
      if (inviteRegex.test(trimmed)) {
        return {
          triggered: true,
          reason: 'Unauthorized external invite link detected',
          action: 'delete',
        };
      }
    }

    // 2. Banned Words Blacklist
    if (settings.bannedWords && settings.bannedWords.length > 0) {
      const lower = trimmed.toLowerCase();
      for (const word of settings.bannedWords) {
        if (word && lower.includes(word.toLowerCase())) {
          return {
            triggered: true,
            reason: `Prohibited word pattern detected: "${word}"`,
            action: 'delete',
          };
        }
      }
    }

    // 3. Mass Mention Spam
    if (settings.antiMention) {
      const mentionCount = (trimmed.match(/@\S+/g) || []).length;
      if (trimmed.includes('@everyone') || trimmed.includes('@here') || mentionCount >= settings.maxMentions) {
        return {
          triggered: true,
          reason: `Excessive mentions (${mentionCount} tags detected)`,
          action: 'delete',
        };
      }
    }

    // 4. Caps Lock Spam
    if (settings.antiCaps && trimmed.length >= 8) {
      const letters = trimmed.replace(/[^a-zA-Z]/g, '');
      if (letters.length >= 8) {
        const caps = letters.replace(/[^A-Z]/g, '').length;
        const percentage = (caps / letters.length) * 100;
        if (percentage >= settings.capsPercentage) {
          return {
            triggered: true,
            reason: `Excessive Caps Lock (${Math.round(percentage)}% uppercase)`,
            action: 'delete',
          };
        }
      }
    }

    // 5. Anti-Flood & Repeated Message Spam
    if (settings.antiSpam) {
      const userKey = `${guildId}:${userId}`;
      const now = Date.now();
      const history = recentMessages.get(userKey) || [];

      // Filter messages in last 5 seconds
      const activeWindow = history.filter((m) => now - m.timestamp < 5000);

      // Check flood (> 4 messages in 5 seconds)
      if (activeWindow.length >= 4) {
        return {
          triggered: true,
          reason: 'Message flooding detected (slow down)',
          action: 'warn',
        };
      }

      // Check repeated messages (3 identical messages)
      const identical = activeWindow.filter((m) => m.content === trimmed);
      if (identical.length >= 2) {
        return {
          triggered: true,
          reason: 'Repeated duplicate message spam',
          action: 'delete',
        };
      }

      activeWindow.push({ content: trimmed, timestamp: now });
      recentMessages.set(userKey, activeWindow);
    }

    return { triggered: false };
  }
}
