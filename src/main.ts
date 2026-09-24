// src/main.ts
// RootGuard Main Entry Point - Management, Moderation, AutoMod, Welcome, and Leveling Bot

import {
  rootServer,
  RootBotStartState,
  ChannelMessageEvent,
  ChannelMessageCreatedEvent,
  ChannelMessageDeletedEvent,
  CommunityMemberEvent,
  CommunityMemberAttachEvent,
  CommunityMemberDetachEvent,
  CommunityEvent,
  CommunityJoinedEvent,
  ChannelGuid,
  CommunityRoleGuid,
  MessageType,
  RootApiException,
} from '@rootsdk/server-bot';

import { storage } from './services/storage';
import { AutoModService } from './services/automod';
import { LevelingService } from './services/leveling';
import { AuditLogger } from './services/logger';
import { CommandHandler } from './commands/handler';

async function onStarting(state: RootBotStartState): Promise<void> {
  console.log('🛡️ Starting RootGuard Enterprise Bot...');

  // 1. Message Created Listener (Commands, AutoMod, Leveling)
  rootServer.community.channelMessages.on(
    ChannelMessageEvent.ChannelMessageCreated,
    handleMessageCreated
  );

  // 2. Member Joined Listener (Welcome & Autorole)
  rootServer.community.communityMembers.on(
    CommunityMemberEvent.CommunityMemberAttach,
    handleMemberJoined
  );

  // 3. Member Left Listener (Leave Audit Logging)
  rootServer.community.communityMembers.on(
    CommunityMemberEvent.CommunityMemberDetach,
    handleMemberLeft
  );

  // 4. Message Deleted Listener (Audit Logging)
  rootServer.community.channelMessages.on(
    ChannelMessageEvent.ChannelMessageDeleted,
    handleMessageDeleted
  );

  // 5. Bot Added to Server Listener (Dynamic Multi-Server Adaptation)
  rootServer.community.communities.on(
    CommunityEvent.CommunityJoined,
    handleCommunityJoined
  );

  console.log('✅ RootGuard successfully initialized and listening to community events!');
}

async function handleMessageCreated(evt: ChannelMessageCreatedEvent): Promise<void> {
  // Ignore system messages or messages without text
  if (evt.messageType === MessageType.System || !evt.messageContent) return;

  const guildId = evt.communityId || 'default-community';
  const userId = evt.userId;
  const content = evt.messageContent;

  try {
    // 0. Check if User is Muted
    if (storage.isMuted(guildId, userId)) {
      try {
        await rootServer.community.channelMessages.delete({
          id: evt.id,
          channelId: evt.channelId,
        });
      } catch (delErr) {}
      return;
    }

    // A. Check AutoMod Rules
    const autoModResult = AutoModService.checkMessage(guildId, userId, content);
    if (autoModResult.triggered) {
      // AutoMod triggered - delete message and notify
      try {
        await rootServer.community.channelMessages.delete({
          id: evt.id,
          channelId: evt.channelId,
        });
      } catch (delErr) {
        console.warn('AutoMod could not delete message (insufficient permissions):', delErr);
      }

      await rootServer.community.channelMessages.create({
        channelId: evt.channelId,
        content: `🛡️ **AutoMod Alert:** Message from \`${userId}\` was blocked.\n📄 **Reason:** ${autoModResult.reason}`,
      });

      await AuditLogger.logModAction(
        guildId,
        'AUTOMOD_VIOLATION',
        userId,
        'RootGuard AutoMod',
        autoModResult.reason || 'AutoMod violation'
      );
      return;
    }

    // B. Check Command Execution
    const isCommand = await CommandHandler.handleCommand(evt);
    if (isCommand) {
      return; // Handled as command, do not award XP
    }

    // C. Award Leveling XP
    const levelResult = LevelingService.processMessage(guildId, userId);
    if (levelResult.leveledUp) {
      await rootServer.community.channelMessages.create({
        channelId: evt.channelId,
        content: `🎉 **LEVEL UP!** Congratulations \`${userId}\`, you just advanced to **Level ${levelResult.newLevel}**! ⭐`,
      });

      // Award Level Role if configured
      if (levelResult.rewardRoleId) {
        try {
          await rootServer.community.communityMemberRoles.setPrimary({
            userId: evt.userId,
            communityRoleId: levelResult.rewardRoleId as CommunityRoleGuid,
          });
        } catch (roleErr) {
          console.warn('Failed to assign level role reward:', roleErr);
        }
      }
    }
  } catch (err: unknown) {
    if (err instanceof RootApiException) {
      console.error('Root API Exception in onMessage:', err.errorCode, err.message);
    } else {
      console.error('Unexpected error in onMessage:', err);
    }
  }
}

async function handleMemberJoined(evt: CommunityMemberAttachEvent): Promise<void> {
  const guildId = evt.communityId || 'default-community';
  const userId = evt.userId;
  const settings = storage.getGuildSettings(guildId);

  console.log(`👋 New member joined community ${guildId}: ${userId}`);

  // 1. Welcome Message
  if (settings.welcome.enabled && settings.welcome.channelId) {
    const welcomeMsg = settings.welcome.message
      .replace(/\{user\}/g, `[@Member](root://user/${userId})`)
      .replace(/\{id\}/g, `${userId}`)
      .replace(/\{count\}/g, 'Active Member')
      .replace(/\{server\}/g, 'Our Community');

    try {
      await rootServer.community.channelMessages.create({
        channelId: settings.welcome.channelId as ChannelGuid,
        content: [
          `> ### 👋 **WELCOME TO THE COMMUNITY!**`,
          `> ━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
          `> ${welcomeMsg}`,
          `>`,
          `> 📜 *Please review the community guidelines and have fun!*`,
          `> ━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        ].join('\n'),
      });
    } catch (err) {
      console.error('Failed to post welcome message:', err);
    }
  }

  // 2. Autorole
  if (settings.autorole.enabled && settings.autorole.roleId) {
    try {
      await rootServer.community.communityMemberRoles.setPrimary({
        userId: evt.userId,
        communityRoleId: settings.autorole.roleId as CommunityRoleGuid,
      });
      console.log(`✅ Autorole ${settings.autorole.roleId} assigned to ${userId}`);
    } catch (err) {
      console.error('Failed to assign autorole:', err);
    }
  }

  // 3. Log Join
  await AuditLogger.logMemberJoin(guildId, userId, 1);
}

async function handleCommunityJoined(evt: CommunityJoinedEvent): Promise<void> {
  const guildId = evt.communityId;
  console.log(`🎉 RootGuard was added to a new community: ${guildId}`);
  // Initialize isolated per-server settings in database
  storage.getGuildSettings(guildId);
}

async function handleMemberLeft(evt: CommunityMemberDetachEvent): Promise<void> {
  const guildId = evt.communityId || 'default-community';
  console.log(`📤 Member left community ${guildId}: ${evt.userId}`);
  await AuditLogger.logMemberLeave(guildId, evt.userId);
}

async function handleMessageDeleted(evt: ChannelMessageDeletedEvent): Promise<void> {
  const guildId = evt.communityId || 'default-community';
  await AuditLogger.logMessageDelete(
    guildId,
    evt.channelId,
    'Member',
    `Message [ID: ${evt.id}]`
  );
}

// Start Root Bot
(async () => {
  try {
    await rootServer.lifecycle.start(onStarting);
  } catch (err) {
    console.error('Fatal: Failed to start RootGuard server:', err);
  }
})();
