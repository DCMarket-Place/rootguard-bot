// src/commands/handler.ts
// Command Dispatcher and Execution Engine for RootGuard

import {
  rootServer,
  ChannelMessageCreatedEvent,
  UserGuid,
  CommunityMemberBanKickRequest,
  MessageDirectionTake,
} from '@rootsdk/server-bot';
import { storage } from '../services/storage';
import { LevelingService } from '../services/leveling';
import { AuditLogger } from '../services/logger';

export function extractGuid(input?: string): string | undefined {
  if (!input) return undefined;
  const rootLinkMatch = input.match(/root:\/\/(?:channel|user|role)\/([a-zA-Z0-9_-]+)/);
  if (rootLinkMatch) return rootLinkMatch[1];
  const guidMatch = input.match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/);
  if (guidMatch) return guidMatch[0];
  const b64Match = input.match(/ADF[0-9a-zA-Z_-]+/);
  if (b64Match) return b64Match[0];
  const cleaned = input.replace(/[<@>#\[\]()]/g, '').trim();
  return cleaned || undefined;
}

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
        const target = extractGuid(args[0]);
        const reason = args.slice(1).join(' ') || 'No reason provided';
        if (!target) {
          await reply('❌ **Usage:** `/ban <userId or @User> [reason]`');
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
        const target = extractGuid(args[0]);
        const reason = args.slice(1).join(' ') || 'No reason provided';
        if (!target) {
          await reply('❌ **Usage:** `/kick <userId or @User> [reason]`');
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
        const target = extractGuid(args[0]);
        const reason = args.slice(1).join(' ') || 'No reason specified';
        if (!target) {
          await reply('❌ **Usage:** `/warn <userId or @User> [reason]`');
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
        const target = extractGuid(args[0]) || evt.userId;
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

        try {
          // Delete the user's /clear command message first
          try {
            await rootServer.community.channelMessages.delete({
              id: evt.id,
              channelId: evt.channelId,
            });
          } catch (e) {}

          // Fetch recent messages
          const listRes = await rootServer.community.channelMessages.list({
            channelId: evt.channelId,
            messageDirectionTake: MessageDirectionTake.Older,
            dateAt: new Date(),
            limit: count + 5,
          });

          let deletedCount = 0;
          const messagesToDelete = (listRes.messages || [])
            .filter((m) => m.id !== evt.id)
            .slice(0, count);

          for (const msg of messagesToDelete) {
            try {
              await rootServer.community.channelMessages.delete({
                id: msg.id,
                channelId: evt.channelId,
              });
              deletedCount++;
            } catch (delErr) {
              console.warn(`Failed to delete message ${msg.id}:`, delErr);
            }
          }

          const confirmMsg = await rootServer.community.channelMessages.create({
            channelId: evt.channelId,
            content: `> 🧹 **Successfully deleted ${deletedCount} message${deletedCount === 1 ? '' : 's'}.**`,
          });

          // Auto-delete confirmation after 4 seconds to leave chat spotless
          setTimeout(async () => {
            try {
              await rootServer.community.channelMessages.delete({
                id: confirmMsg.id,
                channelId: evt.channelId,
              });
            } catch (e) {}
          }, 4000);

          await AuditLogger.logModAction(
            guildId,
            'MESSAGE_CLEAR',
            evt.userId,
            evt.userId,
            `Purged ${deletedCount} messages in channel [#Channel](root://channel/${evt.channelId})`
          );
        } catch (err: any) {
          await reply(`❌ **Clear Failed:** ${err?.message || 'Could not delete messages.'}`);
        }
        return true;
      }

      // ==================== MUTE & TIMEOUT COMMANDS ====================
      case 'mute':
      case 'timeout': {
        const target = extractGuid(args[0]);
        if (!target) {
          await reply('❌ **Usage:** `/mute <userId or @User> [minutes] [reason]`\n*Example:* `/mute @User 10 Spamming in general`');
          return true;
        }

        let durationMinutes: number | undefined = undefined;
        let reasonStartIndex = 1;

        if (args[1] && !isNaN(parseInt(args[1], 10))) {
          durationMinutes = parseInt(args[1], 10);
          reasonStartIndex = 2;
        }

        const reason = args.slice(reasonStartIndex).join(' ') || 'No reason specified';
        storage.muteUser(guildId, target, evt.userId, reason, durationMinutes);
        storage.createModCase(guildId, target, evt.userId, 'MUTE', reason, durationMinutes ? `${durationMinutes}m` : undefined);
        await AuditLogger.logModAction(guildId, 'MUTE', target, evt.userId, `${reason} (Duration: ${durationMinutes ? `${durationMinutes} mins` : 'Permanent'})`);

        const durationText = durationMinutes ? `\`${durationMinutes} Minutes\`` : '`Permanent`';
        await reply(
          `> ### 🔇 **MEMBER MUTED**\n> ━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n> 👤 **User:** [@User](root://user/${target})\n> ⏱️ **Duration:** ${durationText}\n> 📄 **Reason:** ${reason}\n> 🛡️ **Moderator:** [@Mod](root://user/${evt.userId})\n> ━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
        );
        return true;
      }

      case 'unmute': {
        const target = extractGuid(args[0]);
        if (!target) {
          await reply('❌ **Usage:** `/unmute <userId or @User>`');
          return true;
        }

        const unmuted = storage.unmuteUser(guildId, target);
        if (!unmuted) {
          await reply(`⚠️ User [@User](root://user/${target}) is not currently muted.`);
          return true;
        }

        storage.createModCase(guildId, target, evt.userId, 'UNMUTE', 'Manual unmute');
        await AuditLogger.logModAction(guildId, 'UNMUTE', target, evt.userId, 'Manual unmute');
        await reply(
          `> ### 🔊 **MEMBER UNMUTED**\n> ━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n> 👤 **User:** [@User](root://user/${target})\n> 🛡️ **Moderator:** [@Mod](root://user/${evt.userId})\n> ━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
        );
        return true;
      }

      // ==================== WELCOME & AUTOROLE COMMANDS ====================
      case 'welcome': {
        const sub = args[0]?.toLowerCase();
        if (sub === 'channel') {
          const chId = extractGuid(args[1]) || evt.channelId;
          storage.updateGuildSettings(guildId, {
            welcome: { ...settings.welcome, channelId: chId, enabled: true },
          });
          await reply(`> ✅ **Welcome messages will now be posted in:** [#Channel](root://channel/${chId})\n> *Tip: Run \`/welcome test\` to preview your welcome message!*`);
        } else if (sub === 'message') {
          const newMsg = args.slice(1).join(' ');
          if (!newMsg) {
            await reply('❌ **Usage:** `/welcome message <text with {user}, {server}, and {count}>`\n*Example:* `/welcome message Welcome {user} to {server}! 🎉`');
            return true;
          }
          storage.updateGuildSettings(guildId, {
            welcome: { ...settings.welcome, message: newMsg, enabled: true },
          });
          await reply(`> ✅ **Custom welcome message saved!**\n> 💬 *Preview:* ${newMsg}\n> *Run \`/welcome test\` to see it live.*`);
        } else if (sub === 'test') {
          const sampleMsg = settings.welcome.message
            .replace(/\{user\}/g, `[@Member](root://user/${evt.userId})`)
            .replace(/\{id\}/g, `${evt.userId}`)
            .replace(/\{count\}/g, '42')
            .replace(/\{server\}/g, 'Our Community');

          const card = [
            `> ### 👋 **WELCOME TO THE COMMUNITY!**`,
            `> ━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
            `> ${sampleMsg}`,
            `>`,
            `> 📜 *Please review the community guidelines and have fun!*`,
            `> ━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
          ].join('\n');

          if (settings.welcome.channelId) {
            try {
              await rootServer.community.channelMessages.create({
                channelId: settings.welcome.channelId as any,
                content: card,
              });
              await reply(`> ✅ **Test welcome message posted to** [#Channel](root://channel/${settings.welcome.channelId})!`);
            } catch (err: any) {
              await reply(`> ⚠️ Failed to send to configured channel. Previewing here instead:\n\n${card}`);
            }
          } else {
            await reply(`> 💡 **Welcome Preview (Channel not set yet):**\n\n${card}\n\n> *To set the welcome channel, run \`/welcome channel\` in that channel.*`);
          }
        } else if (sub === 'enable') {
          storage.updateGuildSettings(guildId, {
            welcome: { ...settings.welcome, enabled: true },
          });
          await reply('> ✅ Welcome system is now **🟢 ENABLED**.');
        } else if (sub === 'disable') {
          storage.updateGuildSettings(guildId, {
            welcome: { ...settings.welcome, enabled: false },
          });
          await reply('> 🚫 Welcome system is now **🔴 DISABLED**.');
        } else {
          await reply(
            [
              `> ### 👋 **WELCOME SYSTEM COMMANDS**`,
              `> ━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
              `> • \`/welcome channel [#channel]\` — Set welcome channel (defaults to current)`,
              `> • \`/welcome message <text>\` — Set custom greeting (use \`{user}\`, \`{server}\`, \`{count}\`)`,
              `> • \`/welcome test\` — Preview the welcome message live`,
              `> • \`/welcome enable\` / \`/welcome disable\` — Toggle system`,
              `> ━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
              `> 📍 **Current Channel:** ${settings.welcome.channelId ? `[#Channel](root://channel/${settings.welcome.channelId})` : '`Not Set`'}`,
              `> 💬 **Current Message:** *${settings.welcome.message}*`,
            ].join('\n')
          );
        }
        return true;
      }

      case 'setwelcome': {
        const chId = extractGuid(args[0]) || evt.channelId;
        storage.updateGuildSettings(guildId, {
          welcome: { ...settings.welcome, channelId: chId, enabled: true },
        });
        await reply(`> ✅ **Welcome channel configured:** [#Channel](root://channel/${chId})\n> *Tip: Run \`/welcome test\` to preview your welcome message!*`);
        return true;
      }

      case 'setautorole':
      case 'autorole': {
        const sub = args[0]?.toLowerCase();
        if (sub === 'disable' || sub === 'off') {
          storage.updateGuildSettings(guildId, {
            autorole: { ...settings.autorole, enabled: false },
          });
          await reply('> 🚫 **Auto-Role system disabled.**');
          return true;
        }

        const roleArg = sub === 'set' ? args[1] : args[0];
        const roleId = extractGuid(roleArg);
        if (!roleId) {
          await reply(
            `> 🎭 **Auto-Role Configuration:**\n> • \`/autorole <@Role or roleId>\` — Set auto-assigned role on join\n> • \`/autorole disable\` — Turn off auto-role\n> ━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n> Current: ${settings.autorole.enabled && settings.autorole.roleId ? `[@Role](root://role/${settings.autorole.roleId})` : '`Disabled`'}`
          );
          return true;
        }

        storage.updateGuildSettings(guildId, {
          autorole: { enabled: true, roleId },
        });
        await reply(`> ✅ **Auto-Role set to:** [@Role](root://role/${roleId}) *(Enabled)*`);
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
          return `> ${medal} [@Member](root://user/${u.userId}) ➔ **Level ${u.level}** (\`${u.xp.toLocaleString()} XP\`)`;
        });

        await reply(
          `> ### 🏆 **COMMUNITY LEADERBOARD — TOP 10**\n> ━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n${lines.join('\n')}\n> ━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
        );
        return true;
      }

      // ==================== SETTINGS & AUTOMOD CONFIG ====================
      case 'settings':
      case 'config': {
        const welcomeStatus = settings.welcome.enabled ? '🟢 Enabled' : '🔴 Disabled';
        const welcomeCh = settings.welcome.channelId ? `[#Channel](root://channel/${settings.welcome.channelId})` : '`Not Set`';
        const autoroleStatus = settings.autorole.enabled ? `🟢 [@Role](root://role/${settings.autorole.roleId})` : '🔴 Disabled';
        const autoModSpam = settings.automod.antiSpam ? '🟢' : '🔴';
        const autoModInvite = settings.automod.antiInvite ? '🟢' : '🔴';
        const autoModCaps = settings.automod.antiCaps ? `🟢 (${settings.automod.capsPercentage}%)` : '🔴';
        const autoModMention = settings.automod.antiMention ? `🟢 (Max: ${settings.automod.maxMentions})` : '🔴';
        const levelingStatus = settings.leveling.enabled ? '🟢 Enabled' : '🔴 Disabled';
        const logChannel = settings.logging.modLogChannelId ? `[#Logs](root://channel/${settings.logging.modLogChannelId})` : '`Not Set`';

        const dashboard = [
          `> ### ⚙️ **ROOTGUARD — SERVER SETTINGS**`,
          `> ━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
          `> 🌐 **Community ID:** \`${guildId}\``,
          `> ━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
          `> 👋 **Welcome System:** ${welcomeStatus}`,
          `> 📍 **Welcome Channel:** ${welcomeCh}`,
          `> 💬 **Custom Message:** *${settings.welcome.message.slice(0, 45)}...*`,
          `> ━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
          `> 🎭 **Auto-Role:** ${autoroleStatus}`,
          `> 📈 **Leveling & XP:** ${levelingStatus}`,
          `> 📋 **Audit Log Channel:** ${logChannel}`,
          `> ━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
          `> 🛡️ **AutoMod Filters:**`,
          `>   • Anti-Spam: ${autoModSpam} ┃ Anti-Invite: ${autoModInvite}`,
          `>   • Anti-Caps: ${autoModCaps} ┃ Anti-Mention: ${autoModMention}`,
          `>   • Banned Words: \`${settings.automod.bannedWords.length} words filtered\``,
          `> ━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
          `> 💡 *To change settings, use:*`,
          `>   \`/welcome channel #id\` • \`/welcome message <text>\``,
          `>   \`/autorole set <roleId>\` • \`/setlogs #id\` • \`/automod\``,
          `> ━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        ].join('\n');

        await reply(dashboard);
        return true;
      }

      case 'setlogs':
      case 'setlogchannel': {
        const chId = extractGuid(args[0]) || evt.channelId;
        storage.updateGuildSettings(guildId, {
          logging: { ...settings.logging, modLogChannelId: chId, enabled: true },
        });
        await reply(`> ✅ **Audit Log Channel configured:** [#Logs](root://channel/${chId})`);
        return true;
      }

      case 'setup': {
        const setupGuide = [
          `> ### 🛡️ **ROOTGUARD — QUICK SERVER SETUP**`,
          `> ━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
          `> RootGuard adapts dynamically to each community.`,
          `> Follow these 3 easy steps to configure your server:`,
          `>`,
          `> **1️⃣ Welcome System:**`,
          `> • \`/welcome channel\` *(sets current channel for welcomes)*`,
          `> • \`/welcome message Welcome {user} to {server}! 🎉\``,
          `> • \`/welcome test\` *(test preview immediately)*`,
          `>`,
          `> **2️⃣ Security & Moderation:**`,
          `> • \`/setlogs\` *(sets current channel for audit logs)*`,
          `> • \`/automod spam\` • \`/automod invites\` • \`/automod caps\``,
          `> • \`/automod badword add <word>\``,
          `>`,
          `> **3️⃣ Member Roles & Levels:**`,
          `> • \`/autorole <@Role>\` *(auto-assign role to newcomers)*`,
          `> • \`/rank\` & \`/leaderboard\` *(XP active out of the box)*`,
          `> ━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
          `> 💡 *Check your server configuration anytime with \`/settings\`.*`,
        ].join('\n');
        await reply(setupGuide);
        return true;
      }

      case 'resetsettings':
      case 'resetconfig': {
        storage.resetGuildSettings(guildId);
        await reply(
          `> 🔄 **Server settings have been reset to factory defaults.**\n> Run \`/setup\` to reconfigure RootGuard for this server.`
        );
        return true;
      }

      case 'automod': {
        const sub = args[0]?.toLowerCase();
        if (sub === 'spam') {
          const newState = !settings.automod.antiSpam;
          storage.updateGuildSettings(guildId, {
            automod: { ...settings.automod, antiSpam: newState },
          });
          await reply(`> 🛡️ Anti-Spam filter is now: **${newState ? '🟢 ENABLED' : '🔴 DISABLED'}**`);
        } else if (sub === 'invites') {
          const newState = !settings.automod.antiInvite;
          storage.updateGuildSettings(guildId, {
            automod: { ...settings.automod, antiInvite: newState },
          });
          await reply(`> 🛡️ Anti-Invite filter is now: **${newState ? '🟢 ENABLED' : '🔴 DISABLED'}**`);
        } else if (sub === 'caps') {
          const newState = !settings.automod.antiCaps;
          storage.updateGuildSettings(guildId, {
            automod: { ...settings.automod, antiCaps: newState },
          });
          await reply(`> 🛡️ Anti-Caps filter is now: **${newState ? '🟢 ENABLED' : '🔴 DISABLED'}**`);
        } else if (sub === 'badword') {
          const action = args[1]?.toLowerCase();
          const word = args.slice(2).join(' ').toLowerCase();
          if (action === 'add' && word) {
            const list = [...new Set([...settings.automod.bannedWords, word])];
            storage.updateGuildSettings(guildId, {
              automod: { ...settings.automod, bannedWords: list },
            });
            await reply(`> ✅ Added \`${word}\` to filtered words list.`);
          } else if (action === 'remove' && word) {
            const list = settings.automod.bannedWords.filter((w) => w !== word);
            storage.updateGuildSettings(guildId, {
              automod: { ...settings.automod, bannedWords: list },
            });
            await reply(`> ✅ Removed \`${word}\` from filtered words list.`);
          } else {
            await reply(`> ℹ️ **Usage:** \`/automod badword add <word>\` or \`/automod badword remove <word>\``);
          }
        } else {
          await reply(
            `> ### 🛡️ **AUTOMOD TUNING COMMANDS**\n> ━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n> • \`/automod spam\` — Toggle anti-spam filter\n> • \`/automod invites\` — Toggle anti-invite link filter\n> • \`/automod caps\` — Toggle excessive caps filter\n> • \`/automod badword add <word>\` — Add word to blacklist\n> • \`/automod badword remove <word>\` — Remove word\n> ━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
          );
        }
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
          `  \`/mute <user> [mins] [reason]\` — Mutes a user (chat auto-delete)`,
          `  \`/unmute <user>\` — Restores user speaking permissions`,
          `  \`/warn <user> [reason]\` — Issues an official infraction`,
          `  \`/warnings <user>\` — View user warnings history`,
          `  \`/clear <amount>\` — Purge bulk messages (1-100)`,
          ``,
          `👋 **Welcome & Autorole:**`,
          `  \`/welcome channel [#id]\` — Setup join announcements channel`,
          `  \`/welcome message <text>\` — Set greeting ({user}, {server}, {count})`,
          `  \`/welcome test\` — Preview the welcome message live`,
          `  \`/autorole <@Role>\` — Auto-assign role on member join`,
          ``,
          `📈 **Leveling & XP:**`,
          `  \`/rank\` / \`/level\` — View your rank card and level progress`,
          `  \`/leaderboard\` — View top 10 community chatters`,
          ``,
          `⚙️ **Server Configuration:**`,
          `  \`/setup\` — Quick 3-step setup guide for new servers`,
          `  \`/settings\` / \`/config\` — View live server dashboard`,
          `  \`/setlogs [channelId]\` — Set audit log channel`,
          `  \`/automod <spam|invites|caps>\` — Toggle specific filter`,
          `  \`/automod badword <add|remove> <word>\` — Manage blacklist`,
          `  \`/resetsettings\` — Reset server config to factory defaults`,
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
