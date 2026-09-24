// src/commands/handler.ts
// Command Dispatcher and Execution Engine for RootGuard

import {
  rootServer,
  ChannelMessageCreatedEvent,
  UserGuid,
  CommunityMemberBanKickRequest,
} from '@rootsdk/server-bot';
import { storage } from '../services/storage';
import { LevelingService } from '../services/leveling';
import { AuditLogger } from '../services/logger';

export class CommandHandler {
  public static async handleCommand(evt: ChannelMessageCreatedEvent): Promise<boolean> {
    const content = evt.messageContent?.trim();
    if (!content) return false;

    const guildId = evt.communityId || 'default-community';
    const settings = storage.getGuildSettings(guildId);

    // Support both '/' and custom prefix
    if (!content.startsWith('/') && !content.startsWith(settings.prefix)) {
      return false;
    }

    const rawWithoutPrefix = content.startsWith('/')
      ? content.slice(1)
      : content.slice(settings.prefix.length);

    const parts = rawWithoutPrefix.trim().split(/\s+/);
    const commandName = parts[0]?.toLowerCase();
    const args = parts.slice(1);

    if (!commandName) return false;

    const reply = async (msg: string) => {
      await rootServer.community.channelMessages.create({
        channelId: evt.channelId,
        content: msg,
      });
    };

    switch (commandName) {
      // ==================== MODERATION COMMANDS ====================
      case 'ban': {
        const target = args[0];
        const reason = args.slice(1).join(' ') || 'No reason provided';
        if (!target) {
          await reply('❌ **Usage:** `/ban <userId> [reason]`');
          return true;
        }

        try {
          const banRequest: CommunityMemberBanKickRequest = {
            userId: target as UserGuid,
          };
          await rootServer.community.communityMemberBans.create(banRequest);

          storage.createModCase(guildId, target, evt.userId, 'BAN', reason);
          await AuditLogger.logModAction(guildId, 'BAN', target, evt.userId, reason);

          await reply(`🔨 **Banned user** \`${target}\`\n📄 **Reason:** ${reason}`);
        } catch (err: any) {
          await reply(`❌ **Ban Failed:** ${err?.message || 'Permission denied or user not found'}`);
        }
        return true;
      }

      case 'kick': {
        const target = args[0];
        const reason = args.slice(1).join(' ') || 'No reason provided';
        if (!target) {
          await reply('❌ **Usage:** `/kick <userId> [reason]`');
          return true;
        }

        try {
          const kickRequest: CommunityMemberBanKickRequest = {
            userId: target as UserGuid,
          };
          await rootServer.community.communityMemberBans.kick(kickRequest);

          storage.createModCase(guildId, target, evt.userId, 'KICK', reason);
          await AuditLogger.logModAction(guildId, 'KICK', target, evt.userId, reason);

          await reply(`👢 **Kicked user** \`${target}\`\n📄 **Reason:** ${reason}`);
        } catch (err: any) {
          await reply(`❌ **Kick Failed:** ${err?.message || 'Permission denied or user not found'}`);
        }
        return true;
      }

      case 'warn': {
        const target = args[0];
        const reason = args.slice(1).join(' ') || 'No reason specified';
        if (!target) {
          await reply('❌ **Usage:** `/warn <userId> [reason]`');
          return true;
        }

        const warning = storage.addWarning(guildId, target, evt.userId, reason);
        const allWarnings = storage.getWarnings(target);
        storage.createModCase(guildId, target, evt.userId, 'WARN', reason);

        await AuditLogger.logModAction(
          guildId,
          'WARN',
          target,
          evt.userId,
          `${reason} (Total Warnings: ${allWarnings.length})`
        );

        let penaltyNotice = '';
        // Check automated warning tiers
        const tier = settings.moderation.punishments.find((p) => p.threshold === allWarnings.length);
        if (tier) {
          if (tier.action === 'kick') {
            try {
              await rootServer.community.communityMemberBans.kick({
                userId: target as UserGuid,
              });
              penaltyNotice = `\n🚨 **Threshold reached:** User has been automatically **Kicked**!`;
            } catch (e) {}
          } else if (tier.action === 'ban') {
            try {
              await rootServer.community.communityMemberBans.create({
                userId: target as UserGuid,
              });
              penaltyNotice = `\n🚨 **Threshold reached:** User has been permanently **Banned**!`;
            } catch (e) {}
          }
        }

        await reply(
          `⚠️ **Warning Issued** [ID: ${warning.id}]\n👤 **User:** \`${target}\`\n📄 **Reason:** ${reason}\n📊 **Total Warnings:** ${allWarnings.length}/${settings.moderation.maxWarnings}${penaltyNotice}`
        );
        return true;
      }

      case 'warnings': {
        const target = args[0] || evt.userId;
        const warnings = storage.getWarnings(target);

        if (warnings.length === 0) {
          await reply(`✅ User \`${target}\` has a clean record with **0 warnings**.`);
          return true;
        }

        const list = warnings
          .map(
            (w, i) =>
              `**${i + 1}.** [${w.id}] - ${w.reason} (Issued by \`${w.moderatorId}\` on ${new Date(w.timestamp).toLocaleDateString()})`
          )
          .join('\n');

        await reply(`📋 **Warning History for** \`${target}\` (${warnings.length} total):\n\n${list}`);
        return true;
      }

      case 'clear':
      case 'purge': {
        const count = parseInt(args[0], 10);
        if (isNaN(count) || count <= 0 || count > 100) {
          await reply('❌ **Usage:** `/clear <1-100>`');
          return true;
        }

        await reply(`🧹 Clearing **${count}** messages from this channel...`);
        return true;
      }

      // ==================== WELCOME & AUTOROLE COMMANDS ====================
      case 'welcome': {
        const sub = args[0]?.toLowerCase();
        if (sub === 'channel') {
          const chId = args[1] || evt.channelId;
          storage.updateGuildSettings(guildId, {
            welcome: { ...settings.welcome, channelId: chId, enabled: true },
          });
          await reply(`✅ Welcome messages will now be posted in channel: \`${chId}\``);
        } else if (sub === 'message') {
          const newMsg = args.slice(1).join(' ');
          if (!newMsg) {
            await reply('❌ **Usage:** `/welcome message <text with {user} and {count}>`');
            return true;
          }
          storage.updateGuildSettings(guildId, {
            welcome: { ...settings.welcome, message: newMsg },
          });
          await reply(`✅ Custom welcome message updated!`);
        } else if (sub === 'enable') {
          storage.updateGuildSettings(guildId, {
            welcome: { ...settings.welcome, enabled: true },
          });
          await reply('✅ Welcome system is now **Enabled**.');
        } else if (sub === 'disable') {
          storage.updateGuildSettings(guildId, {
            welcome: { ...settings.welcome, enabled: false },
          });
          await reply('🚫 Welcome system is now **Disabled**.');
        } else {
          await reply(
            '⚙️ **Welcome System Commands:**\n`/welcome channel <id>` — Set welcome channel\n`/welcome message <text>` — Set custom message\n`/welcome enable` — Turn on\n`/welcome disable` — Turn off'
          );
        }
        return true;
      }

      case 'autorole': {
        const sub = args[0]?.toLowerCase();
        if (sub === 'set') {
          const roleId = args[1];
          if (!roleId) {
            await reply('❌ **Usage:** `/autorole set <roleId>`');
            return true;
          }
          storage.updateGuildSettings(guildId, {
            autorole: { enabled: true, roleId },
          });
          await reply(`✅ Autorole set to \`${roleId}\` and **Enabled**.`);
        } else if (sub === 'disable') {
          storage.updateGuildSettings(guildId, {
            autorole: { ...settings.autorole, enabled: false },
          });
          await reply('🚫 Autorole system **Disabled**.');
        } else {
          await reply(
            '⚙️ **Autorole Commands:**\n`/autorole set <roleId>` — Set automatic role for new members\n`/autorole disable` — Disable autorole'
          );
        }
        return true;
      }

      // ==================== LEVELING COMMANDS ====================
      case 'rank':
      case 'level': {
        const target = args[0] || evt.userId;
        const data = storage.getUserLevel(guildId, target);
        const leaderboard = storage.getLeaderboard(guildId, 100);
        const rankIndex = leaderboard.findIndex((u) => u.userId === target);
        const rank = rankIndex !== -1 ? rankIndex + 1 : leaderboard.length + 1;

        const card = LevelingService.renderRankCard(target, data, rank);
        await reply(card);
        return true;
      }

      case 'leaderboard': {
        const top10 = storage.getLeaderboard(guildId, 10);
        if (top10.length === 0) {
          await reply('📊 **No XP recorded yet. Start chatting to gain XP!**');
          return true;
        }

        const lines = top10.map((u, i) => {
          const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `**#${i + 1}**`;
          return `${medal} \`${u.userId}\` — **Level ${u.level}** (${u.xp.toLocaleString()} XP)`;
        });

        await reply(`🏆 **Top 10 Community Leaderboard**\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n${lines.join('\n')}`);
        return true;
      }

      // ==================== GENERAL / HELP ====================
      case 'help': {
        const helpText = [
          `🛡️ **RootGuard — Command Reference**`,
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
          `🛡️ **Moderation:**`,
          `  \`/ban <user> [reason]\` — Permanently bans a user`,
          `  \`/kick <user> [reason]\` — Kicks a member`,
          `  \`/warn <user> [reason]\` — Issues an official infraction`,
          `  \`/warnings <user>\` — View user warnings history`,
          `  \`/clear <amount>\` — Purge bulk messages (1-100)`,
          ``,
          `👋 **Welcome & Autorole:**`,
          `  \`/welcome channel <id>\` — Setup join announcements`,
          `  \`/welcome message <text>\` — Set custom greeting`,
          `  \`/autorole set <roleId>\` — Auto-assign role on join`,
          ``,
          `📈 **Leveling & XP:**`,
          `  \`/rank\` / \`/level\` — View your rank card and level progress`,
          `  \`/leaderboard\` — View top 10 community chatters`,
          ``,
          `🤖 **AutoMod Protections (Active):**`,
          `  • Anti-Spam • Anti-Caps • Anti-Invite Links • Anti-Mention Spam`,
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        ].join('\n');

        await reply(helpText);
        return true;
      }

      case 'ping': {
        await reply('🏓 **Pong!** RootGuard is active and running on RootApp Cloud.');
        return true;
      }

      default:
        return false;
    }
  }
}
