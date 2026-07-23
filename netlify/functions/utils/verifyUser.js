// netlify/functions/utils/verifyUser.js
//
// Netlify's automatic "decode the login token into event.clientContext.user"
// feature isn't populating reliably on this deployment (confirmed via
// diagnostics — a valid-looking token arrives, but clientContext stays
// empty). Rather than keep depending on that automatic behaviour, this
// verifies the user directly: it takes whatever token the frontend sent
// and asks Netlify Identity's own "who is this" endpoint to confirm it's
// real. If Identity says yes, we trust it; if not, we don't.
//
// This is a more robust pattern in general — it doesn't depend on any
// Netlify-specific "magic" working correctly, only on a plain HTTP call
// that's easy to reason about and debug.

async function verifyUser(event) {
  const authHeader = event.headers && (event.headers.authorization || event.headers.Authorization);
  if (!authHeader) return { user: null, reason: 'no_authorization_header' };

  const siteUrl = process.env.URL || process.env.SITE_URL;
  if (!siteUrl) return { user: null, reason: 'missing_site_url_env_var' };

  try {
    const res = await fetch(`${siteUrl}/.netlify/identity/user`, {
      headers: { Authorization: authHeader },
    });

    if (!res.ok) {
      return { user: null, reason: `identity_endpoint_returned_${res.status}` };
    }

    const user = await res.json();
    // Normalize to the same shape the old clientContext.user had, so the
    // rest of each function's code doesn't need to change: `sub` (user id).
    return { user: { sub: user.id, email: user.email, raw: user }, reason: null };
  } catch (err) {
    console.error('verifyUser failed:', err);
    return { user: null, reason: 'verification_request_failed' };
  }
}

module.exports = { verifyUser };
