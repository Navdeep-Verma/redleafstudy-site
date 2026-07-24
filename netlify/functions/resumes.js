// netlify/functions/resumes.js
//
// Handles all Resume Builder save/load operations, tied to whichever
// account is logged in. Uses the same verifyUser helper as the payment
// functions, so a user can only ever see or modify their own resumes.
//
// Actions (sent as JSON body for POST, or query params for GET/DELETE):
//   GET    ?action=list                 -> list this user's saved resumes (id, title, template, updated_at only — not full content, to keep the list fast)
//   GET    ?action=load&id=<resumeId>   -> load one full resume
//   POST   { action: 'save', id?, title, template, content }
//          -> creates a new resume if no id given, otherwise updates that one
//   DELETE ?id=<resumeId>               -> delete one resume
//
// Requires environment variables:
//   SUPABASE_URL
//   SUPABASE_SERVICE_KEY

const { createClient } = require('@supabase/supabase-js');
const { verifyUser } = require('./utils/verifyUser');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

exports.handler = async (event) => {
  const { user } = await verifyUser(event);
  if (!user) {
    return { statusCode: 401, body: JSON.stringify({ error: 'You must be logged in.' }) };
  }

  try {
    if (event.httpMethod === 'GET') {
      const action = event.queryStringParameters && event.queryStringParameters.action;

      if (action === 'list') {
        const { data, error } = await supabase
          .from('resumes')
          .select('id, title, template, updated_at')
          .eq('user_id', user.sub)
          .order('updated_at', { ascending: false });
        if (error) throw error;
        return { statusCode: 200, body: JSON.stringify({ resumes: data }) };
      }

      if (action === 'load') {
        const id = event.queryStringParameters.id;
        const { data, error } = await supabase
          .from('resumes')
          .select('*')
          .eq('user_id', user.sub)
          .eq('id', id)
          .maybeSingle();
        if (error) throw error;
        if (!data) return { statusCode: 404, body: JSON.stringify({ error: 'Resume not found.' }) };
        return { statusCode: 200, body: JSON.stringify({ resume: data }) };
      }

      return { statusCode: 400, body: JSON.stringify({ error: 'Unknown action.' }) };
    }

    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body);
      const { id, title, template, content } = body;

      if (id) {
        // Update — but only if it actually belongs to this user, enforced
        // by the .eq('user_id', ...) filter, not just trusting the id.
        const { data, error } = await supabase
          .from('resumes')
          .update({ title, template, content, updated_at: new Date().toISOString() })
          .eq('id', id)
          .eq('user_id', user.sub)
          .select()
          .maybeSingle();
        if (error) throw error;
        if (!data) return { statusCode: 404, body: JSON.stringify({ error: 'Resume not found.' }) };
        return { statusCode: 200, body: JSON.stringify({ resume: data }) };
      } else {
        const { data, error } = await supabase
          .from('resumes')
          .insert({ user_id: user.sub, title: title || 'Untitled Resume', template: template || 'modern', content })
          .select()
          .single();
        if (error) throw error;
        return { statusCode: 200, body: JSON.stringify({ resume: data }) };
      }
    }

    if (event.httpMethod === 'DELETE') {
      const id = event.queryStringParameters && event.queryStringParameters.id;
      const { error } = await supabase
        .from('resumes')
        .delete()
        .eq('id', id)
        .eq('user_id', user.sub);
      if (error) throw error;
      return { statusCode: 200, body: JSON.stringify({ deleted: true }) };
    }

    return { statusCode: 405, body: 'Method Not Allowed' };
  } catch (err) {
    console.error('resumes function error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Something went wrong. Please try again.' }) };
  }
};
