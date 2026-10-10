// Idempotent, additive migrations. MySQL DDL commits implicitly; each step is
// inspected independently so an interrupted migration can be safely resumed.
export const SCHEMA_VERSION = '2026-10-monitoring-reminders-v3';
export const requiredColumns = {
  push_devices: { registration_version: 'INT UNSIGNED NOT NULL DEFAULT 1' },
  push_deliveries: { registration_version: 'INT UNSIGNED NOT NULL DEFAULT 1' },
  monitoring_devices: {camera_state: "ENUM('running','paused','stopped') NOT NULL DEFAULT 'stopped'"},
  activity_events: {request_hash:'CHAR(64) DEFAULT NULL'},
  prescriptions: { request_hash: 'CHAR(64) DEFAULT NULL' },
  medications: { needs_review: 'BOOLEAN NOT NULL DEFAULT TRUE', review_reasons: 'JSON DEFAULT NULL',
    evidence: 'JSON DEFAULT NULL', source: 'VARCHAR(100) DEFAULT NULL', confirmed: 'BOOLEAN NOT NULL DEFAULT FALSE',
    confirmed_by_uid: 'VARCHAR(128) DEFAULT NULL', confirmed_at: 'TIMESTAMP NULL DEFAULT NULL', route: 'VARCHAR(100) DEFAULT NULL' },
  emotional_states: { emotion_label: 'VARCHAR(50) DEFAULT NULL', category: "ENUM('positive','neutral','negative','side-effect') DEFAULT NULL",
    related_medicine: 'VARCHAR(255) DEFAULT NULL', note: 'TEXT DEFAULT NULL', observation_id: 'VARCHAR(80) DEFAULT NULL',
    observation_hash: 'CHAR(64) DEFAULT NULL', wellness_alert_id: 'INT DEFAULT NULL' },
  wellness_alerts: { acknowledged_by_uid: 'VARCHAR(128) DEFAULT NULL' },
  sos_alerts: { resolved_by_uid: 'VARCHAR(128) DEFAULT NULL', requested_by_uid: 'VARCHAR(128) DEFAULT NULL',
    request_id: 'CHAR(36) DEFAULT NULL', request_hash: 'CHAR(64) DEFAULT NULL' },
};
const identifier = value => {
  if (!/^[A-Za-z0-9_]+$/.test(value)) throw new Error('Invalid schema identifier');
  return `\`${value}\``;
};

export async function migrationPlan(connection, database) {
  const statements = [];
  const [columns] = await connection.execute('SELECT TABLE_NAME, COLUMN_NAME, IS_NULLABLE, DATETIME_PRECISION FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ?', [database]);
  const available = new Set(columns.map(column => `${column.TABLE_NAME}.${column.COLUMN_NAME}`));
  for (const [table, definitions] of Object.entries(requiredColumns)) for (const [column, definition] of Object.entries(definitions)) {
    if (!available.has(`${table}.${column}`)) statements.push(`ALTER TABLE ${identifier(table)} ADD COLUMN ${identifier(column)} ${definition}`);
  }
  const assignedAt = columns.find(c => c.TABLE_NAME === 'monitoring_device_residents' && c.COLUMN_NAME === 'assigned_at');
  if (assignedAt && assignedAt.DATETIME_PRECISION !== undefined && Number(assignedAt.DATETIME_PRECISION) < 6)
    statements.push('ALTER TABLE monitoring_device_residents MODIFY COLUMN assigned_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)');
  const [indexes] = await connection.execute("SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'emotional_states' AND INDEX_NAME = 'uq_emotion_observation'", [database]);
  if (!indexes.length) statements.push('ALTER TABLE emotional_states ADD UNIQUE KEY uq_emotion_observation (resident_id, observation_id)');
  const [sosIndexes] = await connection.execute("SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'sos_alerts' AND INDEX_NAME = 'uq_sos_request'", [database]);
  if (!sosIndexes.length) statements.push('ALTER TABLE sos_alerts ADD UNIQUE KEY uq_sos_request (requested_by_uid, request_id)');
  const [references] = await connection.execute(`SELECT k.CONSTRAINT_NAME, r.DELETE_RULE FROM information_schema.KEY_COLUMN_USAGE k JOIN information_schema.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME AND r.TABLE_NAME = k.TABLE_NAME WHERE k.TABLE_SCHEMA = ? AND k.TABLE_NAME = 'finished_medications' AND k.COLUMN_NAME = 'prescription_id' AND k.REFERENCED_TABLE_NAME = 'prescriptions'`, [database]);
  const retained = references.some(reference => reference.DELETE_RULE === 'SET NULL');
  if (!retained) {
    for (const reference of references) statements.push(`ALTER TABLE finished_medications DROP FOREIGN KEY ${identifier(reference.CONSTRAINT_NAME)}`);
    const column = columns.find(column => column.TABLE_NAME === 'finished_medications' && column.COLUMN_NAME === 'prescription_id');
    if (column?.IS_NULLABLE !== 'YES') statements.push('ALTER TABLE finished_medications MODIFY COLUMN prescription_id VARCHAR(50) DEFAULT NULL');
    statements.push('ALTER TABLE finished_medications ADD CONSTRAINT fk_finished_prescription_retained FOREIGN KEY (prescription_id) REFERENCES prescriptions(prescription_id) ON DELETE SET NULL');
  }
  return statements;
}

export async function applyMigrations(connection, database, { allowChanges = false } = {}) {
  const plan = await migrationPlan(connection, database);
  if (plan.length && !allowChanges) throw new Error(`${plan.length} schema changes are pending. Review --dry-run, then run setup_db.js --migrate --confirm.`);
  for (const statement of plan) await connection.query(statement);
  await connection.execute('INSERT INTO schema_migrations (version) VALUES (?) ON DUPLICATE KEY UPDATE version = VALUES(version)', [SCHEMA_VERSION]);
  return plan;
}

export async function isSchemaReady(pool) {
  try {
    const [rows] = await pool.execute('SELECT version FROM schema_migrations WHERE version = ? LIMIT 1', [SCHEMA_VERSION]);
    return rows.length === 1;
  } catch { return false; }
}
