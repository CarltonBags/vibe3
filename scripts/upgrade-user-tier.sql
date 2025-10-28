-- Script to upgrade a user's pricing tier for testing
-- Run this in Supabase SQL Editor

-- First, find your user ID (replace with your email)
SELECT id, email, tier_id 
FROM public.users 
WHERE email = 'carltonbags@gmail.com';

-- Then, upgrade to Professional tier (or any other tier)
UPDATE public.users
SET tier_id = (SELECT id FROM public.pricing_tiers WHERE name = 'enterprise')
WHERE email = 'carltonbags@gmail.com';

-- Verify the update
SELECT u.id, u.email, pt.name as tier_name, pt.display_name, pt.max_generations_per_month
FROM public.users u
JOIN public.pricing_tiers pt ON u.tier_id = pt.id
WHERE u.email = 'carltonbags@gmail.com';

-- Available tiers:
-- 'free' - Starter (5 generations, 3 projects)
-- 'creator' - Creator (50 generations, 10 projects) - $19/mo
-- 'professional' - Professional (200 generations, 30 projects) - $49/mo
-- 'team' - Team (500 generations, 100 projects) - $99/mo
-- 'enterprise' - Enterprise (999999 generations, unlimited projects) - $299/mo

