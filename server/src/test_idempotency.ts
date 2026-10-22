import { uuidv7 } from 'uuidv7';

const API_BASE = 'http://localhost:5000/api';

async function testParallelIdempotency() {
  console.log('--- R2 Idempotency Test: Firing Parallel Duplicate Requests ---');

  // Authenticate first
  const loginRes = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@sarh.com', password: 'AdminPass123!' })
  });
  const loginData = await loginRes.json();
  const token = loginData.token;

  // Generate unique run identifier and shared UUIDv7 idempotency key
  const runId = Date.now();
  const sharedKey = `test-order-${uuidv7()}`;
  const testEmail = `parallel.test.${runId}@example.com`;

  const payload = {
    customerName: 'Parallel Test Customer',
    customerEmail: testEmail,
    items: [
      { productName: 'Wireless Mechanical Keyboard', quantity: 1, unitPrice: 120.00 },
      { productName: 'Ergonomic Desk Mat', quantity: 2, unitPrice: 25.50 }
    ]
  };

  console.log(`Using shared Idempotency-Key: ${sharedKey}`);
  console.log(`Target customer email: ${testEmail}`);
  console.log(`Firing 2 identical requests simultaneously via Promise.all()...\n`);

  const req1 = fetch(`${API_BASE}/orders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': sharedKey,
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  });

  const req2 = fetch(`${API_BASE}/orders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': sharedKey,
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  });

  const [res1, res2] = await Promise.all([req1, req2]);

  const body1 = await res1.json();
  const body2 = await res2.json();

  console.log('Request 1 Result:');
  console.log(`  HTTP Status: ${res1.status}`);
  console.log(`  X-Idempotent-Replay Header: ${res1.headers.get('x-idempotent-replay') || 'false'}`);
  console.log(`  Order ID returned: ${body1.order?.id || 'none'}\n`);

  console.log('Request 2 Result:');
  console.log(`  HTTP Status: ${res2.status}`);
  console.log(`  X-Idempotent-Replay Header: ${res2.headers.get('x-idempotent-replay') || 'false'}`);
  console.log(`  Order ID returned: ${body2.order?.id || 'none'}\n`);

  // Query database endpoint for the test email
  const ordersCheck = await fetch(`${API_BASE}/orders?search=${encodeURIComponent(testEmail)}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const ordersData = await ordersCheck.json();

  const matchingOrders = ordersData.items.filter(
    (o: { customerEmail: string }) => o.customerEmail.toLowerCase() === testEmail.toLowerCase()
  );

  console.log('--- Database Verification ---');
  console.log(`Total orders found for email ${testEmail}: ${matchingOrders.length}`);

  if (matchingOrders.length === 1 && body1.order?.id === body2.order?.id) {
    console.log(`✅ SUCCESS: Both concurrent requests resolved to Order #${body1.order.id}.`);
    console.log('✅ Exactly 1 order exists in the database. Zero duplicates created!');
    return true;
  } else {
    console.error(`❌ FAILURE: Expected exactly 1 order, found ${matchingOrders.length}.`);
    return false;
  }
}

testParallelIdempotency()
  .then((success) => {
    if (!success) {
      process.exit(1);
    }
  })
  .catch((err) => {
    console.error('Test execution error:', err);
    process.exit(1);
  });

