/**
 * Seed script: creates 3 departments and 3 demo accounts.
 *
 * Usage:  node seed.js
 * WARNING: clears the existing Users and Departments collections first.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const mongoose = require('mongoose');
const connectDB = require('./config/db');
const User = require('./models/User');
const Department = require('./models/Department');

const seed = async () => {
  await connectDB();

  try {
    // 1. Clean slate
    await User.deleteMany({});
    await Department.deleteMany({});
    console.log('Cleared existing users and departments');

    // 2. Departments (headUser is linked after users are created)
    const [mess, hostel, it] = await Department.create([
      { name: 'Mess', slaHoursImmediate: 6, slaDaysRoutine: 3 },
      { name: 'Hostel', slaHoursImmediate: 6, slaDaysRoutine: 3 },
      { name: 'IT', slaHoursImmediate: 6, slaDaysRoutine: 3 },
    ]);
    console.log('Created departments: Mess, Hostel, IT');

    // 3. Users (.create() so the password-hashing hook runs)
    const student = await User.create({
      name: 'Demo Student',
      email: 'student@college.edu',
      password: 'password123',
      role: 'student',
    });

    const hodMess = await User.create({
      name: 'Mess Head (HOD)',
      email: 'hod.mess@college.edu',
      password: 'password123',
      role: 'authority',
      department: mess._id,
    });

    const dean = await User.create({
      name: 'Dean of Student Affairs',
      email: 'dean@college.edu',
      password: 'password123',
      role: 'admin',
    });

    // 4. Link the Mess department head
    mess.headUser = hodMess._id;
    await mess.save();

    console.log('\nSeed complete. Demo logins (password: password123):');
    console.log(`  Student   -> ${student.email}`);
    console.log(`  Dept Head -> ${hodMess.email}  (Mess)`);
    console.log(`  Dean      -> ${dean.email}`);
    console.log(`\nDepartment IDs: Mess=${mess._id} Hostel=${hostel._id} IT=${it._id}`);
  } catch (error) {
    console.error(`Seeding failed: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await mongoose.connection.close();
  }
};

seed();