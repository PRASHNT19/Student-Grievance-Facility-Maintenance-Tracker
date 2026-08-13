import { closePool, query } from '../data/db';
import { runMigrations } from '../data/migrate';

/**
 * Sample data. Users matter here because POST /tickets needs a real
 * `reportedBy` and every staff action needs a real staff `actorId`, and the API
 * has no user-creation endpoint (users are outside the endpoint scope), so
 * seeding is how you get usable ids for manual testing.
 */
async function seed(): Promise<void> {
  await runMigrations();

  const users = await query<{
    id: string;
    name: string;
    email: string;
    role: string;
  }>(
    `INSERT INTO users (name, email, role) VALUES
       ('Nalisha Thapa',    'nalisha@campus.example',  'student'),
       ('Prajwal Thakuri',  'prajwal@campus.example',  'student'),
       ('Sita Gurung',      'sita@campus.example',     'staff'),
       ('Ramesh Adhikari',  'ramesh@campus.example',   'staff'),
       ('Estates Office',   'estates@campus.example',  'admin')
     ON CONFLICT (email) DO UPDATE
       SET name = EXCLUDED.name, role = EXCLUDED.role
     RETURNING id, name, email, role`,
  );

  const facilities = await query<{
    id: string;
    name: string;
    building: string;
  }>(
    `INSERT INTO facilities (name, building) VALUES
       ('Computer Lab 301', 'Science Block'),
       ('Lecture Hall 12',  'Science Block'),
       ('Physics Lab',      'Science Block'),
       ('Washroom - Floor 2', 'Hostel Block B'),
       ('Common Room',      'Hostel Block B')
     ON CONFLICT (building, name) DO UPDATE SET name = EXCLUDED.name
     RETURNING id, name, building`,
  );

  console.log('\nSeeded users:');
  for (const u of users.rows) {
    console.log(`  ${u.id}  ${u.role.padEnd(7)} ${u.name} <${u.email}>`);
  }

  console.log('\nSeeded facilities:');
  for (const f of facilities.rows) {
    console.log(`  ${f.id}  ${f.building} / ${f.name}`);
  }

  console.log(
    '\nUse a student id as reportedBy in POST /tickets, and a staff id as' +
      '\nactorId when claiming, resolving or scheduling maintenance.\n',
  );
}

seed()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closePool());
