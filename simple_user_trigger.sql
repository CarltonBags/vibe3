-- Simple user creation trigger for debugging
-- Temporarily use this to test if basic user creation works

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  default_tier_id UUID;
BEGIN
  -- Get the free tier as fallback (should always exist)
  SELECT id INTO default_tier_id FROM pricing_tiers WHERE name = 'free' LIMIT 1;

  -- If no free tier, get any tier
  IF default_tier_id IS NULL THEN
    SELECT id INTO default_tier_id FROM pricing_tiers LIMIT 1;
  END IF;

  -- Insert user profile only (no user_usage for now)
  INSERT INTO public.users (id, email, full_name, tier_id)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', ''),
    default_tier_id
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Make sure trigger is enabled
ALTER TABLE auth.users ENABLE TRIGGER on_auth_user_created;
