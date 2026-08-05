// netlify/functions/create-checkout.js
//
// Called from the frontend when a LOGGED-IN user clicks "Unlock" on a
// product. Creates a one-time-payment Stripe Checkout session tied to
// that specific user, so the webhook (stripe-webhook.js) knows exactly
// who paid for what once payment succeeds.
//
// Requires environment variables (set in Netlify Site settings ->
// Environment variables):
//   STRIPE_SECRET_KEY
//   SITE_URL   (e.g. https://redleafstudy.com)

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { verifyUser } = require('./utils/verifyUser');

// Map each product to its real Stripe Price ID. Create these in the
// Stripe Dashboard -> Product catalog -> Add product -> one-time price.
// Course products are looked up dynamically instead (see below).
const PRICE_IDS = {
  citizenship_prep: process.env.STRIPE_PRICE_CITIZENSHIP_PREP, // $12.99
  language_premium: process.env.STRIPE_PRICE_LANGUAGE_PREMIUM,  // $20.00
  photo_tool: process.env.STRIPE_PRICE_PHOTO_TOOL,              // $4.99 (suggested — adjust in Stripe as you like)
};

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const { user, reason } = await verifyUser(event);
  if (!user) {
    return {
      statusCode: 401,
      body: JSON.stringify({ error: 'You must be logged in to purchase.', debug: { reason } }),
    };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body.' }) };
  }

  const { product } = body;

  // BUG FIX (2026-08-04): this used to also accept a `course` product type
  // where the Stripe Price ID (`coursePriceId`) and product label
  // (`courseSlug`) were taken directly from the client request body and
  // trusted as-is. That's a real price-tampering hole: this function is a
  // public HTTP endpoint, so anyone (not just the frontend) could POST to
  // it directly with an arbitrary priceId — e.g. substituting a cheaper
  // price from this same Stripe account — and get a valid checkout session
  // at that price while labelling it as any course they choose. The
  // current frontend never actually calls this path (courses are sold
  // through their own fixed Stripe Payment Links — see courseCatalog in
  // index.html — which don't have this problem, since Stripe fixes the
  // price server-side for a Payment Link). That branch has been removed
  // rather than patched, since there was nothing depending on it. If you
  // want dynamic Checkout Sessions for courses instead of Payment Links
  // later, look up the price ID server-side from a trusted map (like
  // PRICE_IDS below), never from the request body.
  const priceId = PRICE_IDS[product];
  const metadataProduct = product;

  if (!priceId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Unknown or missing product.' }) };
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment', // one-time payment, not a recurring subscription
      line_items: [{ price: priceId, quantity: 1 }],
      client_reference_id: user.sub, // the Netlify Identity user ID
      customer_email: user.email,
      metadata: { product: metadataProduct, userId: user.sub },
      success_url: `${process.env.SITE_URL}/?purchased=${metadataProduct}`,
      cancel_url: `${process.env.SITE_URL}/?purchase_cancelled=1`,
    });

    return { statusCode: 200, body: JSON.stringify({ url: session.url }) };
  } catch (err) {
    console.error('Stripe checkout session creation failed:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Could not start checkout. Please try again.' }) };
  }
};
