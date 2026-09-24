// src/types.ts
// Comprehensive Type Definitions for RootGuard Bot

export interface WelcomeConfig {
  enabled: boolean;
  channelId?: string;
  message: string;
  dmEnabled: boolean;
}

export interface AutoroleConfig {
  enabled: boolean;
  roleId?: string;
}

export interface WarningTierPunishment {
  threshold: number;
  action: 'timeout' | 'kick' | 'ban';
  durationMinutes?: number;
}

export interface ModerationConfig {
  logChannelId?: string;
  maxWarnings: number;
  punishments: WarningTierPunishment[];
}

export interface AutoModConfig {
  enabled: boolean;
  antiSpam: boolean;
  antiInvite: boolean;
  antiCaps: boolean;
  antiMention: boolean;
  maxMentions: number;
  capsPercentage: number;
  bannedWords: string[];
}

export interface LevelingConfig {
  enabled: boolean;
  xpPerMessageMin: number;
  xpPerMessageMax: number;
  cooldownSeconds: number;
  levelRoles: Record<number, string>; // Level -> RoleGuid
}

export interface LoggingConfig {
  enabled: boolean;
  modLogChannelId?: string;
  joinLogChannelId?: string;
  messageLogChannelId?: string;
  serverLogChannelId?: string;
}

export interface GuildSettings {
  guildId: string;
  prefix: string;
  language: string;
  welcome: WelcomeConfig;
  autorole: AutoroleConfig;
  moderation: ModerationConfig;
  automod: AutoModConfig;
  leveling: LevelingConfig;
  logging: LoggingConfig;
}

export interface WarningRecord {
  id: string;
  userId: string;
  moderatorId: string;
  reason: string;
  timestamp: number;
}

export interface ModCaseRecord {
  caseId: number;
  guildId: string;
  userId: string;
  moderatorId: string;
  action: 'WARN' | 'KICK' | 'BAN' | 'UNBAN' | 'MUTE' | 'UNMUTE' | 'TIMEOUT';
  reason: string;
  duration?: string;
  timestamp: number;
}

export interface UserLevelData {
  userId: string;
  xp: number;
  level: number;
  lastXpTime: number;
}
