const authService = require('../services/auth.service');

async function register(req, res, next) {
  try {
    const data = await authService.register(req.body);
    res.status(201).json(data);
  } catch (err) {
    next(err);
  }
}

async function login(req, res, next) {
  try {
    const data = await authService.login(req.body);
    res.json(data);
  } catch (err) {
    next(err);
  }
}

async function sendOtp(req, res, next) {
  try {
    const data = await authService.sendOtp(req.body);
    res.json(data);
  } catch (err) {
    next(err);
  }
}

async function verifyOtp(req, res, next) {
  try {
    const data = await authService.verifyOtp(req.body);
    res.json(data);
  } catch (err) {
    next(err);
  }
}

module.exports = { register, login, sendOtp, verifyOtp };
