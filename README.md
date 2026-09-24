# RootGuard — Management, Security & Community Bot for RootApp

RootGuard is the enterprise-grade management, security, and community engagement bot for RootApp (`rootapp.com`). Built on the official `@rootsdk/server-bot` with TypeScript, designed for 24/7 autonomous cloud execution on RootApp Cloud.

## Modules & Architecture

### 1. Moderation & Security
- **Commands**:
  - `/ban <user> [reason]` — Bans a user from the community with root API `createBan`.
  - `/unban <user>` — Lifts ban from a user.
  - `/kick <user> [reason]` — Kicks a member with root API `kick`.
  - `/mute <user> <duration> [reason]` — Mutes text & voice channels.
  - `/unmute <user>` — Unmutes a user.
  - `/timeout <user> <duration>` — Applies temporary timeout.
  - `/warn <user> [reason]` — Issues an official warning.
  - `/warnings <user>` — Displays user infraction history.
  - `/clear <amount>` — Bulk deletes messages.
  - `/slowmode <seconds>` — Configures channel rate-limit.
  - `/lock` & `/unlock` — Locks down channel permissions.
- **Warning Tier Automation**:
  - 1-2 Warnings: Logged in `#mod-logs`.
  - 3 Warnings: Automatic 10-minute Timeout.
  - 4 Warnings: Automatic Kick.
  - 5 Warnings: Automatic Permanent Ban.

### 2. AutoMod Engine
- **Spam Detection**: Detects repeated messages and message flooding (>5 messages in 3 seconds).
- **Mention Spam Protection**: Deletes messages with mass mentions (`@everyone` or >5 user tags).
- **Invite Link Filter**: Blocks unauthorized external invite links.
- **Caps Spam**: Deletes messages with >70% uppercase characters.
- **Banned Words**: Custom configurable word blacklist with regex matching.

### 3. Welcome & Autorole
- **Welcome System**:
  - Welcomes new members on join with member count and server guide.
  - Configurable channel (`/welcome channel`), custom message, and toggle (`/welcome enable/disable`).
- **Autorole System**:
  - Automatically assigns community roles (`CommunityRoleGuid`) to incoming members.
  - Commands: `/autorole set <role>`, `/autorole remove`, `/autorole enable/disable`.

### 4. Leveling & XP System
- **Activity Reward**: +10 to +25 XP per message with a 60-second anti-spam cooldown.
- **Formulas**: Required XP = `100 * (Level ^ 1.5)`.
- **Rank Cards & Leaderboard**: `/rank`, `/level`, `/leaderboard`.
- **Level Rewards**: Automated role rewards at Levels 5, 10, 20, 30, 50.

### 5. Multi-Channel Audit Logging
- Dedicated log channels: `#mod-logs`, `#join-logs`, `#message-logs`, `#server-logs`.
- Logs member bans, kicks, mutes, message deletions, edits, and role modifications.
