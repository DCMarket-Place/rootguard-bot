// src/services/logger.ts
// Centralized Multi-Channel Audit Logging for RootGuard

import { rootServer, ChannelGuid } from '@rootsdk/server-bot';
import { storage } from './storage';

export class AuditLogger {
  public static async logModAction(
    guildId: string,
    action: string,
    target: string,
    moderator: string,
    reason: string,
    duration?: string
  ): Promise<void> {
    const config = storage.getGuildSettings(guildId).logging;
    if (!config.enabled || !config.modLogChannelId) return;

    const timestamp = new Date().toUTCString();
    const durationText = duration ? `\n⏱️ **Duration:** ${duration}` : '';

    const content = [
      `🛡️ **[MODERATION ACTION: ${action.toUpperCase()}]**`,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      `👤 **Target:** ${target}`,
      `👮 **Moderator:** ${moderator}`,
      `📄 **Reason:** ${reason}${durationText}`,
      `📅 **Timestamp:** ${timestamp}`,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    ].join('\n');

    try {
      await rootServer.community.channelMessages.create({
        channelId: config.modLogChannelId as ChannelGuid,
        content,
      });
    } catch (err) {
      console.error('Failed to dispatch mod log to channel:', err);
    }
  }

  public static async logMemberJoin(
    guildId: string,
    userTag: string,
    memberCount: number
  ): Promise<void> {
    const config = storage.getGuildSettings(guildId).logging;
    if (!config.enabled || !config.joinLogChannelId) return;

    const content = [
      `📥 **[MEMBER JOINED]**`,
      `👤 **User:** ${userTag}`,
      `📊 **Member Count:** #${memberCount}`,
      `📅 **Date:** ${new Date().toUTCString()}`,
    ].join('\n');

    try {
      await rootServer.community.channelMessages.create({
        channelId: config.joinLogChannelId as ChannelGuid,
        content,
      });
    } catch (err) {
      console.error('Failed to dispatch join log:', err);
    }
  }

  public static async logMemberLeave(
    guildId: string,
    userTag: string
  ): Promise<void> {
    const config = storage.getGuildSettings(guildId).logging;
    if (!config.enabled || !config.joinLogChannelId) return;

    const content = [
      `📤 **[MEMBER LEFT / REMOVED]**`,
      `👤 **User:** ${userTag}`,
      `📅 **Date:** ${new Date().toUTCString()}`,
    ].join('\n');

    try {
      await rootServer.community.channelMessages.create({
        channelId: config.joinLogChannelId as ChannelGuid,
        content,
      });
    } catch (err) {
      console.error('Failed to dispatch leave log:', err);
    }
  }

  public static async logMessageDelete(
    guildId: string,
    channelName: string,
    author: string,
    contentPreview: string
  ): Promise<void> {
    const config = storage.getGuildSettings(guildId).logging;
    if (!config.enabled || !config.messageLogChannelId) return;

    const content = [
      `🗑️ **[MESSAGE DELETED]**`,
      `📍 **Channel:** #${channelName}`,
      `👤 **Author:** ${author}`,
      `💬 **Content:** ${contentPreview.slice(0, 500)}`,
      `📅 **Timestamp:** ${new Date().toUTCString()}`,
    ].join('\n');

    try {
      await rootServer.community.channelMessages.create({
        channelId: config.messageLogChannelId as ChannelGuid,
        content,
      });
    } catch (err) {
      console.error('Failed to dispatch message delete log:', err);
    }
  }
}
