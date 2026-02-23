const pool = require('../database/pool');

async function logAudit({
  actorType = 'admin',
  actorId = null,
  action,
  targetType = null,
  targetId = null,
  metadata = null,
}) {
  if (!action) return;
  await pool.query(
    `INSERT INTO audit_logs (actor_type, actor_id, action, target_type, target_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [actorType, actorId, action, targetType, targetId, metadata]
  );
}

module.exports = { logAudit };
