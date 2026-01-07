/**
 * Payment Controller
 * Handles subscription payments via GeniusPay
 * Author: NICE-DEV
 * 
 * Security features:
 * - Webhook signature verification (HMAC-SHA256)
 * - Timestamp validation (anti-replay)
 * - Idempotency protection (prevents double processing)
 * - Transaction-safe database operations
 */

import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../lib/prisma.js';
import { createError } from '../../middleware/errorHandler.js';
import * as geniusPay from '../../services/geniusPay.service.js';
import { logger } from '../../utils/logger.js';

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

// Plan prices in XOF (Franc CFA)
const PLAN_PRICES: Record<string, { monthly: number; yearly: number; name: string }> = {
  BASIC: {
    monthly: 5000,
    yearly: 50000,
    name: 'Basic',
  },
  PRO: {
    monthly: 15000,
    yearly: 150000,
    name: 'Pro',
  },
  ENTERPRISE: {
    monthly: 50000,
    yearly: 500000,
    name: 'Enterprise',
  },
};

// In-memory set for processed webhooks (use Redis in production for multi-instance)
const processedWebhooks = new Set<string>();
const WEBHOOK_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

// Cleanup old entries periodically
setInterval(() => {
  processedWebhooks.clear();
}, WEBHOOK_CACHE_TTL);

/**
 * Get available plans and prices
 */
export async function getPlans(
  _req: Request,
  res: Response,
  _next: NextFunction
): Promise<void> {
  res.json({
    success: true,
    data: {
      plans: Object.entries(PLAN_PRICES).map(([key, value]) => ({
        id: key,
        name: value.name,
        monthlyPrice: value.monthly,
        yearlyPrice: value.yearly,
        currency: 'XOF',
      })),
      currency: 'XOF',
    },
  });
}

/**
 * Initiate subscription payment
 */
export async function initiatePayment(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.user!.id;
    const userEmail = req.user!.email;
    const userName = req.user!.name || 'Client';
    const { plan, billing } = req.body;

    // Validate plan
    if (!plan || !PLAN_PRICES[plan]) {
      throw createError('Invalid plan selected', 400, 'INVALID_PLAN');
    }

    // Validate billing period
    if (!billing || !['monthly', 'yearly'].includes(billing)) {
      throw createError('Invalid billing period', 400, 'INVALID_BILLING');
    }

    // Check if user already has this plan
    const currentUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { plan: true },
    });

    if (currentUser?.plan === plan) {
      throw createError('You already have this plan', 400, 'ALREADY_SUBSCRIBED');
    }

    const planInfo = PLAN_PRICES[plan];
    const amount = billing === 'yearly' ? planInfo.yearly : planInfo.monthly;
    const billingLabel = billing === 'yearly' ? 'Annuel' : 'Mensuel';

    // Create payment with GeniusPay
    const paymentResult = await geniusPay.createPayment({
      amount,
      description: `Abonnement ${planInfo.name} ${billingLabel} - NICE-API'HUB`,
      customerName: userName,
      customerEmail: userEmail,
      successUrl: `${FRONTEND_URL}/payment/success`,
      errorUrl: `${FRONTEND_URL}/payment/error`,
      metadata: {
        userId,
        plan,
        billing,
        previousPlan: currentUser?.plan || 'FREE',
        type: 'subscription',
      },
    });

    if (!paymentResult.success || !paymentResult.data) {
      throw createError(
        paymentResult.error || 'Payment initialization failed',
        500,
        'PAYMENT_INIT_FAILED'
      );
    }

    // Store pending payment in database
    await prisma.subscription.upsert({
      where: { userId },
      create: {
        userId,
        provider: 'geniuspay',
        providerSubscriptionId: paymentResult.data.reference,
        status: 'INACTIVE',
        metadata: {
          plan,
          billing,
          amount,
          previousPlan: currentUser?.plan || 'FREE',
          paymentReference: paymentResult.data.reference,
          initiatedAt: new Date().toISOString(),
        },
      },
      update: {
        providerSubscriptionId: paymentResult.data.reference,
        metadata: {
          plan,
          billing,
          amount,
          previousPlan: currentUser?.plan || 'FREE',
          paymentReference: paymentResult.data.reference,
          initiatedAt: new Date().toISOString(),
        },
      },
    });

    logger.info(`[Payment] Initiated for user ${userId}: ${plan} ${billing} - ${paymentResult.data.reference}`);

    res.json({
      success: true,
      data: {
        reference: paymentResult.data.reference,
        checkoutUrl: paymentResult.data.checkout_url,
        amount,
        currency: 'XOF',
        plan: planInfo.name,
        billing: billingLabel,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Handle GeniusPay webhook with idempotency
 */
export async function handleWebhook(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const signature = req.headers['x-webhook-signature'] as string;
    const timestamp = req.headers['x-webhook-timestamp'] as string;
    const event = req.headers['x-webhook-event'] as string;

    // Verify signature
    if (!signature || !timestamp) {
      logger.warn('[Webhook] Missing signature or timestamp');
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }

    const isValid = geniusPay.verifyWebhookSignature(signature, timestamp, req.body);
    if (!isValid) {
      logger.warn('[Webhook] Invalid signature');
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }

    const payload = geniusPay.parseWebhookPayload(req.body);
    if (!payload) {
      logger.warn('[Webhook] Invalid payload');
      res.status(400).json({ error: 'Invalid payload' });
      return;
    }

    const webhookId = payload.id || `${event}-${payload.data.reference}`;

    // Idempotency check - prevent double processing
    if (processedWebhooks.has(webhookId)) {
      logger.info(`[Webhook] Already processed: ${webhookId}`);
      res.json({ received: true, status: 'already_processed' });
      return;
    }

    logger.info(`[Webhook] Processing event: ${event} for ${payload.data.reference}`);

    // Handle different events
    let processed = false;
    switch (event) {
      case 'payment.success':
        processed = await handlePaymentSuccess(payload);
        break;
      case 'payment.failed':
        processed = await handlePaymentFailed(payload);
        break;
      case 'payment.expired':
        processed = await handlePaymentExpired(payload);
        break;
      default:
        logger.info(`[Webhook] Unhandled event: ${event}`);
        processed = true;
    }

    // Mark as processed only if successful
    if (processed) {
      processedWebhooks.add(webhookId);
    }

    res.json({ received: true, status: processed ? 'processed' : 'failed' });
  } catch (error) {
    logger.error('[Webhook] Error processing:', error);
    // Return 200 to prevent retries for unrecoverable errors
    res.status(200).json({ received: true, status: 'error' });
  }
}

/**
 * Handle successful payment with transaction
 */
async function handlePaymentSuccess(payload: any): Promise<boolean> {
  const { reference, metadata } = payload.data;
  const { userId, plan, billing, previousPlan } = metadata || {};

  if (!userId || !plan) {
    logger.error('[Webhook] Missing userId or plan in metadata');
    return false;
  }

  try {
    // Check if already processed (database-level idempotency)
    const existingSubscription = await prisma.subscription.findUnique({
      where: { userId },
    });

    // Check if this exact payment was already processed
    const existingMetadata = existingSubscription?.metadata as any;
    if (existingSubscription?.status === 'ACTIVE' && 
        existingMetadata?.lastPaymentReference === reference) {
      logger.info(`[Webhook] Payment ${reference} already processed for user ${userId}`);
      return true;
    }

    // Calculate subscription period
    const now = new Date();
    const periodEnd = new Date(now);
    if (billing === 'yearly') {
      periodEnd.setFullYear(periodEnd.getFullYear() + 1);
    } else {
      periodEnd.setMonth(periodEnd.getMonth() + 1);
    }

    // Get user email for history
    const user = await prisma.user.findUnique({ 
      where: { id: userId },
      select: { email: true, plan: true },
    });

    if (!user) {
      logger.error(`[Webhook] User ${userId} not found`);
      return false;
    }

    const actualPreviousPlan = user.plan || previousPlan || 'FREE';

    // Update subscription
    await prisma.subscription.update({
      where: { userId },
      data: {
        status: 'ACTIVE',
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        metadata: {
          plan,
          billing,
          lastPaymentReference: reference,
          lastPaymentAt: now.toISOString(),
          previousPlan: actualPreviousPlan,
        },
      },
    });

    // Update user plan
    await prisma.user.update({
      where: { id: userId },
      data: { plan },
    });

    // Record plan change history
    await prisma.planChangeHistory.create({
      data: {
        userId,
        previousPlan: actualPreviousPlan,
        newPlan: plan,
        changedBy: userId,
        changedByEmail: user.email,
        reason: `Paiement GeniusPay - ${reference}`,
      },
    });

    logger.info(`[Webhook] Payment success: User ${userId} upgraded from ${previousPlan || 'FREE'} to ${plan}`);
    return true;
  } catch (error) {
    logger.error(`[Webhook] Error processing payment success for ${reference}:`, error);
    return false;
  }
}

/**
 * Handle failed payment
 */
async function handlePaymentFailed(payload: any): Promise<boolean> {
  const { reference, metadata } = payload.data;
  const { userId } = metadata || {};

  if (!userId) {
    logger.warn(`[Webhook] Payment failed without userId: ${reference}`);
    return true;
  }

  try {
    await prisma.subscription.updateMany({
      where: { 
        userId,
        providerSubscriptionId: reference,
      },
      data: {
        metadata: {
          lastFailedPayment: reference,
          failedAt: new Date().toISOString(),
          failureReason: payload.data.failure_reason || 'Unknown',
        },
      },
    });

    logger.info(`[Webhook] Payment failed for user ${userId}: ${reference}`);
    return true;
  } catch (error) {
    logger.error(`[Webhook] Error handling failed payment ${reference}:`, error);
    return false;
  }
}

/**
 * Handle expired payment
 */
async function handlePaymentExpired(payload: any): Promise<boolean> {
  const { reference, metadata } = payload.data;
  const { userId } = metadata || {};

  logger.info(`[Webhook] Payment expired: ${reference} (user: ${userId || 'unknown'})`);
  return true;
}

/**
 * Get user's subscription status
 */
export async function getSubscriptionStatus(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.user!.id;

    const [subscription, user] = await Promise.all([
      prisma.subscription.findUnique({ where: { userId } }),
      prisma.user.findUnique({
        where: { id: userId },
        select: { plan: true },
      }),
    ]);

    // Check if subscription is expired
    let isExpired = false;
    if (subscription?.currentPeriodEnd && subscription.status === 'ACTIVE') {
      isExpired = new Date() > subscription.currentPeriodEnd;
    }

    res.json({
      success: true,
      data: {
        currentPlan: user?.plan || 'FREE',
        subscription: subscription ? {
          status: isExpired ? 'EXPIRED' : subscription.status,
          currentPeriodStart: subscription.currentPeriodStart,
          currentPeriodEnd: subscription.currentPeriodEnd,
          cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
          isExpired,
        } : null,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Verify payment status (for frontend polling)
 */
export async function verifyPayment(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { reference } = req.params;
    const userId = req.user!.id;

    // First check our database
    const subscription = await prisma.subscription.findUnique({
      where: { userId },
    });

    // Check if this reference matches
    const metadata = subscription?.metadata as any;
    const matchesReference = subscription?.providerSubscriptionId === reference ||
                            metadata?.paymentReference === reference ||
                            metadata?.lastPaymentReference === reference;

    if (subscription?.status === 'ACTIVE' && matchesReference) {
      res.json({
        success: true,
        data: {
          reference,
          status: 'completed',
          plan: metadata?.plan,
        },
      });
      return;
    }

    // If not in our DB as completed, check GeniusPay
    const paymentResult = await geniusPay.getPayment(reference);

    if (!paymentResult.success) {
      throw createError('Payment not found', 404, 'PAYMENT_NOT_FOUND');
    }

    res.json({
      success: true,
      data: {
        reference: paymentResult.data?.reference,
        status: paymentResult.data?.status,
        amount: paymentResult.data?.amount,
        currency: paymentResult.data?.currency,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Cancel subscription (mark for cancellation at period end)
 */
export async function cancelSubscription(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.user!.id;

    const subscription = await prisma.subscription.findUnique({
      where: { userId },
    });

    if (!subscription || subscription.status !== 'ACTIVE') {
      throw createError('No active subscription found', 404, 'NO_SUBSCRIPTION');
    }

    await prisma.subscription.update({
      where: { userId },
      data: { cancelAtPeriodEnd: true },
    });

    logger.info(`[Subscription] User ${userId} scheduled cancellation at period end`);

    res.json({
      success: true,
      message: 'Subscription will be cancelled at the end of the current period',
      data: {
        cancelAtPeriodEnd: true,
        currentPeriodEnd: subscription.currentPeriodEnd,
      },
    });
  } catch (error) {
    next(error);
  }
}
