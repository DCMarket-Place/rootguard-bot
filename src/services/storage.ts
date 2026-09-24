// src/services/storage.ts
// Local persistent storage manager for Guild Settings, Warnings, Cases, and XP Levels

import * as fs from 'fs';
import * as path from 'path';
import { GuildSettings, WarningRecord, ModCaseRecord, UserLevelData } from '../types';

interface BotDatabase {
  guilds: Record<string, GuildSettings>;
  warnings: Record<string, WarningRecord[]>; // userId -> WarningRecord[]
  cases: ModCaseRecord[];
  levels: Record<string, Record<string, UserLevelData>>; // guildId -> userId -> UserLevelData
}

export class StorageService {
  private dbPath: string;
  private db: BotDatabase;

  constructor() {
    const dataDir = path.join(process.cwd(), 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    this.dbPath = path.join(dataDir, 'bot_data.json');
    this.db = this.load();
  }

  private getDefaultGuildSettings(guildId: string): GuildSettings {
    return {
      guildId,
      prefix: '/',
      language: 'en',
      welcome: {
        enabled: true,
        message: 'Welcome {user} to the community! You are member #{count}.',
        dmEnabled: false,
      },
      autorole: {
        enabled: false,
      },
      moderation: {
        maxWarnings: 5,
        punishments: [
          { threshold: 3, action: 'timeout', durationMinutes: 10 },
          { threshold: 4, action: 'kick' },
          { threshold: 5, action: 'ban' },
        ],
      },
      automod: {
        enabled: true,
        antiSpam: true,
        antiInvite: true,
        antiCaps: true,
        antiMention: true,
        maxMentions: 5,
        capsPercentage: 70,
        bannedWords: ['nigger', 'faggot', 'scam', 'free nitro', 'airdrop'],
      },
      leveling: {
        enabled: true,
        xpPerMessageMin: 15,
        xpPerMessageMax: 25,
        cooldownSeconds: 60,
        levelRoles: {},
      },
      logging: {
        enabled: true,
      },
    };
  }

  private load(): BotDatabase {
    try {
      if (fs.existsSync(this.dbPath)) {
        const raw = fs.readFileSync(this.dbPath, 'utf-8');
        return JSON.parse(raw);
      }
    } catch (err) {
      console.error('Failed to load database, creating fresh copy:', err);
    }
    return { guilds: {}, warnings: {}, cases: [], levels: {} };
  }

  public save(): void {
    try {
      const tempPath = `${this.dbPath}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify(this.db, null, 2), 'utf-8');
      fs.renameSync(tempPath, this.dbPath);
    } catch (err) {
      console.error('Failed to persist database:', err);
    }
  }

  // Guild Settings
  public getGuildSettings(guildId: string): GuildSettings {
    if (!this.db.guilds[guildId]) {
      this.db.guilds[guildId] = this.getDefaultGuildSettings(guildId);
      this.save();
    }
    return this.db.guilds[guildId];
  }

  public updateGuildSettings(guildId: string, partial: Partial<GuildSettings>): GuildSettings {
    const current = this.getGuildSettings(guildId);
    this.db.guilds[guildId] = { ...current, ...partial };
    this.save();
    return this.db.guilds[guildId];
  }

  // Warnings
  public addWarning(guildId: string, userId: string, moderatorId: string, reason: string): WarningRecord {
    if (!this.db.warnings[userId]) {
      this.db.warnings[userId] = [];
    }
    const warning: WarningRecord = {
      id: `WARN-${Date.now().toString().slice(-6)}`,
      userId,
      moderatorId,
      reason,
      timestamp: Date.now(),
    };
    this.db.warnings[userId].push(warning);
    this.save();
    return warning;
  }

  public getWarnings(userId: string): WarningRecord[] {
    return this.db.warnings[userId] || [];
  }

  public clearWarnings(userId: string): void {
    delete this.db.warnings[userId];
    this.save();
  }

  // Moderation Cases
  public createModCase(
    guildId: string,
    userId: string,
    moderatorId: string,
    action: ModCaseRecord['action'],
    reason: string,
    duration?: string
  ): ModCaseRecord {
    const caseRecord: ModCaseRecord = {
      caseId: this.db.cases.length + 1,
      guildId,
      userId,
      moderatorId,
      action,
      reason,
      duration,
      timestamp: Date.now(),
    };
    this.db.cases.push(caseRecord);
    this.save();
    return caseRecord;
  }

  public getModCase(caseId: number): ModCaseRecord | undefined {
    return this.db.cases.find((c) => c.caseId === caseId);
  }

  // Leveling Data
  public getUserLevel(guildId: string, userId: string): UserLevelData {
    if (!this.db.levels[guildId]) {
      this.db.levels[guildId] = {};
    }
    if (!this.db.levels[guildId][userId]) {
      this.db.levels[guildId][userId] = {
        userId,
        xp: 0,
        level: 1,
        lastXpTime: 0,
      };
    }
    return this.db.levels[guildId][userId];
  }

  public updateUserLevel(guildId: string, userId: string, data: Partial<UserLevelData>): UserLevelData {
    const current = this.getUserLevel(guildId, userId);
    this.db.levels[guildId][userId] = { ...current, ...data };
    this.save();
    return this.db.levels[guildId][userId];
  }

  public getLeaderboard(guildId: string, limit: number = 10): UserLevelData[] {
    if (!this.db.levels[guildId]) return [];
    return Object.values(this.db.levels[guildId])
      .sort((a, b) => b.xp - a.xp)
      .slice(0, limit);
  }
}

export const storage = new StorageService();
