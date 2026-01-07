/**
 * Initialize Rate Limit Configurations
 * Author: NICE-DEV
 * 
 * Run: npx tsx scripts/init-rate-limits.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const rateLimitConfigs = [
  {
    plan: 'FREE',
    requestsPerMinute: 10,
    requestsPerHour: 100,
    requestsPerDay: 100,
    burstLimit: 5,
  },
  {
    plan: 'BASIC',
    requestsPerMinute: 30,
    requestsPerHour: 500,
    requestsPerDay: 1000,
    burstLimit: 15,
  },
  {
    plan: 'PRO',
    requestsPerMinute: 100,
    requestsPerHour: 2000,
    requestsPerDay: 10000,
    burstLimit: 50,
  },
  {
    plan: 'ENTERPRISE',
    requestsPerMinute: 500,
    requestsPerHour: 10000,
    requestsPerDay: -1, // Illimité
    burstLimit: 200,
  },
];

async function main() {
  console.log('🚀 Initializing rate limit configurations...\n');

  for (const config of rateLimitConfigs) {
    const existing = await prisma.rateLimitConfig.findUnique({
      where: { plan: config.plan as any },
    });

    if (existing) {
      await prisma.rateLimitConfig.update({
        where: { plan: config.plan as any },
        data: config,
      });
      console.log(`✅ Updated ${config.plan} plan:`);
    } else {
      await prisma.rateLimitConfig.create({
        data: config as any,
      });
      console.log(`✅ Created ${config.plan} plan:`);
    }
    
    console.log(`   - ${config.requestsPerMinute} req/min`);
    console.log(`   - ${config.requestsPerHour} req/hour`);
    console.log(`   - ${config.requestsPerDay === -1 ? 'Unlimited' : config.requestsPerDay} req/day`);
    console.log(`   - Burst: ${config.burstLimit}\n`);
  }

  console.log('✨ Rate limit configurations initialized successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
