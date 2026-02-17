const { Router } = require('express');
const multer = require('multer');
const controller = require('../controllers/user.controller');
const { authenticate } = require('../middleware/auth.middleware');

const router = Router();

// Multer for profile picture upload (max 5 MB, images only)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  },
});

// Get user profile
router.get('/profile', authenticate, controller.getProfile);

// Update user name
router.put('/profile/name', authenticate, controller.updateName);

// Upload/update profile picture
router.post(
  '/profile/picture',
  authenticate,
  upload.single('image'),
  controller.uploadProfilePicture
);

module.exports = router;
