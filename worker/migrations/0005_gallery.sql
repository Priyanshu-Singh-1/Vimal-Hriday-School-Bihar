-- Gallery events (Phase 3). Additive only: nothing here alters `slots`,
-- `assets`, `pending_publish` or `audit_log`, so the tested Phase 1 photo-slot
-- path is untouched.
--
-- A gallery category page holds an ordered grid of event tiles; each event has
-- its own HTML page holding an ordered list of photos. Both regions are
-- rendered from these two tables by `renderGalleryList`.

CREATE TABLE gallery_categories (
  id        TEXT PRIMARY KEY,              -- 'celebrations' | 'noncurricular' | 'cultural'
  label     TEXT NOT NULL,                 -- shown in the console
  page_path TEXT NOT NULL,                 -- the category page that lists the events
  -- Indentation of the rendered region, measured from the live page so a
  -- publish that changes nothing semantically produces a minimal diff.
  indent      TEXT NOT NULL,
  close_indent TEXT NOT NULL,
  -- An existing event page cloned for its nav, footer and styling when this
  -- console creates a new event, so a generated page cannot drift from the
  -- rest of the site.
  template_page TEXT NOT NULL,
  -- Directory new event pages are written to.
  event_dir     TEXT NOT NULL
);

CREATE TABLE gallery_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  category   TEXT    NOT NULL REFERENCES gallery_categories(id),
  slug       TEXT    NOT NULL,             -- 'christmas2024'
  title      TEXT    NOT NULL,             -- 'CHRISTMAS DAY (2024)'
  page_path  TEXT    NOT NULL,             -- 'pages/events/christmas2024.html'
  -- Tile link as written on the category page; page_path is relative to the
  -- repo root, this is relative to the category page.
  href       TEXT    NOT NULL,
  cover_src  TEXT    NOT NULL,             -- tile thumbnail, as written in the html
  -- Most gallery links carry target="_blank"; a few do not, and the render
  -- must not add one where the site never had it.
  new_tab    INTEGER NOT NULL DEFAULT 1,
  -- 0 renders the tile commented out, which is how the live pages already
  -- take an event down without deleting it ("Hide from the gallery").
  visible    INTEGER NOT NULL DEFAULT 1,
  position   INTEGER NOT NULL,
  -- Indentation of this event page's own photo region, captured by the
  -- converter from the page it edited. Event pages do not share one indent.
  indent       TEXT NOT NULL DEFAULT '            ',
  close_indent TEXT NOT NULL DEFAULT '        ',
  -- Set when the event page itself is a file this console created, so a
  -- permanent delete only ever removes a page we own.
  page_owned INTEGER NOT NULL DEFAULT 0,
  -- Generated pages carry a sentinel around their heading, so a rename can
  -- update the page as well as the tile. Pages that predate this console do
  -- not, and emitting the region for them would fail sentinel validation.
  has_title_region INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (category, slug)
);

CREATE INDEX idx_gallery_events_category ON gallery_events (category, position);

CREATE TABLE gallery_photos (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES gallery_events(id) ON DELETE CASCADE,
  -- Either a repo-relative path already on the page, or an R2 public URL for
  -- a photo uploaded through the console.
  src      TEXT    NOT NULL,
  -- Set only for uploads, so the unbound-asset sweep can tell them apart.
  r2_key   TEXT REFERENCES assets(r2_key),
  position INTEGER NOT NULL,
  added_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  added_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_gallery_photos_event ON gallery_photos (event_id, position);

-- Publishing normally reads a page from GitHub, renders it, and commits the
-- result. Creating and deleting an event page are the two cases where the file
-- does not yet exist, or must stop existing. This table carries that intent
-- alongside pending_publish, which only records *that* a page is dirty.
CREATE TABLE pending_page_ops (
  page_path  TEXT PRIMARY KEY,
  op         TEXT NOT NULL CHECK (op IN ('create','delete')),
  -- The generated page for 'create'; null for 'delete'.
  html       TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Only Celebrations is seeded now; the other two categories follow once this
-- holds against live data.
INSERT INTO gallery_categories
  (id, label, page_path, indent, close_indent, template_page, event_dir) VALUES
  ('celebrations', 'Celebrations', 'pages/events/celebration.html',
   '                                    ', '                        ',
   'pages/events/christmas2024.html', 'pages/events');
