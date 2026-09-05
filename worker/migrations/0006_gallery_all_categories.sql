-- A few event pages group their photos under visible subheadings inside the
-- same <ul>, e.g. noticeBoard.html:
--
--     <div class="modern-heading-container">
--       <h2 class="modern-heading">Notice Board (April'24)</h2>
--     </div>
--
-- Regenerating that region from a flat list of photos would delete those
-- headings -- it shortened the page by 543px when tried. Such an event still
-- gets a managed tile (rename, hide, reorder); only its photo list is left
-- alone, and the console says so.
ALTER TABLE gallery_events ADD COLUMN photos_managed INTEGER NOT NULL DEFAULT 1;

-- The remaining two parts of the gallery, now that Celebrations has been
-- exercised against live data.
--
-- Indentation measured from each page: both use a 24-space `<ul>` with
-- 36-space `<li>`, the same shape as celebration.html.
--
-- Templates: a page in the same directory whose photo list is a plain
-- hardcoded list, so a generated event inherits that section's own chrome.
INSERT INTO gallery_categories
  (id, label, page_path, indent, close_indent, template_page, event_dir) VALUES
  ('noncurricular', 'Non-curricular activities', 'pages/curriculum/noncurricular.html',
   '                                    ', '                        ',
   'pages/events/rakhimaking.html', 'pages/events'),
  ('cultural', 'Cultural events', 'pages/curriculum/cultural.html',
   '                                    ', '                        ',
   'pages/events/noticedecoration.html', 'pages/events');
