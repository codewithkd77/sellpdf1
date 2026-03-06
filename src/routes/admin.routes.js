const { Router } = require('express');
const controller = require('../controllers/admin.controller');
const { authenticate, authorizeAdmin } = require('../middleware/auth.middleware');

const router = Router();

router.post('/login', controller.login);

router.use(authenticate, authorizeAdmin);

router.get('/moderation', controller.moderationQueue);
router.get('/moderation/:id/review-url', controller.reviewUrl);
router.post('/moderation/:id/approve', controller.approve);
router.post('/moderation/:id/reject', controller.reject);
router.delete('/products/:id', controller.deleteProduct);
router.get('/reports', controller.reports);
router.post('/reports/:id/status', controller.updateReport);

router.get('/users', controller.users);
router.get('/users/:id', controller.userDetails);
router.post('/users/:id/ban', controller.banUser);
router.post('/users/:id/unban', controller.unbanUser);

router.get('/orders', controller.orders);
router.get('/audit-logs', controller.auditLogs);

module.exports = router;
