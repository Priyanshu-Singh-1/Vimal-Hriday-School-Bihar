-- Homepage navbar CRUD (Phase 4). Additive only, like 0005/0006 -- nothing
-- here touches slots, gallery, pending_publish or audit_log.
--
-- Only two navbar dropdowns are editable from the console: "The School" and
-- "Circulars". Every other navbar item (Home, About Us, Gallery, Exam,
-- School Fee) is untouched static markup with no sentinel, and this feature
-- has no way to reach it.

CREATE TABLE nav_menu_items (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  menu       TEXT    NOT NULL CHECK (menu IN ('the_school','circulars')),
  label      TEXT    NOT NULL,
  href       TEXT    NOT NULL,
  -- The site opens almost every nav link in a new tab; kept per item so an
  -- exception (a link back into the site itself) can turn it off.
  new_tab    INTEGER NOT NULL DEFAULT 1,
  -- Every current item carries the "new.gif" flag icon; kept per item so a
  -- later link can go without it.
  badge      INTEGER NOT NULL DEFAULT 1,
  -- Order within its own menu; the two menus number independently.
  position   INTEGER NOT NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_nav_menu_items_menu ON nav_menu_items (menu, position);

-- Every public page that carries the two sentinel-bounded dropdowns (see
-- tools/bin/add-nav-sentinels.mjs). A nav change marks every one of these
-- pages dirty, read from here rather than hardcoded in the Worker, so a page
-- added later is a migration, not a redeploy.
CREATE TABLE nav_pages (
  page_path TEXT PRIMARY KEY
);

INSERT INTO nav_pages (page_path) VALUES
  ('index.html'),
  ('pages/about/AboutSchool.html'),
  ('pages/about/AdmissionInformation.html'),
  ('pages/about/FIH.html'),
  ('pages/about/Gallery.html'),
  ('pages/about/Infrastructure.html'),
  ('pages/about/OurFounder.html'),
  ('pages/about/OurManagement.html'),
  ('pages/about/Portion.html'),
  ('pages/about/PrincipalMessage.html'),
  ('pages/about/aim&objective.html'),
  ('pages/about/contact.html'),
  ('pages/about/infrastructure_page.html'),
  ('pages/about/investitureceremony.html'),
  ('pages/curriculum/Activities.html'),
  ('pages/curriculum/Activity1.html'),
  ('pages/curriculum/Curriculum.html'),
  ('pages/curriculum/SchoolCirculars.html'),
  ('pages/curriculum/cultural.html'),
  ('pages/curriculum/lab.html'),
  ('pages/curriculum/noncurricular.html'),
  ('pages/events/bestoutofwaste.html'),
  ('pages/events/celebration.html'),
  ('pages/events/christmas2024.html'),
  ('pages/events/classMonitor.html'),
  ('pages/events/donnaMarry.html'),
  ('pages/events/drawing.html'),
  ('pages/events/drugAwarness.html'),
  ('pages/events/election.html'),
  ('pages/events/exhibition.html'),
  ('pages/events/footballmatch.html'),
  ('pages/events/healthyFoodPreparation.html'),
  ('pages/events/independencecelebration24.html'),
  ('pages/events/interSchool.html'),
  ('pages/events/noticeBoard.html'),
  ('pages/events/noticedecoration.html'),
  ('pages/events/planting.html'),
  ('pages/events/prizeDistribution24.html'),
  ('pages/events/rakhimaking.html'),
  ('pages/events/roomDecoration.html'),
  ('pages/events/saladCompetiton.html'),
  ('pages/events/sports-event.html'),
  ('pages/events/sportsDay.html'),
  ('pages/events/teacherSeminar.html'),
  ('pages/events/teachersday2024.html');

-- Seeded with exactly what is live today, so publishing right after this
-- migration (before anyone edits anything) changes no page's bytes.
INSERT INTO nav_menu_items (menu, label, href, new_tab, badge, position) VALUES
  ('the_school', 'Online Registration Form',
   'https://docs.google.com/forms/d/e/1FAIpQLSeF1-QqbL-oqwiHBlb8xgvlxtn0DylJuSA7W9XdCtznD8njSg/viewform?usp=sf_link',
   1, 1, 1),
  ('the_school', 'Manual Registration Form',
   'https://drive.google.com/file/d/1QxYH-Qxwe1E4BQ7-gwbu_fTCyhQhE8Kj/view?usp=sharing',
   1, 1, 2),
  ('circulars', 'Visiting Hours',
   'https://drive.google.com/file/d/1Jx6BfGYCh5WUrN_1yP3-nauWhEM8GT88/view?usp=sharing',
   1, 1, 1);
