-- ============================================================
-- CareConnect MySQL Schema
-- Database: careconnect
-- ============================================================

CREATE DATABASE IF NOT EXISTS careconnect
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE careconnect;

-- ──────────────────────────────────────────────
-- Users (linked to Firebase Auth UID)
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(128) PRIMARY KEY COMMENT 'Firebase Auth UID',
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  role ENUM('patient', 'caretaker', 'admin') NOT NULL DEFAULT 'patient',
  resident_id VARCHAR(50) DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- ──────────────────────────────────────────────
-- Residents
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS residents (
  resident_id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  age INT DEFAULT NULL,
  date_of_birth DATE DEFAULT NULL,
  address TEXT DEFAULT NULL,
  city VARCHAR(100) DEFAULT NULL,
  state VARCHAR(50) DEFAULT NULL,
  zip_code VARCHAR(20) DEFAULT NULL,
  emergency_contact_name VARCHAR(255) DEFAULT NULL,
  emergency_contact_phone VARCHAR(50) DEFAULT NULL,
  emergency_contact_relation VARCHAR(100) DEFAULT NULL,
  children JSON DEFAULT NULL,
  room_number VARCHAR(20) DEFAULT NULL,
  floor_number VARCHAR(10) DEFAULT NULL,
  admission_date DATE DEFAULT NULL,
  medical_history TEXT DEFAULT NULL,
  allergies JSON DEFAULT NULL,
  dietary_restrictions JSON DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- ──────────────────────────────────────────────
-- Prescriptions
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS prescriptions (
  prescription_id VARCHAR(50) PRIMARY KEY,
  resident_id VARCHAR(50) NOT NULL,
  date_issued DATE NOT NULL,
  doctor_name VARCHAR(255) DEFAULT NULL,
  image_url TEXT DEFAULT NULL COMMENT 'Firebase Storage download URL',
  image_path TEXT DEFAULT NULL COMMENT 'Firebase Storage path for deletion',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (resident_id) REFERENCES residents(resident_id) ON DELETE CASCADE
);

-- ──────────────────────────────────────────────
-- Medications (composition — cascade delete with prescription)
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS medications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  prescription_id VARCHAR(50) NOT NULL,
  drug_name VARCHAR(255) NOT NULL,
  dosage VARCHAR(100) DEFAULT NULL,
  frequency VARCHAR(255) DEFAULT NULL,
  FOREIGN KEY (prescription_id) REFERENCES prescriptions(prescription_id) ON DELETE CASCADE
);

-- ──────────────────────────────────────────────
-- Finished Medications (historical completion log)
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS finished_medications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  resident_id VARCHAR(50) NOT NULL,
  prescription_id VARCHAR(50) NOT NULL,
  drug_name VARCHAR(255) NOT NULL,
  dosage VARCHAR(100) DEFAULT NULL,
  frequency VARCHAR(255) DEFAULT NULL,
  finished_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (resident_id) REFERENCES residents(resident_id) ON DELETE CASCADE,
  FOREIGN KEY (prescription_id) REFERENCES prescriptions(prescription_id) ON DELETE CASCADE,
  INDEX idx_finished_resident_time (resident_id, finished_at)
);

-- ──────────────────────────────────────────────
-- Caretakers
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS caretakers (
  caretaker_id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) DEFAULT NULL,
  phone VARCHAR(50) DEFAULT NULL,
  specialization VARCHAR(100) DEFAULT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  date_joined TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ──────────────────────────────────────────────
-- Caretaker ↔ Resident assignments (many-to-many)
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS caretaker_residents (
  caretaker_id VARCHAR(50) NOT NULL,
  resident_id VARCHAR(50) NOT NULL,
  assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (caretaker_id, resident_id),
  FOREIGN KEY (caretaker_id) REFERENCES caretakers(caretaker_id) ON DELETE CASCADE,
  FOREIGN KEY (resident_id) REFERENCES residents(resident_id) ON DELETE CASCADE
);

-- ──────────────────────────────────────────────
-- Appointments
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS appointments (
  appointment_id VARCHAR(50) PRIMARY KEY,
  resident_id VARCHAR(50) NOT NULL,
  resident_name VARCHAR(255) DEFAULT NULL,
  doctor_name VARCHAR(255) DEFAULT NULL,
  specialization VARCHAR(100) DEFAULT NULL,
  appointment_date DATE DEFAULT NULL,
  appointment_time VARCHAR(20) DEFAULT NULL,
  reason TEXT DEFAULT NULL,
  status ENUM('scheduled', 'completed', 'cancelled', 'rescheduled') DEFAULT 'scheduled',
  notes TEXT DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (resident_id) REFERENCES residents(resident_id) ON DELETE CASCADE
);

-- ──────────────────────────────────────────────
-- Emotional States (historical data for charts)
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS emotional_states (
  id INT AUTO_INCREMENT PRIMARY KEY,
  resident_id VARCHAR(50) NOT NULL,
  state_score INT NOT NULL CHECK (state_score BETWEEN 0 AND 100),
  emotion_label VARCHAR(50) DEFAULT NULL COMMENT 'e.g. Happy, Sad, Nauseous, Dizzy',
  category ENUM('positive', 'neutral', 'negative', 'side-effect') DEFAULT NULL,
  related_medicine VARCHAR(255) DEFAULT NULL COMMENT 'Drug name if emotion is medicine-related',
  note TEXT DEFAULT NULL COMMENT 'Optional note from the resident',
  recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (resident_id) REFERENCES residents(resident_id) ON DELETE CASCADE,
  INDEX idx_resident_time (resident_id, recorded_at)
);

-- ──────────────────────────────────────────────
-- Leave Requests
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS leave_requests (
  request_id VARCHAR(50) PRIMARY KEY,
  caretaker_id VARCHAR(50) NOT NULL,
  caretaker_name VARCHAR(255) DEFAULT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  number_of_days INT DEFAULT NULL,
  reason TEXT DEFAULT NULL,
  status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
  request_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  reviewed_by VARCHAR(255) DEFAULT NULL,
  review_date TIMESTAMP NULL DEFAULT NULL,
  temporary_replacement VARCHAR(255) DEFAULT NULL,
  FOREIGN KEY (caretaker_id) REFERENCES caretakers(caretaker_id) ON DELETE CASCADE
);

-- ──────────────────────────────────────────────
-- Emergency Alerts
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS emergency_alerts (
  alert_id VARCHAR(50) PRIMARY KEY,
  caretaker_id VARCHAR(50) DEFAULT NULL,
  caretaker_name VARCHAR(255) DEFAULT NULL,
  message TEXT NOT NULL,
  location VARCHAR(255) DEFAULT NULL,
  alert_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  acknowledged BOOLEAN DEFAULT FALSE,
  acknowledged_by VARCHAR(255) DEFAULT NULL,
  acknowledged_at TIMESTAMP NULL DEFAULT NULL,
  FOREIGN KEY (caretaker_id) REFERENCES caretakers(caretaker_id) ON DELETE SET NULL
);

-- ──────────────────────────────────────────────
-- System Components (ML engine status)
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS system_components (
  component_id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  version VARCHAR(50) DEFAULT NULL,
  description TEXT DEFAULT NULL,
  status ENUM('online', 'offline', 'maintenance') DEFAULT 'online',
  last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- ──────────────────────────────────────────────
-- Meal Plans (AI-generated, cached per resident)
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS meal_plans (
  id INT AUTO_INCREMENT PRIMARY KEY,
  resident_id VARCHAR(50) NOT NULL,
  plan_json LONGTEXT NOT NULL COMMENT 'Full WeeklyMealPlan JSON',
  medication_count INT DEFAULT 0 COMMENT 'Number of medications when plan was generated',
  generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (resident_id) REFERENCES residents(resident_id) ON DELETE CASCADE,
  INDEX idx_meal_plan_resident (resident_id),
  UNIQUE KEY uq_resident_meal_plan (resident_id)
);


-- ──────────────────────────────────────────────
-- Wellness Alerts (AI-generated patient distress alerts for caretakers)
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wellness_alerts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  resident_id VARCHAR(50) NOT NULL,
  resident_name VARCHAR(255),
  emotion_label VARCHAR(50),
  state_score INT,
  category VARCHAR(20),
  note TEXT COMMENT 'AI clinical observation',
  severity ENUM('info', 'warning', 'critical') DEFAULT 'info',
  acknowledged BOOLEAN DEFAULT FALSE,
  acknowledged_by VARCHAR(255),
  acknowledged_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (resident_id) REFERENCES residents(resident_id) ON DELETE CASCADE,
  INDEX idx_walert_resident (resident_id),
  INDEX idx_walert_unacked (acknowledged, created_at)
);

-- ============================================================
-- SEED DATA (matches existing sample data in App.tsx)
-- ============================================================

-- System Components
INSERT IGNORE INTO system_components (component_id, name, version, description, status) VALUES
  ('SYS-001', 'OCR Engine', '2.5.1', 'Optical Character Recognition for prescription scanning', 'online'),
  ('SYS-002', 'NLP Engine', '3.1.0', 'Natural Language Processing for medication extraction', 'online'),
  ('SYS-003', 'Emotion AI', '1.8.2', 'Facial and vocal emotion analysis system', 'online');

-- Caretakers
INSERT IGNORE INTO caretakers (caretaker_id, name, email, phone, specialization) VALUES
  ('CT001', 'Sarah Johnson', 'sarah.j@care.com', '555-0101', 'General Care'),
  ('CT002', 'Michael Davis', 'michael.d@care.com', '555-0102', 'Senior Care'),
  ('CT003', 'Jennifer Lee', 'jennifer.l@care.com', '555-0103', 'Medical Specialist');

-- Residents
INSERT IGNORE INTO residents (resident_id, name, age, date_of_birth, address, city, state, zip_code,
  emergency_contact_name, emergency_contact_phone, emergency_contact_relation,
  children, room_number, floor_number, admission_date, allergies) VALUES
  ('R001', 'Margaret Thompson', 78, '1946-03-15', '123 Oak Street', 'Springfield', 'IL', '62701',
   'David Thompson', '555-1234', 'Son', '["David Thompson", "Susan Miller"]', '201', '2', '2023-01-15', '["Penicillin"]'),
  ('R002', 'Robert Chen', 82, '1942-08-22', '456 Elm Avenue', 'Springfield', 'IL', '62702',
   'Lisa Chen', '555-5678', 'Daughter', '["Lisa Chen", "Michael Chen"]', '305', '3', '2023-03-20', '["Sulfa drugs"]'),
  ('R003', 'Elizabeth Rodriguez', 75, '1949-11-30', '789 Pine Road', 'Springfield', 'IL', '62703',
   'Carlos Rodriguez', '555-9012', 'Husband', NULL, '102', '1', '2023-06-10', NULL);

-- Caretaker ↔ Resident assignments
INSERT IGNORE INTO caretaker_residents (caretaker_id, resident_id) VALUES
  ('CT001', 'R001'),
  ('CT002', 'R002'),
  ('CT002', 'R003');

-- Prescriptions
INSERT IGNORE INTO prescriptions (prescription_id, resident_id, date_issued, doctor_name) VALUES
  ('RX-001', 'R001', '2024-12-01', 'Sarah Johnson'),
  ('RX-002', 'R001', '2024-12-10', 'Michael Davis'),
  ('RX-003', 'R002', '2024-12-05', 'Sarah Johnson'),
  ('RX-004', 'R003', '2024-12-08', 'Jennifer Lee');

-- Medications
INSERT IGNORE INTO medications (prescription_id, drug_name, dosage, frequency) VALUES
  ('RX-001', 'Lisinopril', '10mg', 'once daily'),
  ('RX-001', 'Metformin', '500mg', 'twice daily'),
  ('RX-002', 'Atorvastatin', '20mg', 'once daily at bedtime'),
  ('RX-003', 'Aspirin', '81mg', 'once daily'),
  ('RX-003', 'Warfarin', '5mg', 'once daily'),
  ('RX-003', 'Furosemide', '40mg', 'twice daily'),
  ('RX-003', 'Metoprolol', '50mg', 'twice daily'),
  ('RX-003', 'Losartan', '100mg', 'once daily'),
  ('RX-004', 'Levothyroxine', '75mcg', 'once daily in morning'),
  ('RX-004', 'Calcium', '600mg', 'twice daily with meals');

-- Emotional States (sample historical data)
INSERT IGNORE INTO emotional_states (resident_id, state_score, recorded_at) VALUES
  ('R001', 68, NOW() - INTERVAL 6 HOUR),
  ('R001', 72, NOW() - INTERVAL 5 HOUR),
  ('R001', 74, NOW() - INTERVAL 4 HOUR),
  ('R001', 78, NOW() - INTERVAL 3 HOUR),
  ('R001', 80, NOW() - INTERVAL 2 HOUR),
  ('R001', 82, NOW() - INTERVAL 1 HOUR),
  ('R001', 85, NOW()),
  ('R002', 48, NOW() - INTERVAL 6 HOUR),
  ('R002', 45, NOW() - INTERVAL 5 HOUR),
  ('R002', 42, NOW() - INTERVAL 4 HOUR),
  ('R002', 38, NOW() - INTERVAL 3 HOUR),
  ('R002', 35, NOW() - INTERVAL 2 HOUR),
  ('R002', 32, NOW() - INTERVAL 1 HOUR),
  ('R002', 30, NOW()),
  ('R003', 55, NOW() - INTERVAL 6 HOUR),
  ('R003', 58, NOW() - INTERVAL 5 HOUR),
  ('R003', 62, NOW() - INTERVAL 4 HOUR),
  ('R003', 65, NOW() - INTERVAL 3 HOUR),
  ('R003', 68, NOW() - INTERVAL 2 HOUR),
  ('R003', 70, NOW() - INTERVAL 1 HOUR),
  ('R003', 72, NOW());

-- ──────────────────────────────────────────────
-- Doctors (created by admin)
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS doctors (
  doctor_id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  specialization VARCHAR(255) DEFAULT NULL,
  phone VARCHAR(50) DEFAULT NULL,
  email VARCHAR(255) DEFAULT NULL,
  hospital VARCHAR(255) DEFAULT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ──────────────────────────────────────────────
-- Complaints (patient → admin)
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS complaints (
  id INT AUTO_INCREMENT PRIMARY KEY,
  resident_id VARCHAR(50) NOT NULL,
  resident_name VARCHAR(255) DEFAULT NULL,
  subject VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  status ENUM('pending', 'reviewed', 'resolved') DEFAULT 'pending',
  admin_response TEXT DEFAULT NULL,
  responded_by VARCHAR(255) DEFAULT NULL,
  responded_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (resident_id) REFERENCES residents(resident_id) ON DELETE CASCADE,
  INDEX idx_complaint_status (status, created_at)
);
