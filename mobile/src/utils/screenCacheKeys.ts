export function homeCacheKey(userId: string): string {
  return `screen-cache:home:${userId}`;
}

export function gamePlanCacheKey(userId: string): string {
  return `screen-cache:game-plan:${userId}`;
}

export function profileXpCacheKey(userId: string): string {
  return `screen-cache:profile-xp:${userId}`;
}

export function calorieLogCacheKey(userId: string, localDate: string): string {
  return `screen-cache:calorie-log:${userId}:${localDate}`;
}

export function coachSummaryCacheKey(
  userId: string,
  domain: "nutrition" | "workout",
  cadence: string,
  localDate: string,
): string {
  return `screen-cache:coach-summary:${userId}:${domain}:${cadence}:${localDate}`;
}
