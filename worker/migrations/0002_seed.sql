INSERT INTO sections (id, label, position, page_path) VALUES
  ('celebrations',  'Celebrations',   1, 'pages/events/celebration.html'),
  ('noncurricular', 'Non-curricular', 2, 'pages/curriculum/noncurricular.html'),
  ('cultural',      'Cultural',       3, 'pages/curriculum/cultural.html');

INSERT INTO users (username, password_hash, salt, iterations, role)
VALUES ('admin', 'MUST_BE_RESET', 'MUST_BE_RESET', 100000, 'owner');
