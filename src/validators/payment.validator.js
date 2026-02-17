const Joi = require('joi');

const createOrderSchema = Joi.object({
  product_id: Joi.string().uuid().required(),
});

module.exports = { createOrderSchema };
