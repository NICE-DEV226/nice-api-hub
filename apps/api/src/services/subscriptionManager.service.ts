/**
 * Subscription Manager Service
 * Handles automatic subscription expiration and renewal reminders
 * Author: NICE-DEV
 */

import { prisma } from '../lib/prisma.js';
import { logger } from '../utils/logger.js';

/**
 * Check and expire subscriptions that have passed their end date
 * Should be run periodically (e.g., every hour via cron)
 */
export async function checkExpiredSubscriptions(): Promise<void> {
  const now = new Date();

  try {
    // Find active subscriptions that have expired
    const expiredSubscriptions = await prisma.subscription.findMany({
      where: {
        status: 'ACTIVE',
        currentPeriodEnd: { lt: now },
      },
      include: {
        user: { select: { id: true, email: true, name: true } },
      },
    });

    if (expiredSubscriptions.length === 0) {
      return;
    }

    logger.info(`[SubscriptionManager] Found ${expiredSubscriptions.length} expired subscriptions`);

    for (const subscription of expiredSubscriptions) {
      try {
        // Check if marked for cancellation
        if (subscription.cancelAtPeriodEnd) {
          // Downgrade to FREE
          await prisma.$transaction(async (tx) => {
            await tx.subscription.update({
              where: { id: subscription.id },
              data: { status: 'CANCELED' },
            });

            const previousPlan = (subscription.metadata as any)?.plan || 'UNKNOWN';

            await tx.user.update({
              where: { id: subscription.userId },
              data: { plan: 'FREE' },
            });

            await tx.planChangeHistory.create({
              data: {
                userId: subscription.userId,
                previousPlan,
                newPlan: 'FREE',
                changedBy: subscription.userId,
                changedByEmail: subscription.user.email,
                reason: 'Abonnement expiré - annulation programmée',
              },
            });
          });

          logger.info(`[SubscriptionManager] Cancelled subscription for user ${subscription.userId}`);
        } else {
          // Mark as past due (awaiting renewal)
          await prisma.subscription.update({
            where: { id: subscription.id },
            data: { status: 'PAST_DUE' },
          });

          logger.info(`[SubscriptionManager] Marked subscription as PAST_DUE for user ${subscription.userId}`);
        }
      } catch (error) {
        logger.error(`[SubscriptionManager] Error processing subscription ${subscription.id}:`, error);
      }
    }
  } catch (error) {
    logger.error('[SubscriptionManager] Error checking expired subscriptions:', error);
  }
}

/**
 * Get subscriptions expiring soon (for reminder emails)
 * @param daysBeforeExpiry Number of days before expiry to check
 */
export async function getExpiringSubscriptions(daysBeforeExpiry: number = 7): Promise<any[]> {
  const now = new Date();
  const futureDate = new Date(now);
  futureDate.setDate(futureDate.getDate() + daysBeforeExpiry);

  try {
    const expiringSubscriptions = await prisma.subscription.findMany({
      where: {
        status: 'ACTIVE',
        cancelAtPeriodEnd: false,
        currentPeriodEnd: {
          gte: now,
          lte: futureDate,
        },
      },
      include: {
        user: { select: { id: true, email: true, name: true, plan: true } },
      },
    });

    return expiringSubscriptions;
  } catch (error) {
    logger.error('[SubscriptionManager] Error getting expiring subscriptions:', error);
    return [];
  }
}

/**
 * Get subscription statistics
 */
export async function getSubscriptionStats() {
  try {
    const [
      totalActive,
      totalPastDue,
      totalCanceled,
      expiringThisWeek,
      byPlan,
    ] = await Promise.all([
      prisma.subscription.count({ where: { status: 'ACTIVE' } }),
      prisma.subscription.count({ where: { status: 'PAST_DUE' } }),
      prisma.subscription.count({ where: { status: 'CANCELED' } }),
      getExpiringSubscriptions(7).then(s => s.length),
      prisma.user.groupBy({
        by: ['plan'],
        _count: { plan: true },
        where: { plan: { not: 'FREE' } },
      }),
    ]);

    return {
      totalActive,
      totalPastDue,
      totalCanceled,
      expiringThisWeek,
      byPlan: byPlan.map(p => ({ plan: p.plan, count: p._count.plan })),
    };
  } catch (error) {
    logger.error('[SubscriptionManager] Error getting stats:', error);
    return null;
  }
}

/**
 * Initialize subscription checker (runs every hour)
 */
export function initSubscriptionChecker(): void {
  // Run immediately on startup
  checkExpiredSubscriptions();

  // Then run every hour
  setInterval(() => {
    checkExpiredSubscriptions();
  }, 60 * 60 * 1000); // 1 hour

  logger.info('[SubscriptionManager] Subscription checker initialized');
}
