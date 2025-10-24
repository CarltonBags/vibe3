// Quick script to upgrade your user tier for testing
// Usage: npx tsx scripts/upgrade-tier.ts YOUR_EMAIL professional

import { createClient } from '@supabase/supabase-js';

const email = process.argv[2];
const tierName = process.argv[3] || 'professional';

if (!email) {
  console.error('Usage: npx tsx scripts/upgrade-tier.ts YOUR_EMAIL [tier_name]');
  console.log('\nAvailable tiers:');
  console.log('  - free (Starter: 5 generations)');
  console.log('  - creator (Creator: 50 generations) - $19/mo');
  console.log('  - professional (Professional: 200 generations) - $49/mo');
  console.log('  - team (Team: 500 generations) - $99/mo');
  console.log('  - enterprise (Enterprise: unlimited) - $299/mo');
  process.exit(1);
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_PROJECT_ID 
  ? `https://${process.env.NEXT_PUBLIC_SUPABASE_PROJECT_ID}.supabase.co`
  : '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE || '';

if (!supabaseUrl || !supabaseKey) {
  console.error('Error: Missing Supabase credentials in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function upgradeTier() {
  try {
    console.log(`Looking up user: ${email}...`);
    
    // Get user
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id, email, tier_id')
      .eq('email', email)
      .single();

    if (userError || !user) {
      console.error('User not found:', userError);
      return;
    }

    console.log(`Found user: ${user.id}`);

    // Get new tier
    const { data: tier, error: tierError } = await supabase
      .from('pricing_tiers')
      .select('*')
      .eq('name', tierName)
      .single();

    if (tierError || !tier) {
      console.error('Tier not found:', tierError);
      return;
    }

    console.log(`Upgrading to: ${tier.display_name} (${tier.max_generations_per_month} generations/month)`);

    // Update user tier
    const { error: updateError } = await supabase
      .from('users')
      .update({ tier_id: tier.id })
      .eq('id', user.id);

    if (updateError) {
      console.error('Failed to update:', updateError);
      return;
    }

    console.log('✅ Tier upgraded successfully!');
    console.log(`\n🎉 You now have:`);
    console.log(`   - ${tier.max_generations_per_month} generations per month`);
    console.log(`   - ${tier.max_projects} project slots`);
    console.log(`   - ${tier.max_tokens_per_generation.toLocaleString()} tokens per generation`);
    console.log(`\nRefresh your browser to see the changes!`);

  } catch (error) {
    console.error('Error:', error);
  }
}

upgradeTier();

