const jwt = require('jsonwebtoken');

/**
 * Verifies the "Authorization: Bearer <token>" header and attaches
 * req.user = { id, role, department } (taken from the JWT payload).
 */
const protect = (req, res, next) => {
  const [scheme, token] = (req.headers.authorization || '').split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ message: 'Not authorized: token missing' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = {
      id: decoded.userId,
      role: decoded.role,
      department: decoded.department || null,
    };
    return next();
  } catch (err) {
    return res.status(401).json({ message: 'Not authorized: invalid or expired token' });
  }
};

/** Restricts a route to the given roles, e.g. authorize('authority', 'admin'). */
const authorize = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({ message: 'Forbidden: insufficient permissions' });
  }
  return next();
};

module.exports = { protect, authorize };