import pg from 'pg';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';

const { Pool } = pg;

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'datingapp',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  max: 10,
});

const FIRST_NAMES = ['James', 'Mary', 'John', 'Patricia', 'Robert', 'Jennifer', 'Michael', 'Linda', 'William', 'Elizabeth', 'David', 'Barbara', 'Richard', 'Susan', 'Joseph', 'Jessica', 'Thomas', 'Sarah', 'Charles', 'Karen', 'Elena', 'Mateo', 'Yuki', 'Sofia', 'Aisha', 'Chen', 'Isabella', 'Liam', 'David', 'Sarah', 'Emma', 'Olivia', 'Ava', 'Sophia', 'Isabella', 'Mia', 'Charlotte', 'Amelia', 'Harper', 'Evelyn'];
const LAST_NAMES = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson', 'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee', 'Perez', 'Thompson', 'White', 'Harris', 'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Robinson'];
const LOCATIONS = ['New York, USA', 'Los Angeles, USA', 'Chicago, USA', 'London, UK', 'Paris, France', 'Tokyo, Japan', 'Sydney, Australia', 'Berlin, Germany', 'Toronto, Canada', 'Madrid, Spain', 'Rome, Italy', 'Amsterdam, Netherlands', 'Stockholm, Sweden', 'Vienna, Austria', 'Dubai, UAE', 'Singapore', 'Hong Kong', 'Mumbai, India', 'São Paulo, Brazil', 'Mexico City, Mexico'];
const INTERESTS = ['Travel', 'Photography', 'Cooking', 'Music', 'Movies', 'Gaming', 'Reading', 'Fitness', 'Hiking', 'Dancing', 'Art', 'Fashion', 'Technology', 'Sports', 'Yoga', 'Wine', 'Coffee', 'Pets', 'Crafts', 'Coding'];
const LANGUAGES = ['English', 'Spanish', 'French', 'German', 'Italian', 'Portuguese', 'Russian', 'Japanese', 'Chinese', 'Korean', 'Arabic', 'Hindi', 'Dutch', 'Swedish', 'Polish', 'Turkish', 'Vietnamese', 'Thai', 'Indonesian', 'Greek'];

function randomItem(arr: string[]) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomItems(arr: string[], count: number) {
  const shuffled = [...arr].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, count);
}

function generateUser(index: number, passwordHash: string) {
  const firstName = randomItem(FIRST_NAMES);
  const lastName = randomItem(LAST_NAMES);
  const email = `user${index}@example.com`;
  const name = `${firstName} ${lastName}`;
  const age = 18 + Math.floor(Math.random() * 42);
  const location = randomItem(LOCATIONS);
  const bio = `Hi! I'm ${firstName}. ${randomItem(['Love traveling', 'Tech enthusiast', 'Foodie', 'Music lover', 'Adventure seeker', 'Book worm', 'Fitness junkie', 'Artist'])}. Looking to meet new people!`;
  const images = [
    `https://picsum.photos/seed/${index}a/600/800`,
    `https://picsum.photos/seed/${index}b/600/800`,
  ];
  const interests = randomItems(INTERESTS, 3 + Math.floor(Math.random() * 4));
  const languages = randomItems(LANGUAGES, 1 + Math.floor(Math.random() * 3));
  
  return { email, name, age, location, bio, images, interests, languages, passwordHash };
}

async function seedUsers(count: number) {
  console.log(`Generating ${count} users with bcrypt hashed passwords...`);
  
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const passwordHash = await bcrypt.hash('password123', 10);
    console.log(`Generated bcrypt hash: ${passwordHash}`);
    
    const BATCH_SIZE = 1000;
    for (let i = 0; i < count; i += BATCH_SIZE) {
      const batch = [];
      for (let j = 0; j < BATCH_SIZE && i + j < count; j++) {
        const user = generateUser(i + j, passwordHash);
        batch.push(user);
      }
      
      const values: string[] = [];
      const params: any[] = [];
      let paramIndex = 1;
      
      for (const user of batch) {
        values.push(`($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3}, $${paramIndex + 4}, $${paramIndex + 5}, $${paramIndex + 6}, $${paramIndex + 7}, $${paramIndex + 8})`);
        params.push(user.email, user.passwordHash, user.name, user.age, user.location, user.bio, user.images, user.interests, user.languages);
        paramIndex += 9;
      }
      
      await client.query(
        `INSERT INTO users (email, password_hash, name, age, location, bio, images, interests, languages)
         VALUES ${values.join(', ')}
         ON CONFLICT (email) DO NOTHING`,
        params
      );
      
      if ((i + BATCH_SIZE) % 10000 === 0) {
        console.log(`  Inserted ${i + BATCH_SIZE} users...`);
      }
    }
    
    await client.query('COMMIT');
    console.log(`Successfully seeded ${count} users!`);
    
    const result = await client.query('SELECT COUNT(*) as count FROM users');
    console.log(`Total users in database: ${result.rows[0].count}`);
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error seeding users:', error);
  } finally {
    client.release();
  }
}

async function seedSwipes(count: number) {
  console.log(`Generating ${count} swipes...`);
  
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const userCountResult = await client.query('SELECT COUNT(*) as count FROM users');
    const userCount = parseInt(userCountResult.rows[0].count);
    
    if (userCount === 0) {
      console.log('No users found. Seed users first.');
      return;
    }
    
    const BATCH_SIZE = 5000;
    for (let i = 0; i < count; i += BATCH_SIZE) {
      const values: string[] = [];
      const params: any[] = [];
      let paramIndex = 1;
      
      for (let j = 0; j < BATCH_SIZE && i + j < count; j++) {
        const swiperId = Math.floor(Math.random() * userCount) + 1;
        let swipedId = Math.floor(Math.random() * userCount) + 1;
        while (swiperId === swipedId) {
          swipedId = Math.floor(Math.random() * userCount) + 1;
        }
        const direction = Math.random() > 0.5 ? 'right' : 'left';
        
        values.push(`($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2})`);
        params.push(swiperId, swipedId, direction);
        paramIndex += 3;
      }
      
      await client.query(
        `INSERT INTO swipes (swiper_id, swiped_id, direction)
         VALUES ${values.join(', ')}
         ON CONFLICT (swiper_id, swiped_id) DO NOTHING`,
        params
      );
      
      if ((i + BATCH_SIZE) % 50000 === 0) {
        console.log(`  Inserted ${i + BATCH_SIZE} swipes...`);
      }
    }
    
    await client.query('COMMIT');
    console.log(`Successfully seeded ${count} swipes!`);
    
    const result = await client.query('SELECT COUNT(*) as count FROM swipes');
    console.log(`Total swipes in database: ${result.rows[0].count}`);
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error seeding swipes:', error);
  } finally {
    client.release();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const count = parseInt(args[1]) || 10000;
  
  switch (command) {
    case 'users':
      await seedUsers(count);
      break;
    case 'swipes':
      await seedSwipes(count);
      break;
    case 'all':
      await seedUsers(5000000);
      await seedSwipes(10000000);
      break;
    default:
      console.log('Usage: npx tsx sql/seed.ts <users|swipes|all> [count]');
      console.log('  users [count] - Seed users (default 10000)');
      console.log('  swipes [count] - Seed swipes');
      console.log('  all - Seed 5M users and 10M swipes');
  }
  
  await pool.end();
}

main().catch(console.error);