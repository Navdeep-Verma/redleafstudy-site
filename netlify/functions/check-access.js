// netlify/functions/check-access.js
//
// The frontend calls this to ask "does the currently logged-in user
// have access to this product?" It's the server-side gatekeeper that
// makes real access control possible — the frontend trusts whatever
// this function says, and this function is the only thing that reads
// the entitlements table.
//
// Requires environment variables:
//   SUPABASE_URL
//   SUPABASE_SERVICE_KEY

const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

exports.handler = async (event) => {
  const { user } = event.clientContext || {};
  if (!user) {
    return { statusCode: 200, body: JSON.stringify({ hasAccess: false, reason: 'not_logged_in' }) };
  }

  const product = event.queryStringParameters && event.queryStringParameters.product;
  if (!product) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing product parameter.' }) };
  }

  const { data, error } = await supabase
    .from('entitlements')
    .select('id, purchased_at')
    .eq('user_id', user.sub)
    .eq('product', product)
    .maybeSingle();

  if (error) {
    console.error('check-access query failed:', error);
    return { statusCode: 500, body: JSON.stringify({ error: 'Could not verify access right now.' }) };
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ hasAccess: !!data, purchasedAt: data ? data.purchased_at : null }),
  };
};
