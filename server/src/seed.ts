import { prisma } from './db.js';
import bcrypt from 'bcryptjs';

const STATUSES = ['PENDING', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED'] as const;
const FIRST_NAMES = ['James', 'Mary', 'John', 'Patricia', 'Robert', 'Jennifer', 'Michael', 'Linda', 'William', 'Elizabeth', 'David', 'Barbara', 'Richard', 'Susan', 'Joseph', 'Jessica'];
const LAST_NAMES = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson'];
const DOMAINS = ['gmail.com', 'yahoo.com', 'outlook.com', 'example.com', 'company.org'];

export async function seedUsers() {
  console.log('Seeding initial Admin and Agent users...');

  const adminPasswordHash = await bcrypt.hash('AdminPass123!', 10);
  const agentPasswordHash = await bcrypt.hash('AgentPass123!', 10);

  const admin = await prisma.user.upsert({
    where: { email: 'admin@sarh.com' },
    update: {
      password: adminPasswordHash,
      role: 'ADMIN',
      name: 'System Administrator'
    },
    create: {
      email: 'admin@sarh.com',
      password: adminPasswordHash,
      name: 'System Administrator',
      role: 'ADMIN'
    }
  });

  const agent = await prisma.user.upsert({
    where: { email: 'agent@sarh.com' },
    update: {
      password: agentPasswordHash,
      role: 'AGENT',
      name: 'Support Agent'
    },
    create: {
      email: 'agent@sarh.com',
      password: agentPasswordHash,
      name: 'Support Agent',
      role: 'AGENT'
    }
  });

  console.log(`Users seeded: Admin [${admin.email}], Agent [${agent.email}]`);
}

export async function seedOrders(count = 50000) {
  console.log(`Starting to seed ${count} orders...`);

  // Check existing count
  const existingCount = await prisma.order.count();
  if (existingCount >= count) {
    console.log(`Table already contains ${existingCount} orders. Skipping seed.`);
    return existingCount;
  }

  const batchSize = 5000;
  const remaining = count - existingCount;
  let inserted = 0;

  for (let i = 0; i < remaining; i += batchSize) {
    const currentBatchSize = Math.min(batchSize, remaining - i);
    const records = [];

    for (let j = 0; j < currentBatchSize; j++) {
      const idx = existingCount + inserted + j + 1;
      const firstName = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)];
      const lastName = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)];
      const customerName = `${firstName} ${lastName}`;
      const customerEmail = `${firstName.toLowerCase()}.${lastName.toLowerCase()}${idx}@${DOMAINS[Math.floor(Math.random() * DOMAINS.length)]}`;
      const amount = (Math.random() * 950 + 10).toFixed(2);
      const status = STATUSES[Math.floor(Math.random() * STATUSES.length)];

      // Spread timestamps over the last 180 days
      const daysAgo = Math.floor(Math.random() * 180);
      const createdAt = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);

      records.push({
        customerName,
        customerEmail,
        amount,
        status,
        createdAt,
        updatedAt: createdAt
      });
    }

    await prisma.order.createMany({
      data: records
    });

    inserted += currentBatchSize;
    console.log(`Seeded ${inserted}/${remaining} new orders...`);
  }

  const finalCount = await prisma.order.count();
  console.log(`Seeding complete. Total orders in database: ${finalCount}`);
  return finalCount;
}

if (process.argv[1]?.includes('seed')) {
  seedUsers()
    .then(() => seedOrders(50000))
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Seed error:', err);
      process.exit(1);
    });
}

