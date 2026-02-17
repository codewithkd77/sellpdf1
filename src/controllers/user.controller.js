const userService = require('../services/user.service');

async function getProfile(req, res, next) {
  try {
    const profile = await userService.getProfile(req.user.id);
    res.json(profile);
  } catch (err) {
    next(err);
  }
}

async function updateName(req, res, next) {
  try {
    const { name } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }
    const user = await userService.updateName(req.user.id, name);
    res.json(user);
  } catch (err) {
    next(err);
  }
}

async function uploadProfilePicture(req, res, next) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Image file is required' });
    }
    const user = await userService.uploadProfilePicture(req.user.id, req.file);
    res.json(user);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getProfile,
  updateName,
  uploadProfilePicture,
};
