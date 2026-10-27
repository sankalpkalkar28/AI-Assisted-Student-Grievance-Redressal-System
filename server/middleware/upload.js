const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { protect } = require('../middleware/auth');

const router = express.Router();

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const MAX_FILES = 5;
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

// The file extension is derived from the MIME type, never from the user-supplied name.
const EXTENSIONS = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (req, file, cb) =>
    cb(null, crypto.randomBytes(16).toString('hex') + EXTENSIONS[file.mimetype]),
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE, files: MAX_FILES },
  fileFilter: (req, file, cb) =>
    EXTENSIONS[file.mimetype]
      ? cb(null, true)
      : cb(new Error('Only JPG, PNG, WEBP or GIF images are allowed')),
});

/**
 * POST /api/uploads   (multipart/form-data, field name: "images")
 * Returns { urls: ["/uploads/<file>", ...] } which can be passed to
 * POST /api/grievances as studentImages (or as resolution proof images).
 */
router.post('/', protect, (req, res) => {
  upload.array('images', MAX_FILES)(req, res, (err) => {
    if (err) {
      const message =
        err.code === 'LIMIT_FILE_SIZE'
          ? 'Each image must be 5 MB or smaller'
          : err.code === 'LIMIT_UNEXPECTED_FILE' || err.code === 'LIMIT_FILE_COUNT'
          ? `You can upload at most ${MAX_FILES} images`
          : err.message;
      return res.status(400).json({ message });
    }
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ message: 'No images received' });
    }
    return res.json({ urls: req.files.map((f) => `/uploads/${f.filename}`) });
  });
});

module.exports = router;