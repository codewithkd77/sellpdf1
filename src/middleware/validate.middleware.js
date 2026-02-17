/**
 * Joi validation middleware factory.
 *
 * Usage:
 *   router.post('/register', validate(registerSchema), controller.register);
 *
 * `schema` is a Joi object schema. It validates req.body.
 */
function validate(schema) {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      const messages = error.details.map((d) => d.message);
      return res.status(400).json({ error: 'Validation failed', details: messages });
    }

    req.body = value; // use sanitised values
    next();
  };
}

module.exports = validate;
