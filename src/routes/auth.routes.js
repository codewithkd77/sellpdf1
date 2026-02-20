const { Router } = require('express');
const controller = require('../controllers/auth.controller');
const validate = require('../middleware/validate.middleware');
const {
  registerSchema,
  loginSchema,
  sendOtpSchema,
  verifyOtpSchema,
} = require('../validators/auth.validator');

const router = Router();

router.post('/register', validate(registerSchema), controller.register);
router.post('/login', validate(loginSchema), controller.login);
router.post('/send-otp', validate(sendOtpSchema), controller.sendOtp);
router.post('/verify-otp', validate(verifyOtpSchema), controller.verifyOtp);

module.exports = router;
