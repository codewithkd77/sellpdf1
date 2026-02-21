const Joi = require('joi');

const createPdfSchema = Joi.object({
  title: Joi.string().min(3).max(255).required(),
  description: Joi.string().max(2000).allow('', null),
  mrp: Joi.number().min(0).precision(2).allow(null),
  price: Joi.number().positive().precision(2).required(),
  allow_download: Joi.boolean().default(false),
});

module.exports = { createPdfSchema };
