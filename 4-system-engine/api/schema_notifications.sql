-- Apply through the normal migration runner. All instants are stored in UTC.
CREATE TABLE IF NOT EXISTS medication_schedules (
  schedule_id BIGINT AUTO_INCREMENT PRIMARY KEY,
  resident_id VARCHAR(50) NOT NULL,
  medication_id INT NOT NULL,
  times JSON NOT NULL,
  weekdays JSON NOT NULL,
  timezone VARCHAR(50) NOT NULL DEFAULT 'Asia/Colombo',
  start_date DATE NOT NULL,
  end_date DATE DEFAULT NULL,
  food_instruction VARCHAR(500) DEFAULT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_by_uid VARCHAR(128) NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_medication_schedule (medication_id),
  FOREIGN KEY (resident_id) REFERENCES residents(resident_id) ON DELETE CASCADE,
  FOREIGN KEY (medication_id) REFERENCES medications(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS medication_reminders (
  reminder_id BIGINT AUTO_INCREMENT PRIMARY KEY,
  schedule_id BIGINT DEFAULT NULL,
  resident_id VARCHAR(50) NOT NULL,
  medication_id INT NOT NULL,
  drug_name VARCHAR(255) NOT NULL,
  dosage VARCHAR(100) DEFAULT NULL,
  food_instruction VARCHAR(500) DEFAULT NULL,
  event_day DATE NOT NULL,
  scheduled_at DATETIME(3) NOT NULL,
  presentation_at DATETIME(3) NOT NULL,
  status ENUM('pending', 'snoozed', 'taken', 'skipped', 'cancelled') NOT NULL DEFAULT 'pending',
  delivery_round INT UNSIGNED NOT NULL DEFAULT 0,
  notified_round INT NOT NULL DEFAULT -1,
  notification_id INT DEFAULT NULL,
  recorded_by_uid VARCHAR(128) DEFAULT NULL,
  recorded_at DATETIME(3) DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_medication_dose (resident_id, medication_id, scheduled_at),
  FOREIGN KEY (schedule_id) REFERENCES medication_schedules(schedule_id) ON DELETE SET NULL,
  FOREIGN KEY (resident_id) REFERENCES residents(resident_id) ON DELETE CASCADE,
  FOREIGN KEY (notification_id) REFERENCES notifications(notification_id) ON DELETE SET NULL,
  INDEX idx_medication_reminder_due (status, presentation_at),
  INDEX idx_medication_reminder_day (resident_id, event_day)
);

CREATE TABLE IF NOT EXISTS medication_reminder_actions (
  action_id BIGINT AUTO_INCREMENT PRIMARY KEY,
  reminder_id BIGINT NOT NULL,
  action ENUM('taken', 'skipped', 'snoozed') NOT NULL,
  actor_uid VARCHAR(128) NOT NULL,
  snooze_minutes INT DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (reminder_id) REFERENCES medication_reminders(reminder_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS push_devices (
  device_id BIGINT AUTO_INCREMENT PRIMARY KEY,
  owner_uid VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  installation_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  installation_key_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  push_token VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  project_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  platform ENUM('android', 'ios') NOT NULL,
  registration_version INT UNSIGNED NOT NULL DEFAULT 1,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  last_error VARCHAR(100) DEFAULT NULL,
  last_seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_push_installation (installation_id),
  UNIQUE KEY uq_push_token (token_hash),
  INDEX idx_push_owner (owner_uid, enabled)
);

-- provider_accepted means Expo handed off to FCM/APNs, never device receipt.
CREATE TABLE IF NOT EXISTS push_deliveries (
  delivery_id BIGINT AUTO_INCREMENT PRIMARY KEY,
  source_key VARCHAR(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_type ENUM('medication', 'medication_overdue', 'incident', 'sos', 'wellness', 'notification') NOT NULL,
  source_id BIGINT NOT NULL,
  resident_id VARCHAR(50) NOT NULL,
  device_id BIGINT NOT NULL,
  owner_uid VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  registration_version INT UNSIGNED NOT NULL DEFAULT 1,
  status ENUM('pending', 'retry', 'sending', 'ticket_accepted', 'provider_accepted', 'failed', 'cancelled', 'unknown') NOT NULL DEFAULT 'pending',
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  next_attempt_at DATETIME(3) NOT NULL,
  expo_ticket_id VARCHAR(128) DEFAULT NULL,
  provider_error VARCHAR(100) DEFAULT NULL,
  last_attempt_at DATETIME(3) DEFAULT NULL,
  receipt_checked_at DATETIME(3) DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_push_source_device (source_key, device_id),
  FOREIGN KEY (resident_id) REFERENCES residents(resident_id) ON DELETE CASCADE,
  FOREIGN KEY (device_id) REFERENCES push_devices(device_id) ON DELETE CASCADE,
  INDEX idx_push_due (status, next_attempt_at)
);
