const express = require('express');
const mongoose = require('mongoose');
const Grievance = require('../models/Grievance');
const Department = require('../models/Department');
const { protect, authorize } = require('../middleware/auth');

const router = express.Router();

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const NLP_URL = process.env.NLP_SERVICE_URL || 'http://localhost:8000';
const NLP_TIMEOUT_MS = 5000;
const CRITICAL_UPVOTE_THRESHOLD = 10;
const MAX_IMAGES = 5;
const DEFAULT_EXPIRING_WINDOW_HOURS = 12;
const OFFICIAL_REMARK_PREFIX = '[Official Remark] ';

const PRIORITIES = ['Immediate', 'Routine'];
const STATUSES = ['Pending', 'In Progress', 'Resolved', 'Escalated'];
const SAFETY_CATEGORY = 'Anti-Ragging & Safety';
const CATEGORIES = ['Mess & Dining', 'Hostel', 'IT Infrastructure', 'Academics', SAFETY_CATEGORY];

// Tabs of the student feed (open tickets by priority, plus resolved ones)
const TAB_FILTERS = {
  Immediate: { priority: 'Immediate', status: { $ne: 'Resolved' } },
  Routine: { priority: 'Routine', status: { $ne: 'Resolved' } },
  Resolved: { status: 'Resolved' },
};

// NLP category -> Department.name (as seeded). Categories not listed here
// (Academics, Anti-Ragging & Safety) stay unassigned and are triaged by the Dean/admin.
const CATEGORY_TO_DEPARTMENT = {
  'Mess & Dining': 'Mess',
  Hostel: 'Hostel',
  'IT Infrastructure': 'IT',
};

// Used when the Python NLP service is down, so students can still submit.
const FALLBACK_NLP = { category: 'Uncategorized', priority: 'Medium', slaHours: 72 };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const isObjectId = (v) => typeof v === 'string' && /^[0-9a-fA-F]{24}$/.test(v);
const toObjectId = (v) => new mongoose.Types.ObjectId(v);
const sameId = (a, b) => a != null && b != null && String(a) === String(b);

const getPaging = (query) => {
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 100);
  return { page, limit, skip: (page - 1) * limit };
};

/** Returns a de-duplicated array of safe URLs, or null if the input is invalid. */
const cleanUrlList = (input) => {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input) || input.length > MAX_IMAGES) return null;

  const urls = [];
  for (const item of input) {
    if (typeof item !== 'string') return null;
    const url = item.trim();
    // allow http(s) URLs or server-relative paths like /uploads/a.jpg (blocks javascript: etc.)
    if (!url || url.length > 500 || !/^(https?:\/\/|\/(?!\/))/i.test(url)) return null;
    urls.push(url);
  }
  return [...new Set(urls)];
};

/** Calls the Python NLP service. Returns null on any failure. */
const classifyGrievance = async (text) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NLP_TIMEOUT_MS);
  try {
    const response = await fetch(`${NLP_URL}/predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`NLP service responded with ${response.status}`);

    const data = await response.json();
    if (!data.category || !Number.isFinite(data.slaHours) || data.slaHours <= 0) {
      throw new Error('Unexpected NLP response shape');
    }
    return data;
  } catch (err) {
    console.error(`NLP service unavailable, using fallback: ${err.message}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Hides the identity of anonymous students from everyone except the owner and admins.
 * Works on lean/plain objects with `student` (and optionally `comments.user`) populated.
 */
const sanitize = (g, viewer) => {
  if (!g.isAnonymous) return g;

  const studentId = g.student && g.student._id ? g.student._id : g.student;
  if (viewer.role === 'admin' || sameId(studentId, viewer.id)) return g;

  g.student = null;
  if (Array.isArray(g.comments)) {
    g.comments = g.comments.map((c) => {
      const authorId = c.user && c.user._id ? c.user._id : c.user;
      return sameId(authorId, studentId) ? { ...c, user: { name: 'Anonymous', role: 'student' } } : c;
    });
  }
  return g;
};

// Reject malformed :id values early
router.param('id', (req, res, next, id) => {
  if (!isObjectId(id)) return res.status(400).json({ message: 'Invalid grievance id' });
  return next();
});

// ---------------------------------------------------------------------------
// POST /api/grievances  - student submits a complaint
// ---------------------------------------------------------------------------
router.post(
  '/',
  protect,
  authorize('student'),
  asyncHandler(async (req, res) => {
    const { title, description, isAnonymous, studentImages, category: selectedCategory } = req.body;

    if (typeof title !== 'string' || !title.trim() || title.trim().length > 150) {
      return res.status(400).json({ message: 'Title is required (max 150 characters)' });
    }
    if (typeof description !== 'string' || !description.trim() || description.length > 5000) {
      return res.status(400).json({ message: 'Description is required (max 5000 characters)' });
    }
    const images = cleanUrlList(studentImages);
    if (images === null) {
      return res
        .status(400)
        .json({ message: `studentImages must be an array of up to ${MAX_IMAGES} valid URLs` });
    }

    // Optional category picked by the student; if omitted the AI decides
    if (selectedCategory !== undefined && selectedCategory !== '' && !CATEGORIES.includes(selectedCategory)) {
      return res.status(400).json({ message: `category must be one of: ${CATEGORIES.join(', ')}` });
    }

    // 1. Classify with the Python NLP service (always used for priority + SLA)
    const nlp = await classifyGrievance(`${title.trim()}. ${description.trim()}`);
    const result = { ...(nlp || FALLBACK_NLP) };

    if (selectedCategory) {
      result.category = selectedCategory; // the student's choice overrides the AI category
      if (selectedCategory === SAFETY_CATEGORY) {
        result.priority = 'Immediate';
        result.slaHours = Math.min(result.slaHours, 6);
      }
    }

    // 2. Auto-assign department from the predicted category
    const departmentName = CATEGORY_TO_DEPARTMENT[result.category];
    const department = departmentName ? await Department.findOne({ name: departmentName }) : null;

    // 3. SLA deadline from the returned slaHours
    const targetCompletionDate = new Date(Date.now() + result.slaHours * 60 * 60 * 1000);

    // 4. Save (NLP has 4 priority levels; the schema stores Immediate | Routine)
    const grievance = await Grievance.create({
      title: title.trim(),
      description: description.trim(),
      student: req.user.id,
      isAnonymous: Boolean(isAnonymous),
      category: result.category,
      priority: result.priority === 'Immediate' ? 'Immediate' : 'Routine',
      assignedDepartment: department ? department._id : null,
      targetCompletionDate,
      studentImages: images,
      isCriticalAlert: result.category === SAFETY_CATEGORY,
    });

    return res.status(201).json({
      grievance,
      ai: {
        category: result.category,
        nlpPriority: result.priority,
        slaHours: result.slaHours,
        assignedDepartment: department ? department.name : null,
        usedFallback: !nlp,
      },
    });
  })
);

// ---------------------------------------------------------------------------
// GET /api/grievances/department-inbox
// Overdue / about-to-expire SLA tickets are pinned to the top.
// Query: ?status=&department=<id (admin only)>&expiringWithinHours=12&page=&limit=
// ---------------------------------------------------------------------------
router.get(
  '/department-inbox',
  protect,
  authorize('authority', 'admin'),
  asyncHandler(async (req, res) => {
    const match = {};

    if (req.user.role === 'authority') {
      if (!isObjectId(req.user.department)) {
        return res.status(403).json({ message: 'No department is assigned to your account' });
      }
      match.assignedDepartment = toObjectId(req.user.department);
    } else if (req.query.department) {
      if (!isObjectId(req.query.department)) {
        return res.status(400).json({ message: 'Invalid department id' });
      }
      match.assignedDepartment = toObjectId(req.query.department);
    }

    if (req.query.status) {
      if (!STATUSES.includes(req.query.status)) {
        return res.status(400).json({ message: `status must be one of: ${STATUSES.join(', ')}` });
      }
      match.status = req.query.status;
    }

    const windowHours = Math.min(
      Math.max(parseFloat(req.query.expiringWithinHours) || DEFAULT_EXPIRING_WINDOW_HOURS, 1),
      168
    );
    const now = new Date();
    const expiringCutoff = new Date(now.getTime() + windowHours * 60 * 60 * 1000);
    const { page, limit, skip } = getPaging(req.query);

    const hasTarget = { $eq: [{ $type: '$targetCompletionDate' }, 'date'] };

    const pipeline = [
      { $match: match },
      {
        $addFields: {
          slaState: {
            $switch: {
              branches: [
                { case: { $eq: ['$status', 'Resolved'] }, then: 'closed' },
                {
                  case: { $and: [hasTarget, { $lt: ['$targetCompletionDate', now] }] },
                  then: 'overdue',
                },
                {
                  case: { $and: [hasTarget, { $lte: ['$targetCompletionDate', expiringCutoff] }] },
                  then: 'expiring',
                },
              ],
              default: 'on_track',
            },
          },
          priorityRank: { $cond: [{ $eq: ['$priority', 'Immediate'] }, 0, 1] },
        },
      },
      {
        $addFields: {
          slaRank: {
            $switch: {
              branches: [
                { case: { $eq: ['$slaState', 'overdue'] }, then: 0 },
                { case: { $eq: ['$slaState', 'expiring'] }, then: 1 },
                { case: { $eq: ['$slaState', 'on_track'] }, then: 2 },
              ],
              default: 3, // closed tickets sink to the bottom
            },
          },
        },
      },
      // overdue -> expiring -> on track -> closed; then Immediate first; then earliest deadline
      { $sort: { slaRank: 1, priorityRank: 1, targetCompletionDate: 1, createdAt: -1 } },
      { $skip: skip },
      { $limit: limit },
      {
        $addFields: {
          commentCount: { $size: { $ifNull: ['$comments', []] } },
          hasUpvoted: { $in: [toObjectId(req.user.id), { $ifNull: ['$upvotedBy', []] }] },
        },
      },
      { $project: { comments: 0, upvotedBy: 0, slaRank: 0, priorityRank: 0 } },
    ];

    const [items, total] = await Promise.all([
      Grievance.aggregate(pipeline),
      Grievance.countDocuments(match),
    ]);

    await Grievance.populate(items, [
      { path: 'student', select: 'name email' },
      { path: 'assignedDepartment', select: 'name' },
    ]);

    return res.json({
      page,
      limit,
      total,
      expiringWithinHours: windowHours,
      grievances: items.map((g) => sanitize(g, req.user)),
    });
  })
);

// ---------------------------------------------------------------------------
// GET /api/grievances/student-feed
// Public feed. Tabs: ?tab=Immediate | Routine | Resolved (Immediate/Routine = open tickets only)
// Optional: ?mine=true&category=&page=&limit=
// ---------------------------------------------------------------------------
router.get(
  '/student-feed',
  protect,
  asyncHandler(async (req, res) => {
    const baseMatch = {};

    if (req.query.status) {
      if (!STATUSES.includes(req.query.status)) {
        return res.status(400).json({ message: `status must be one of: ${STATUSES.join(', ')}` });
      }
      baseMatch.status = req.query.status;
    }
    if (req.query.category) {
      if (typeof req.query.category !== 'string') {
        return res.status(400).json({ message: 'Invalid category' });
      }
      baseMatch.category = req.query.category;
    }
    if (req.query.mine === 'true') {
      baseMatch.student = toObjectId(req.user.id);
    }

    const match = { ...baseMatch };
    if (req.query.tab) {
      if (!Object.keys(TAB_FILTERS).includes(req.query.tab)) {
        return res
          .status(400)
          .json({ message: `tab must be one of: ${Object.keys(TAB_FILTERS).join(', ')}` });
      }
      Object.assign(match, TAB_FILTERS[req.query.tab]);
    } else if (req.query.priority) {
      if (!PRIORITIES.includes(req.query.priority)) {
        return res.status(400).json({ message: `priority must be one of: ${PRIORITIES.join(', ')}` });
      }
      match.priority = req.query.priority;
    }

    const { page, limit, skip } = getPaging(req.query);

    const pipeline = [
      { $match: match },
      { $sort: { isCriticalAlert: -1, upvoteCount: -1, createdAt: -1 } },
      { $skip: skip },
      { $limit: limit },
      {
        $addFields: {
          commentCount: { $size: { $ifNull: ['$comments', []] } },
          hasUpvoted: { $in: [toObjectId(req.user.id), { $ifNull: ['$upvotedBy', []] }] },
        },
      },
      { $project: { comments: 0, upvotedBy: 0 } },
    ];

    const countBase = {};
    if (baseMatch.category) countBase.category = baseMatch.category;
    if (baseMatch.student) countBase.student = baseMatch.student;
    const tabKeys = Object.keys(TAB_FILTERS);

    const [items, total, ...tabTotals] = await Promise.all([
      Grievance.aggregate(pipeline),
      Grievance.countDocuments(match),
      ...tabKeys.map((k) => Grievance.countDocuments({ ...countBase, ...TAB_FILTERS[k] })),
    ]);

    await Grievance.populate(items, [
      { path: 'student', select: 'name' },
      { path: 'assignedDepartment', select: 'name' },
    ]);

    const tabCounts = Object.fromEntries(tabKeys.map((k, i) => [k, tabTotals[i]]));

    return res.json({
      page,
      limit,
      total,
      tabCounts,
      grievances: items.map((g) => sanitize(g, req.user)),
    });
  })
);

// ---------------------------------------------------------------------------
// GET /api/grievances/dean-overview   (admin only)
// Analytics + critical alerts + SLA-breached / escalated tickets, all departments.
// ---------------------------------------------------------------------------
router.get(
  '/dean-overview',
  protect,
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const now = new Date();

    // aggregation building blocks
    const isResolved = { $eq: ['$status', 'Resolved'] };
    const isOpen = { $ne: ['$status', 'Resolved'] };
    const hasTarget = { $eq: [{ $type: '$targetCompletionDate' }, 'date'] };
    const hasResolvedAt = { $eq: [{ $type: '$resolvedAt' }, 'date'] };
    const count = (cond) => ({ $sum: { $cond: [cond, 1, 0] } });

    const breachedFilter = {
      $or: [
        { status: 'Escalated' },
        { status: { $nin: ['Resolved', 'Escalated'] }, targetCompletionDate: { $lt: now } },
      ],
    };
    const criticalFilter = {
      status: { $ne: 'Resolved' },
      $or: [{ isCriticalAlert: true }, { upvoteCount: { $gte: CRITICAL_UPVOTE_THRESHOLD } }],
    };
    const populateOpts = [
      { path: 'student', select: 'name email' },
      { path: 'assignedDepartment', select: 'name' },
    ];

    const [deptStats, departments, critical, breached, breachedTotal] = await Promise.all([
      Grievance.aggregate([
        {
          $group: {
            _id: '$assignedDepartment',
            total: { $sum: 1 },
            resolved: count(isResolved),
            escalated: count({ $eq: ['$status', 'Escalated'] }),
            overdue: count({ $and: [isOpen, hasTarget, { $lt: ['$targetCompletionDate', now] }] }),
            critical: count({
              $and: [
                isOpen,
                {
                  $or: [
                    { $eq: ['$isCriticalAlert', true] },
                    { $gte: ['$upvoteCount', CRITICAL_UPVOTE_THRESHOLD] },
                  ],
                },
              ],
            }),
            resolutionMs: {
              $sum: {
                $cond: [{ $and: [isResolved, hasResolvedAt] }, { $subtract: ['$resolvedAt', '$createdAt'] }, 0],
              },
            },
            resolutionCount: count({ $and: [isResolved, hasResolvedAt] }),
            slaMeasured: count({ $and: [isResolved, hasResolvedAt, hasTarget] }),
            withinSla: count({
              $and: [isResolved, hasResolvedAt, hasTarget, { $lte: ['$resolvedAt', '$targetCompletionDate'] }],
            }),
          },
        },
      ]),
      Department.find({}).select('name').lean(),
      Grievance.find(criticalFilter)
        .sort({ upvoteCount: -1, createdAt: 1 })
        .limit(20)
        .select('-upvotedBy -comments')
        .populate(populateOpts)
        .lean(),
      Grievance.find(breachedFilter)
        .sort({ targetCompletionDate: 1 })
        .limit(100)
        .select('-upvotedBy -comments')
        .populate(populateOpts)
        .lean(),
      Grievance.countDocuments(breachedFilter),
    ]);

    const round1 = (n) => Math.round(n * 10) / 10;
    const toRow = (stat, departmentId, name) => {
      const s = stat || {};
      const total = s.total || 0;
      const resolved = s.resolved || 0;
      return {
        departmentId,
        name,
        total,
        open: total - resolved,
        resolved,
        escalated: s.escalated || 0,
        overdue: s.overdue || 0,
        critical: s.critical || 0,
        resolutionRate: total ? Math.round((resolved / total) * 100) : 0,
        avgResolutionHours: s.resolutionCount ? round1(s.resolutionMs / s.resolutionCount / 3600000) : null,
        slaComplianceRate: s.slaMeasured ? Math.round((s.withinSla / s.slaMeasured) * 100) : null,
      };
    };

    const statById = new Map(deptStats.map((d) => [String(d._id), d]));
    const rows = departments.map((d) => toRow(statById.get(String(d._id)), d._id, d.name));
    if (statById.has('null')) rows.push(toRow(statById.get('null'), null, 'Unassigned (Dean triage)'));

    // overall summary (computed from every group, including unassigned)
    const sum = (key) => deptStats.reduce((acc, d) => acc + (d[key] || 0), 0);
    const total = sum('total');
    const resolved = sum('resolved');
    const resolutionCount = sum('resolutionCount');
    const slaMeasured = sum('slaMeasured');

    // Escalated tickets first, then the most overdue
    const breachedSorted = [
      ...breached.filter((g) => g.status === 'Escalated'),
      ...breached.filter((g) => g.status !== 'Escalated'),
    ];

    return res.json({
      generatedAt: now,
      criticalThreshold: CRITICAL_UPVOTE_THRESHOLD,
      summary: {
        total,
        open: total - resolved,
        resolved,
        escalated: sum('escalated'),
        overdue: sum('overdue'),
        critical: sum('critical'),
        resolutionRate: total ? Math.round((resolved / total) * 100) : 0,
        avgResolutionHours: resolutionCount ? round1(sum('resolutionMs') / resolutionCount / 3600000) : null,
        slaComplianceRate: slaMeasured ? Math.round((sum('withinSla') / slaMeasured) * 100) : null,
      },
      departments: rows.sort((a, b) => b.overdue - a.overdue || b.total - a.total),
      critical,
      breached: breachedSorted,
      breachedTotal,
    });
  })
);

// ---------------------------------------------------------------------------
// GET /api/grievances/:id  - full details incl. comments
// ---------------------------------------------------------------------------
router.get(
  '/:id',
  protect,
  asyncHandler(async (req, res) => {
    const grievance = await Grievance.findById(req.params.id)
      .populate('student', req.user.role === 'student' ? 'name' : 'name email')
      .populate('assignedDepartment', 'name')
      .populate('comments.user', 'name role')
      .lean();

    if (!grievance) return res.status(404).json({ message: 'Grievance not found' });

    grievance.hasUpvoted = (grievance.upvotedBy || []).some((u) => sameId(u, req.user.id));
    delete grievance.upvotedBy;

    return res.json(sanitize(grievance, req.user));
  })
);

// ---------------------------------------------------------------------------
// POST /api/grievances/:id/upvote
// One upvote per student; $addToSet + $inc happen in a single atomic update.
// ---------------------------------------------------------------------------
router.post(
  '/:id/upvote',
  protect,
  authorize('student'),
  asyncHandler(async (req, res) => {
    // The filter only matches if this user has NOT upvoted yet, so a double-click
    // or race can never increment the counter twice.
    const updated = await Grievance.findOneAndUpdate(
      { _id: req.params.id, upvotedBy: { $ne: req.user.id } },
      { $addToSet: { upvotedBy: req.user.id }, $inc: { upvoteCount: 1 } },
      { new: true }
    ).select('upvoteCount isCriticalAlert');

    if (!updated) {
      const exists = await Grievance.exists({ _id: req.params.id });
      return exists
        ? res.status(409).json({ message: 'You have already upvoted this grievance' })
        : res.status(404).json({ message: 'Grievance not found' });
    }

    let isCriticalAlert = updated.isCriticalAlert;
    if (updated.upvoteCount >= CRITICAL_UPVOTE_THRESHOLD && !isCriticalAlert) {
      await Grievance.updateOne(
        { _id: updated._id, isCriticalAlert: false },
        { $set: { isCriticalAlert: true } }
      );
      isCriticalAlert = true;
    }

    return res.json({ upvoteCount: updated.upvoteCount, isCriticalAlert, hasUpvoted: true });
  })
);

// ---------------------------------------------------------------------------
// POST /api/grievances/:id/comments
// ---------------------------------------------------------------------------
router.post(
  '/:id/comments',
  protect,
  asyncHandler(async (req, res) => {
    const { text } = req.body;
    if (typeof text !== 'string' || !text.trim() || text.trim().length > 1000) {
      return res.status(400).json({ message: 'Comment text is required (max 1000 characters)' });
    }

    const updated = await Grievance.findByIdAndUpdate(
      req.params.id,
      { $push: { comments: { user: req.user.id, text: text.trim() } } },
      { new: true }
    )
      .select('comments')
      .populate('comments.user', 'name role');

    if (!updated) return res.status(404).json({ message: 'Grievance not found' });

    const comment = updated.comments[updated.comments.length - 1];
    return res.status(201).json({ comment, commentCount: updated.comments.length });
  })
);

// ---------------------------------------------------------------------------
// PUT /api/grievances/:id/progress
// Department authority (own department only) or admin updates progress, status,
// resolution proof images and an official remark.
// ---------------------------------------------------------------------------
router.put(
  '/:id/progress',
  protect,
  authorize('authority', 'admin'),
  asyncHandler(async (req, res) => {
    const { progressPercentage, status, resolutionProofImages, remarks } = req.body;

    const grievance = await Grievance.findById(req.params.id);
    if (!grievance) return res.status(404).json({ message: 'Grievance not found' });

    if (
      req.user.role === 'authority' &&
      !sameId(grievance.assignedDepartment, req.user.department)
    ) {
      return res.status(403).json({ message: 'This grievance is not assigned to your department' });
    }

    let changed = false;

    if (progressPercentage !== undefined) {
      const value = Number(progressPercentage);
      if (!Number.isFinite(value) || value < 0 || value > 100) {
        return res.status(400).json({ message: 'progressPercentage must be a number from 0 to 100' });
      }
      grievance.progressPercentage = value;
      changed = true;
    }

    if (status !== undefined) {
      if (!STATUSES.includes(status)) {
        return res.status(400).json({ message: `status must be one of: ${STATUSES.join(', ')}` });
      }
      grievance.status = status; // the model hook forces 100% when Resolved
      changed = true;
    }

    if (resolutionProofImages !== undefined) {
      const urls = cleanUrlList(resolutionProofImages);
      if (urls === null) {
        return res
          .status(400)
          .json({ message: `resolutionProofImages must be an array of up to ${MAX_IMAGES} valid URLs` });
      }
      urls.forEach((u) => {
        if (!grievance.resolutionProofImages.includes(u)) grievance.resolutionProofImages.push(u);
      });
      changed = changed || urls.length > 0;
    }

    if (remarks !== undefined) {
      if (typeof remarks !== 'string' || !remarks.trim() || remarks.trim().length > 1000) {
        return res.status(400).json({ message: 'remarks must be a non-empty string (max 1000 characters)' });
      }
      // The schema has no dedicated remarks field, so remarks are stored as a tagged comment.
      grievance.comments.push({ user: req.user.id, text: OFFICIAL_REMARK_PREFIX + remarks.trim() });
      changed = true;
    }

    if (!changed) {
      return res.status(400).json({ message: 'Nothing to update' });
    }

    await grievance.save();

    return res.json({
      _id: grievance._id,
      status: grievance.status,
      progressPercentage: grievance.progressPercentage,
      resolutionProofImages: grievance.resolutionProofImages,
      commentCount: grievance.comments.length,
    });
  })
);

module.exports = router;