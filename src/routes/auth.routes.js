const { Router } = require('express');
const controller = require('../controllers/auth.controller');
const validate = require('../middleware/validate.middleware');
const { registerSchema, loginSchema } = require('../validators/auth.validator');

const router = Router();

router.post('/register', validate(registerSchema), controller.register);
router.post('/login', validate(loginSchema), controller.login);

module.exports = router;
