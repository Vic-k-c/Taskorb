const crypto = require('crypto');

const BASE_URL = 'https://api.paystack.co';

function getSecretKey() {
  // PAYSTACK_MODE=test uses the test secret key even if a live key is also
  // set, so you can leave live keys in the environment and still test
  // safely by just flipping this one var.
  return process.env.PAYSTACK_MODE === 'live'
    ? process.env.PAYSTACK_LIVE_SECRET_KEY
    : process.env.PAYSTACK_TEST_SECRET_KEY;
}

function getPublicKey() {
  return process.env.PAYSTACK_MODE === 'live'
    ? process.env.PAYSTACK_LIVE_PUBLIC_KEY
    : process.env.PAYSTACK_TEST_PUBLIC_KEY;
}

async function paystackRequest(method, path, body) {
  const secretKey = getSecretKey();
  if (!secretKey) throw new Error('Paystack secret key is not configured for the current PAYSTACK_MODE.');
  const resp = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || data.status === false) {
    const message = (data && data.message) || `Paystack request failed (${resp.status})`;
    const err = new Error(message);
    err.paystackResponse = data;
    throw err;
  }
  return data;
}

// Starts a subscription checkout. Paystack uses the `plan` code's own
// configured price once payment starts, but we still send `amount` (in
// the smallest currency unit -- cents for USD) as the amount shown before
// the plan is resolved, and so the transaction record has it either way.
async function initializeTransaction({ email, amountUsd, planCode, callbackUrl, metadata }) {
  const data = await paystackRequest('POST', '/transaction/initialize', {
    email,
    amount: Math.round(amountUsd * 100),
    currency: 'USD',
    plan: planCode,
    callback_url: callbackUrl,
    metadata
  });
  return data.data; // { authorization_url, access_code, reference }
}

async function verifyTransaction(reference) {
  const data = await paystackRequest('GET', `/transaction/verify/${encodeURIComponent(reference)}`);
  return data.data;
}

async function disableSubscription(subscriptionCode, emailToken) {
  const data = await paystackRequest('POST', '/subscription/disable', {
    code: subscriptionCode,
    token: emailToken
  });
  return data.data;
}

async function enableSubscription(subscriptionCode, emailToken) {
  const data = await paystackRequest('POST', '/subscription/enable', {
    code: subscriptionCode,
    token: emailToken
  });
  return data.data;
}

// Paystack signs every webhook body with your secret key so you can trust
// it actually came from them and wasn't forged by a third party hitting
// your endpoint directly. Must run against the RAW request body -- see
// the express.raw() middleware on the webhook route in routes/billing.js.
function verifyWebhookSignature(rawBody, signatureHeader) {
  if (!signatureHeader) return false;
  const secretKey = getSecretKey();
  if (!secretKey) return false;
  const expected = crypto.createHmac('sha512', secretKey).update(rawBody).digest('hex');
  // Constant-time comparison so a timing attack can't be used to guess the
  // signature byte-by-byte.
  const expectedBuf = Buffer.from(expected, 'utf8');
  const givenBuf = Buffer.from(String(signatureHeader), 'utf8');
  if (expectedBuf.length !== givenBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, givenBuf);
}

module.exports = {
  getPublicKey,
  initializeTransaction,
  verifyTransaction,
  disableSubscription,
  enableSubscription,
  verifyWebhookSignature
};
