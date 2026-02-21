const { Router } = require('express');
const multer = require('multer');
const controller = require('../controllers/pdf.controller');
const { authenticate } = require('../middleware/auth.middleware');

const router = Router();

// Multer memory storage: max 50 MB PDF, max 5 MB optional cover image.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.fieldname === 'file' && file.mimetype === 'application/pdf') {
      cb(null, true);
      return;
    }
    if (file.fieldname === 'cover' && file.mimetype.startsWith('image/')) {
      cb(null, true);
      return;
    }
    cb(new Error('Only PDF file and image cover are allowed'), false);
  },
});

// Upload PDF (any authenticated user)
router.post(
  '/',
  authenticate,
  upload.fields([
    { name: 'file', maxCount: 1 },
    { name: 'cover', maxCount: 1 },
  ]),
  controller.create
);

// List own products
router.get(
  '/my',
  authenticate,
  controller.myProducts
);

// Public: list all products
router.get('/list', controller.list);

// Public: search products by title, description, or code
router.get('/search', controller.search);

// Public: lookup by short code
router.get('/code/:code', controller.getByCode);

// Public: single product details
router.get('/:id', controller.getById);

// Get signed URL to view/download purchased PDF
router.get(
  '/:id/access',
  authenticate,
  controller.access
);

// Delete a product listing (seller only)
router.delete(
  '/:id',
  authenticate,
  controller.deleteProduct
);

// Update product price (seller only)
router.put(
  '/:id/price',
  authenticate,
  controller.updatePrice
);

module.exports = router;
