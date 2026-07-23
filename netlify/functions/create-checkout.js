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

// Map each product to its real Stripe Price ID. Create these in the
// Stripe Dashboard -> Product catalog -> Add product -> one-time price.
// Course products are looked up dynamically instead (see below).
const PRICE_IDS = {
  citizenship_prep: process.env.STRIPE_PRICE_CITIZENSHIP_PREP, // $12.99
  language_premium: process.env.STRIPE_PRICE_LANGUAGE_PREMIUM,  // $20.00
};

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // Netlify Identity automatically attaches the verified logged-in user
  // here when the frontend sends the user's JWT in the Authorization header.
  const { user } = event.clientContext || {};
  if (!user) {
    // TEMPORARY DIAGNOSTICS — this tells us exactly what the function
    // actually received, instead of guessing again. Safe to leave in
    // short-term: it does not reveal the full token, only whether one
    // arrived and roughly what it looked like.
    const authHeader = event.headers && (event.headers.authorization || event.headers.Authorization);
    return {
      statusCode: 401,
      body: JSON.stringify({
        error: 'You must be logged in to purchase.',
        debug: {
          hadClientContext: !!event.clientContext,
          hadAuthorizationHeader: !!authHeader,
          authHeaderPreview: authHeader ? authHeader.slice(0, 20) + '...' : null,
          clientContextKeys: event.clientContext ? Object.keys(event.clientContext) : [],
        },
      }),
    };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body.' }) };
  }

  const { product, coursePriceId, courseSlug } = body;

  let priceId;
  let metadataProduct;

  if (product === 'citizenship_prep' || product === 'language_premium') {
    priceId = PRICE_IDS[product];
    metadataProduct = product;
  } else if (product === 'course' && coursePriceId && courseSlug) {
    // Course purchases pass their own Stripe Price ID directly, since
    // each course has its own price set independently (see courses table).
    priceId = coursePriceId;
    metadataProduct = `course_${courseSlug}`;
  }

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
