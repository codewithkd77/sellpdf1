const adminService = require('../services/admin.service');

async function login(req, res, next) {
  try {
    const data = await adminService.login({
      adminId: req.body?.id,
      password: req.body?.password,
    });
    res.json(data);
  } catch (err) {
    next(err);
  }
}

async function moderationQueue(req, res, next) {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20;
    const status = req.query.status || 'pending_review';
    const rows = await adminService.listModerationQueue({ status, page, limit });
    res.json(rows);
  } catch (err) {
    next(err);
  }
}

async function approve(req, res, next) {
  try {
    const row = await adminService.approveProduct({
      productId: req.params.id,
      adminId: req.user.id,
    });
    res.json(row);
  } catch (err) {
    next(err);
  }
}

async function reject(req, res, next) {
  try {
    const row = await adminService.rejectProduct({
      productId: req.params.id,
      adminId: req.user.id,
      reason: req.body?.reason,
    });
    res.json(row);
  } catch (err) {
    next(err);
  }
}

async function users(req, res, next) {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20;
    const q = req.query.q || '';
    const rows = await adminService.listUsers({ page, limit, q });
    res.json(rows);
  } catch (err) {
    next(err);
  }
}

async function userDetails(req, res, next) {
  try {
    const data = await adminService.getUserDetails(req.params.id);
    res.json(data);
  } catch (err) {
    next(err);
  }
}

async function orders(req, res, next) {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20;
    const status = req.query.status || '';
    const rows = await adminService.listOrders({ page, limit, status });
    res.json(rows);
  } catch (err) {
    next(err);
  }
}

async function auditLogs(req, res, next) {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 50;
    const rows = await adminService.listAuditLogs({ page, limit });
    res.json(rows);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  login,
  moderationQueue,
  approve,
  reject,
  users,
  userDetails,
  orders,
  auditLogs,
};
