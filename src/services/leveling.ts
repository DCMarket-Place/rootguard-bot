// src/services/leveling.ts
// Leveling, XP and Rank Card System for RootGuard

import { storage } from './storage';
import { UserLevelData } from '../types';

export interface LevelUpEvent {
  leveledUp: boolean;
  oldLevel: number;
  newLevel: number;
  rewardRoleId?: string;
}

export class LevelingService {
  /**
   * Calculates total XP required to reach a specific level.
   * Formula: 100 * (Level ^ 1.5)
   */
  public static getRequiredXp(level: number): number {
    if (level <= 1) return 100;
    return Math.floor(100 * Math.pow(level, 1.5));
  }

  /**
   * Processes an incoming message and awards XP if cooldown has elapsed.
   */
  public static processMessage(guildId: string, userId: string): LevelUpEvent {
    const settings = storage.getGuildSettings(guildId).leveling;
    if (!settings.enabled) {
      return { leveledUp: false, oldLevel: 1, newLevel: 1 };
    }

    const userData = storage.getUserLevel(guildId, userId);
    const now = Date.now();
    const cooldownMs = settings.cooldownSeconds * 1000;

    // Check Cooldown
    if (now - userData.lastXpTime < cooldownMs) {
      return { leveledUp: false, oldLevel: userData.level, newLevel: userData.level };
    }

    // Award random XP between min and max
    const gainedXp = Math.floor(
      Math.random() * (settings.xpPerMessageMax - settings.xpPerMessageMin + 1) +
        settings.xpPerMessageMin
    );

    let newXp = userData.xp + gainedXp;
    let currentLevel = userData.level;
    let didLevelUp = false;

    // Check if new level is reached
    while (newXp >= this.getRequiredXp(currentLevel)) {
      currentLevel++;
      didLevelUp = true;
    }

    storage.updateUserLevel(guildId, userId, {
      xp: newXp,
      level: currentLevel,
      lastXpTime: now,
    });

    let rewardRoleId: string | undefined = undefined;
    if (didLevelUp && settings.levelRoles[currentLevel]) {
      rewardRoleId = settings.levelRoles[currentLevel];
    }

    return {
      leveledUp: didLevelUp,
      oldLevel: userData.level,
      newLevel: currentLevel,
      rewardRoleId,
    };
  }

  /**
   * Renders a clean ASCII Rank Card.
   */
  public static renderRankCard(
    userId: string,
    data: UserLevelData,
    rank: number
  ): string {
    const requiredXp = this.getRequiredXp(data.level);
    const prevLevelXp = data.level > 1 ? this.getRequiredXp(data.level - 1) : 0;
    const progressXp = Math.max(0, data.xp - prevLevelXp);
    const neededXp = Math.max(1, requiredXp - prevLevelXp);
    const percentage = Math.min(100, Math.floor((progressXp / neededXp) * 100));

    const totalBars = 12;
    const filledBars = Math.floor((percentage / 100) * totalBars);
    const emptyBars = totalBars - filledBars;
    const progressBar = '▰'.repeat(filledBars) + '▱'.repeat(emptyBars);

    return [
      `> ### 🎖️ **LEVEL & RANK STATUS**`,
      `> ━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      `> 👤 **Member:** [@User](root://user/${userId})`,
      `> 🏆 **Server Rank:** \`#${rank}\``,
      `> ⭐ **Current Level:** \`Level ${data.level}\``,
      `> ⚡ **Experience:** \`${data.xp.toLocaleString()} / ${requiredXp.toLocaleString()} XP\``,
      `> 📊 **Progress:** \`[${progressBar}] ${percentage}%\``,
      `> ━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    ].join('\n');
  }
}
