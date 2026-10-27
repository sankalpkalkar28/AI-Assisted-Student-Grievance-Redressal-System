const mongoose = require('mongoose');

const commentSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  text: {
    type: String,
    required: true,
    trim: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

const grievanceSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Title is required'],
      trim: true,
      maxlength: 150,
    },
    description: {
      type: String,
      required: [true, 'Description is required'],
      trim: true,
    },
    // Always stored (so authorities can act on it and admins can audit),
    // but must be hidden in API responses when isAnonymous is true.
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    isAnonymous: {
      type: Boolean,
      default: false,
    },

    // Set from the NLP service (/predict) when the grievance is created
    category: {
      type: String,
      required: true,
      trim: true,
    },
    priority: {
      type: String,
      enum: ['Immediate', 'Routine'],
      default: 'Routine',
    },
    assignedDepartment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Department',
      default: null,
    },
    targetCompletionDate: {
      type: Date,
      default: null,
    },
    // Set automatically when status becomes Resolved (used for resolution-time analytics)
    resolvedAt: {
      type: Date,
      default: null,
    },

    status: {
      type: String,
      enum: ['Pending', 'In Progress', 'Resolved', 'Escalated'],
      default: 'Pending',
    },
    progressPercentage: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },

    studentImages: [{ type: String }],
    resolutionProofImages: [{ type: String }],

    upvoteCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    upvotedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

    isCriticalAlert: {
      type: Boolean,
      default: false,
    },

    comments: [commentSchema],
  },
  { timestamps: true }
);

// A resolved grievance is always 100% complete and records when it was resolved
grievanceSchema.pre('save', function () {
  if (this.status === 'Resolved') {
    this.progressPercentage = 100;
    if (!this.resolvedAt) this.resolvedAt = new Date();
  } else if (this.resolvedAt) {
    this.resolvedAt = null; // ticket was re-opened
  }
  next();
});

// Common query patterns: dashboards by department/status, student "my grievances", SLA checks
grievanceSchema.index({ assignedDepartment: 1, status: 1 });
grievanceSchema.index({ student: 1, createdAt: -1 });
grievanceSchema.index({ status: 1, targetCompletionDate: 1 });

module.exports = mongoose.model('Grievance', grievanceSchema);