// Quick test of database connection
import 'dotenv/config';
import { neon } from '@neondatabase/serverless';

console.log('Testing database connection...');
console.log('DATABASE_URL exists:', !!process.env.DATABASE_URL);

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set!');
  process.exit(1);
}

try {
  const sql = neon(process.env.DATABASE_URL);
  console.log('Created neon client successfully');

  // Try a simple query
  const result = await sql`SELECT NOW() as current_time`;
  console.log('Database connection successful!');
  console.log('Current time from DB:', result[0].current_time);

  // Try to query twitter_settings table
  const settings = await sql`SELECT * FROM twitter_settings LIMIT 5`;
  console.log('Twitter settings count:', settings.length);
  if (settings.length > 0) {
    console.log('Found settings:', settings.map(s => s.username));
  } else {
    console.log('No Twitter settings found in database');
  }

  process.exit(0);
} catch (error) {
  console.error('Database connection FAILED:', error);
  console.error('Error details:', error.message);
  process.exit(1);
}
