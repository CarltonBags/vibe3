-- Completely disable the problematic trigger
-- This prevents it from interfering with client-side profile creation

ALTER TABLE auth.users DISABLE TRIGGER on_auth_user_created;

-- Verify trigger is disabled
SELECT tgname, tgenabled
FROM pg_trigger
WHERE tgname = 'on_auth_user_created';

-- Also drop the trigger function if it exists
DROP FUNCTION IF EXISTS public.handle_new_user() CASCADE;

-- Verify the trigger function is gone
SELECT proname
FROM pg_proc
WHERE proname = 'handle_new_user';
