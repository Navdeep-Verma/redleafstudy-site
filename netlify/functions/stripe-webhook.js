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
    const product = session.metadata && session.metadata.product;

    if (!userId || !product) {
      console.error('Missing userId or product in completed session metadata.', session.id);
      return { statusCode: 200, body: 'ok (missing metadata, ignored)' };
    }

    const { error } = await supabase
      .from('entitlements')
      .upsert(
        {
          user_id: userId,
          product: product,
          stripe_session_id: session.id,
        },
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
