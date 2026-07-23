-- supabase-schema.sql
--
-- Run this in your Supabase project's SQL Editor (Dashboard -> SQL Editor
-- -> New query -> paste this -> Run). This creates the two tables the
-- serverless functions depend on.

-- Records which logged-in user has paid for which product.
-- user_id comes from Netlify Identity (the 'sub' field of the logged-in user).
CREATE TABLE entitlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  product TEXT NOT NULL,              -- 'citizenship_prep' | 'language_premium' | 'course_<slug>'
  stripe_session_id TEXT,
  purchased_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, product)
);

CREATE INDEX idx_entitlements_user_id ON entitlements(user_id);

-- Individual courses, added here as you create them. Each course has its
-- own price and its own Stripe Price ID, so buying one course never
-- unlocks any other.
CREATE TABLE courses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,          -- e.g. 'ielts-writing-masterclass', used in the 'course_<slug>' product string
  title TEXT NOT NULL,
  description TEXT,
  price_cents INT NOT NULL,
  stripe_price_id TEXT NOT NULL,
  is_published BOOLEAN DEFAULT false, -- flip to true when a course is ready to sell
  created_at TIMESTAMPTZ DEFAULT now()
);

-- IMPORTANT: Row Level Security.
-- These tables are only ever read/written by your serverless functions
-- using the service_role key, which bypasses RLS by design. Turning RLS
-- on (with no public policies) means these tables cannot be queried
-- directly by anyone using the public anon key, which is an important
-- extra layer of protection.
ALTER TABLE entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE courses ENABLE ROW LEVEL SECURITY;

-- Example: once you add your first real course, insert it like this:
-- INSERT INTO courses (slug, title, description, price_cents, stripe_price_id, is_published)
-- VALUES ('ielts-writing-masterclass', 'IELTS Writing Masterclass', 'A structured video course...', 2999, 'price_XXXXXXXXXXXX', true);
