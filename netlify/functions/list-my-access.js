// netlify/functions/list-my-access.js
//
// Returns ALL of the logged-in user's entitlements in a single call.
// More efficient than calling check-access separately for citizenship
// prep, language premium, and every course — the frontend can call this
// once on page load and cache the result for the session.

const { createClient } = require('@supabase/supabase-js');
const { verifyUser } = require('./utils/verifyUser');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

exports.handler = async (event) => {
  const { user } = await verifyUser(event);
  if (!user) {
    return { statusCode: 200, body: JSON.stringify({ products: [] }) };
  }

  const { data, error } = await supabase
    .from('entitlements')
    .select('product, purchased_at')
    .eq('user_id', user.sub);

  if (error) {
    console.error('list-my-access query failed:', error);
    return { statusCode: 500, body: JSON.stringify({ error: 'Could not load your access right now.' }) };
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ products: data.map(row => row.product) }),
  };
};
