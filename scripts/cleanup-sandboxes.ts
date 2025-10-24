// Run this script to clean up old Daytona sandboxes
// Usage: npx tsx scripts/cleanup-sandboxes.ts

import { Daytona } from '@daytonaio/sdk';

async function cleanupSandboxes() {
  const daytona = new Daytona({
    apiKey: process.env.DAYTONA_KEY || '',
    apiUrl: process.env.DAYTONA_URL || 'https://api.daytona.io',
  });

  try {
    console.log('Fetching all sandboxes...');
    const sandboxes = await daytona.list();
    
    console.log(`Found ${sandboxes.length} sandboxes`);
    
    if (sandboxes.length === 0) {
      console.log('No sandboxes to clean up');
      return;
    }

    console.log('Removing all sandboxes...');
    for (const sandbox of sandboxes) {
      try {
        await daytona.remove(sandbox.id);
        console.log(`✓ Removed sandbox: ${sandbox.id}`);
      } catch (err) {
        console.error(`✗ Failed to remove ${sandbox.id}:`, err);
      }
    }
    
    console.log('✅ Cleanup complete!');
  } catch (error) {
    console.error('Error during cleanup:', error);
  }
}

cleanupSandboxes();

