import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { prisma } from './db.js';
import { seedOrders, seedUsers } from './seed.js';
import { requireAuth, requireRole, getJwtSecret } from './auth.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// ==========================================
// Authentication Endpoints (Fixed Implementation)
// ==========================================

// Login endpoint
app.post('/api/auth/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
      res.status(400).json({ error: 'Email and password are required.' });
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail }
    });

    if (!user) {
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }

    const expiresIn = process.env.JWT_EXPIRES_IN || '8h';
    const token = jwt.sign(
      {
        sub: user.id,
        email: user.email,
        role: user.role,
        name: user.name
      },
      getJwtSecret(),
      { expiresIn: expiresIn as jwt.SignOptions['expiresIn'] }
    );

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role
      }
    });
  } catch (error: unknown) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error during authentication.' });
  }
});

// Profile / Current User endpoint
app.get('/api/auth/me', requireAuth, async (req: Request, res: Response) => {
  res.json({ user: req.user });
});

// Server & Database Health check
app.get('/api/health', async (_req: Request, res: Response) => {
  let dbStatus = 'disconnected';
  let ordersCount = 0;

  try {
    const count = await prisma.order.count();
    ordersCount = count;
    dbStatus = 'connected';
  } catch (err: unknown) {
    dbStatus = `unreachable (${(err as Error).message})`;
  }

  res.json({
    status: 'ok',
    message: 'Backend API is running',
    database: {
      type: 'PostgreSQL',
      status: dbStatus,
      ordersCount
    },
    timestamp: new Date().toISOString()
  });
});

// Stored Procedure query endpoint for Orders (Protected: Requires Auth)
app.get('/api/orders', requireAuth, async (req: Request, res: Response) => {
  try {
    const search = typeof req.query.search === 'string' ? req.query.search : null;
    const status = typeof req.query.status === 'string' && req.query.status !== 'ALL' ? req.query.status : null;
    const sortBy = typeof req.query.sortBy === 'string' ? req.query.sortBy : 'createdAt';
    const sortDir = typeof req.query.sortDir === 'string' ? req.query.sortDir.toUpperCase() : 'DESC';
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10));
    const pageSize = Math.min(200, Math.max(1, parseInt(String(req.query.pageSize || '50'), 10)));

    const rows = await prisma.$queryRaw<
      Array<{
        id: number;
        customerName: string;
        customerEmail: string;
        amount: string | number;
        status: string;
        items: unknown;
        createdAt: Date;
        updatedAt: Date;
        total_count: bigint | number;
      }>
    >`
      SELECT * FROM get_orders_paginated(
        ${search}::TEXT,
        ${status}::TEXT,
        ${sortBy}::TEXT,
        ${sortDir}::TEXT,
        ${page}::INT,
        ${pageSize}::INT
      )
    `;

    const totalCount = rows.length > 0 ? Number(rows[0].total_count) : 0;
    const items = rows.map((r) => ({
      id: r.id,
      customerName: r.customerName,
      customerEmail: r.customerEmail,
      amount: Number(r.amount),
      status: r.status,
      items: r.items,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt
    }));

    res.json({
      items,
      pagination: {
        page,
        pageSize,
        totalCount,
        totalPages: Math.ceil(totalCount / pageSize)
      }
    });
  } catch (error: unknown) {
    console.error('Error executing get_orders_paginated:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// Helper for server-side validation
interface CreateOrderItemInput {
  productName: string;
  quantity: number;
  unitPrice: number;
}

interface CreateOrderBody {
  customerName: string;
  customerEmail: string;
  items: CreateOrderItemInput[];
}

function validateOrderInput(body: unknown): { error?: string; data?: CreateOrderBody & { calculatedAmount: number } } {
  if (!body || typeof body !== 'object') {
    return { error: 'Request body must be a valid JSON object.' };
  }

  const { customerName, customerEmail, items } = body as Partial<CreateOrderBody>;

  if (!customerName || typeof customerName !== 'string' || customerName.trim().length < 2) {
    return { error: 'Customer name is required and must be at least 2 characters.' };
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!customerEmail || typeof customerEmail !== 'string' || !emailRegex.test(customerEmail.trim())) {
    return { error: 'A valid customer email address is required.' };
  }

  if (!Array.isArray(items) || items.length === 0) {
    return { error: 'Order must contain at least 1 line item.' };
  }

  if (items.length > 50) {
    return { error: 'Order cannot contain more than 50 line items.' };
  }

  let calculatedAmount = 0;
  for (let idx = 0; idx < items.length; idx++) {
    const item = items[idx];
    if (!item.productName || typeof item.productName !== 'string' || item.productName.trim() === '') {
      return { error: `Item #${idx + 1}: Product name is required.` };
    }
    const qty = Number(item.quantity);
    if (!Number.isInteger(qty) || qty < 1) {
      return { error: `Item #${idx + 1}: Quantity must be a positive integer.` };
    }
    const price = Number(item.unitPrice);
    if (isNaN(price) || price < 0.01) {
      return { error: `Item #${idx + 1}: Unit price must be at least $0.01.` };
    }
    calculatedAmount += qty * price;
  }

  calculatedAmount = Math.round(calculatedAmount * 100) / 100;

  return {
    data: {
      customerName: customerName.trim(),
      customerEmail: customerEmail.trim().toLowerCase(),
      items: items.map((it) => ({
        productName: it.productName.trim(),
        quantity: Number(it.quantity),
        unitPrice: Math.round(Number(it.unitPrice) * 100) / 100,
        lineTotal: Math.round(Number(it.quantity) * Number(it.unitPrice) * 100) / 100
      })),
      calculatedAmount
    }
  };
}

// Mock payment provider with internal deduplication tracking
interface PaymentResult {
  transactionId: string;
  amount: number;
  status: 'succeeded';
}

const processedPaymentTransactions = new Map<string, PaymentResult>();

async function chargePaymentProvider(params: {
  amount: number;
  idempotencyKey: string;
  customerEmail: string;
}): Promise<PaymentResult> {
  // 3. The same idempotency key when calling/retrying the payment provider
  const { idempotencyKey, amount } = params;
  if (processedPaymentTransactions.has(idempotencyKey)) {
    // Return identical payment transaction if already charged with this key
    return processedPaymentTransactions.get(idempotencyKey)!;
  }

  // Simulate payment gateway processing
  const transaction: PaymentResult = {
    transactionId: `txn_${crypto.randomBytes(8).toString('hex')}`,
    amount,
    status: 'succeeded'
  };

  processedPaymentTransactions.set(idempotencyKey, transaction);
  return transaction;
}

// R2: Idempotent Order Creation Endpoint (Protected: Requires Auth)
app.post('/api/orders', requireAuth, async (req: Request, res: Response) => {
  const idempotencyKey = (req.header('Idempotency-Key') || req.body?.idempotencyKey || '').trim();

  if (!idempotencyKey) {
    res.status(400).json({ error: 'Idempotency-Key header is required to create an order.' });
    return;
  }

  // Server-side validation
  const validation = validateOrderInput(req.body);
  if (validation.error || !validation.data) {
    res.status(422).json({ error: validation.error });
    return;
  }

  const { customerName, customerEmail, items, calculatedAmount } = validation.data;
  // Compute deterministic hash of the request payload
  const requestHash = crypto
    .createHash('sha256')
    .update(JSON.stringify({ customerName, customerEmail, items, calculatedAmount }))
    .digest('hex');

  try {
    // Execute inside a database transaction to lock the idempotency key atomically
    const result = await prisma.$transaction(async (tx) => {
      // 1. Check if the idempotency key already exists
      const existing = await tx.idempotencyRecord.findUnique({
        where: { key: idempotencyKey }
      });

      if (existing) {
        // If request payload changed with the same key, reject mismatch
        if (existing.requestHash !== requestHash) {
          return {
            status: 409,
            body: {
              error: 'Idempotency key was previously used with a different request payload.'
            }
          };
        }

        // If the initial request is still being processed in parallel
        if (!existing.responseBody) {
          return {
            status: 409,
            body: {
              error: 'A request with this Idempotency-Key is currently in progress.'
            }
          };
        }

        // Return identical previously recorded response (replay)
        return {
          status: existing.responseStatus || 200,
          body: existing.responseBody,
          isReplay: true
        };
      }

      // 2. Claim the key immediately by creating an "in-flight" record (responseBody remains null while in flight)
      await tx.idempotencyRecord.create({
        data: {
          key: idempotencyKey,
          requestHash
        }
      });

      // 3. Forward the SAME idempotency key to the payment provider
      const payment = await chargePaymentProvider({
        amount: calculatedAmount,
        idempotencyKey, // passes the exact same key to ensure payment gateway deduplication
        customerEmail
      });

      // 4. Create the order
      const newOrder = await tx.order.create({
        data: {
          idempotencyKey,
          customerName,
          customerEmail,
          amount: calculatedAmount,
          status: 'PENDING',
          items: items as unknown as object
        }
      });

      const responseBody = {
        message: 'Order created successfully',
        paymentTransactionId: payment.transactionId,
        order: {
          id: newOrder.id,
          customerName: newOrder.customerName,
          customerEmail: newOrder.customerEmail,
          amount: Number(newOrder.amount),
          status: newOrder.status,
          items: newOrder.items,
          createdAt: newOrder.createdAt
        }
      };

      // 4 (cont). Persistent storage of the outcome so all retries can return original result
      await tx.idempotencyRecord.update({
        where: { key: idempotencyKey },
        data: {
          responseStatus: 201,
          responseBody
        }
      });

      return {
        status: 201,
        body: responseBody,
        isReplay: false
      };
    });

    if (result.isReplay) {
      res.setHeader('X-Idempotent-Replay', 'true');
    }
    res.status(result.status).json(result.body);
  } catch (error: unknown) {
    // If a race condition caused a unique constraint violation on PostgreSQL
    const prismaError = error as { code?: string; message?: string };
    if (prismaError.code === 'P2002') {
      // Race condition hit: retrieve the already committed order
      const existingRecord = await prisma.idempotencyRecord.findUnique({
        where: { key: idempotencyKey }
      });
      if (existingRecord?.responseBody) {
        res.setHeader('X-Idempotent-Replay', 'true');
        res.status(existingRecord.responseStatus || 200).json(existingRecord.responseBody);
        return;
      }
      res.status(409).json({ error: 'Concurrent duplicate request detected.' });
      return;
    }

    console.error('Order creation error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// Protected Route: Cancel Order (Agents & Admins can cancel)
app.patch('/api/orders/:id/cancel', requireAuth, async (req: Request, res: Response) => {
  try {
    const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const orderId = parseInt(rawId, 10);
    if (isNaN(orderId) || orderId <= 0) {
      res.status(400).json({ error: 'Valid positive integer order ID is required.' });
      return;
    }

    const existingOrder = await prisma.order.findUnique({
      where: { id: orderId }
    });

    if (!existingOrder) {
      res.status(404).json({ error: `Order #${orderId} not found.` });
      return;
    }

    if (existingOrder.status === 'CANCELLED') {
      res.status(400).json({ error: `Order #${orderId} is already cancelled.` });
      return;
    }

    const updated = await prisma.order.update({
      where: { id: orderId },
      data: { status: 'CANCELLED' }
    });

    res.json({ ok: true, message: `Order #${orderId} cancelled successfully.`, order: updated });
  } catch (error: unknown) {
    console.error('Cancel order error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// Protected Route: Delete Order (Strictly ADMIN only - RBAC enforced on server)
app.delete('/api/orders/:id', requireAuth, requireRole('ADMIN'), async (req: Request, res: Response) => {
  try {
    const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const orderId = parseInt(rawId, 10);
    if (isNaN(orderId) || orderId <= 0) {
      res.status(400).json({ error: 'Valid positive integer order ID is required.' });
      return;
    }

    const existingOrder = await prisma.order.findUnique({
      where: { id: orderId }
    });

    if (!existingOrder) {
      res.status(404).json({ error: `Order #${orderId} not found.` });
      return;
    }

    await prisma.order.delete({
      where: { id: orderId }
    });

    res.json({ ok: true, message: `Order #${orderId} deleted successfully.` });
  } catch (error: unknown) {
    console.error('Delete order error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// Trigger seeding 50,000 orders
app.post('/api/orders/seed', async (req: Request, res: Response) => {
  try {
    const count = parseInt(String(req.body.count || '50000'), 10);
    seedOrders(count).catch((err) => console.error('Background seed failed:', err));
    res.json({ message: `Seeding of ${count} orders initiated.` });
  } catch (error: unknown) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.listen(PORT, async () => {
  console.log(`Server is running at http://localhost:${PORT}`);
  try {
    await seedUsers();
  } catch (err) {
    console.error('Failed to auto-seed users:', err);
  }
});
