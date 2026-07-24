// netlify/functions/stripe-webhook.js
//
// Stripe calls this automatically the moment a payment succeeds. This
// is the ONLY place in the whole system that ever grants access — never
// the browser, never the frontend. That's what makes this secure.
//
// Setup: In the Stripe Dashboard -> Developers -> Webhooks, add an
// endpoint pointing to:
//   https://<yoursite>/.netlify/functions/stripe-webhook
// Subscribe it to the "checkout.session.completed" event, then copy the
// signing secret into STRIPE_WEBHOOK_SECRET below.
//
// Requires environment variables:
//   STRIPE_SECRET_KEY
//   STRIPE_WEBHOOK_SECRET
//   SUPABASE_URL
//   SUPABASE_SERVICE_KEY   (the service_role key, NOT the public anon key —
//                           this function must bypass row-level security
//                           to write entitlements, but it should never be
//                           exposed to the browser)

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// Maps a Stripe Price ID back to a product name. This is what makes a
// PLAIN Stripe Payment Link work correctly (like the Photo Tool's fixed
// link) — a Payment Link created in the Dashboard doesn't carry custom
// metadata the way a dynamically-created Checkout Session does, so for
// those purchases we identify the product by which price was actually
// bought instead. Set STRIPE_PRICE_PHOTO_TOOL to the Price ID behind
// that specific Payment Link (Stripe Dashboard -> Product catalog ->
// the Photo Tool product -> its price -> copy the Price ID) for this
// lookup to work.
const PRICE_ID_TO_PRODUCT = {
  [process.env.STRIPE_PRICE_CITIZENSHIP_PREP]: 'citizenship_prep',
  [process.env.STRIPE_PRICE_LANGUAGE_PREMIUM]: 'language_premium',
  [process.env.STRIPE_PRICE_PHOTO_TOOL]: 'photo_tool',
  [process.env.STRIPE_PRICE_RESUME_BUILDER]: 'resume_builder',
};

exports.handler = async (event) => {
  const signature = event.headers['stripe-signature'];

  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(
      event.body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  if (stripeEvent.type === 'checkout.session.completed') {
    const session = stripeEvent.data.object;
    const userId = session.client_reference_id;
    let product = session.metadata && session.metadata.product;

    // Fallback for plain Payment Links (no custom metadata available):
    // identify the product by which Stripe Price was actually purchased.
    if (!product) {
      try {
        const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 1 });
        const priceId = lineItems.data[0] && lineItems.data[0].price && lineItems.data[0].price.id;
        product = PRICE_ID_TO_PRODUCT[priceId];
        if (!product) {
          console.error('Could not map price ID to a known product:', priceId, 'for session', session.id);
        }
      } catch (err) {
        console.error('Failed to look up line items for session', session.id, err);
      }
    }

    if (!userId || !product) {
      console.error('Missing userId or could not determine product for session.', session.id, { userId, product });
      return { statusCode: 200, body: 'ok (missing userId or unrecognized product, ignored)' };
    }

    // The Photo Tool and Resume Builder currently share one $3.99 payment
    // link, so a purchase of that price unlocks both — write one
    // entitlement row per product rather than just the one detected.
    const productsToGrant = product === 'photo_tool' ? ['photo_tool', 'resume_builder'] : [product];

    const { error } = await supabase
      .from('entitlements')
      .upsert(
        productsToGrant.map(p => ({
          user_id: userId,
          product: p,
          stripe_session_id: session.id,
        })),
        { onConflict: 'user_id,product' }
      );

    if (error) {
      console.error('Failed to write entitlement:', error);
      // Return 500 so Stripe retries the webhook automatically.
      return { statusCode: 500, body: 'Database write failed' };
    }

    console.log(`Entitlement granted: user ${userId} -> ${product}`);
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
