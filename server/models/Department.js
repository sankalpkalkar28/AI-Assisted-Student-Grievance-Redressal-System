const mongoose = require('mongoose');

const departmentSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Department name is required'],
      unique: true,
      trim: true,
    },
    headUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    // SLA for urgent grievances, in hours
    slaHoursImmediate: {
      type: Number,
      default: 6,
      min: 1,
    },
    // SLA for routine grievances, in days
    slaDaysRoutine: {
      type: Number,
      default: 3,
      min: 1,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Department', departmentSchema);