# Microcopy sheet — use verbatim

English only. No Hindi, no bilingual labels, no transliteration.
If a string you need is not here, write it in the same voice — short, literal, verb-first, no system
words — and add it to this sheet rather than inventing it inline.

**This sheet is now the record of what actually ships**, not only the design intent. It was
reconciled against the built console on 2026-09-05. Where the shipped wording differs from the
original design, the sheet has been corrected and the reason is listed under
[Changed since the design](#changed-since-the-design).

To check for drift after changing any string:

```bash
# Any user-facing string in the console that is not in this sheet.
grep -rhoE "textContent = '[^']{6,}'|label: '[^']{6,}'" admin/*.js \
  | sed -E "s/.*'([^']*)'.*/\1/" | sort -u \
  | while read -r s; do grep -qF "$s" design_handoff_admin_console/MICROCOPY.md || echo "MISSING: $s"; done
```

---

| Situation | Words to use | Never say |
|---|---|---|
| Sign-in heading | "Sign in to manage the school website" | "Admin login" |
| Wrong credentials | "Wrong username or password. Please try again." | "401 Unauthorized" |
| Rate-limited | "Too many tries. Please wait 15 minutes and try again." | "Rate limit exceeded" |
| Page list heading | "Choose a page to change its photos" | "Pages", "Slots" |
| Replace button | "Change this photo" | "Replace", "Upload" |
| Alt-text button | "Add a short description" — helper: "Describe what is in the photo. This helps blind visitors and Google." | "Alt text", "Accessibility" |
| Revert button | "Restore the original photo" | "Revert" |
| Remove button | "Remove this photo from the page" | "Delete slot" |
| Uploading | "Sending your photo… please do not close this page." | a bare "Uploading 40%" |
| Saved, not live | "Saved. This is not on the website yet." | "Draft", "Pending" |
| Status strip, pending | "3 pages changed. They are not on the website yet." · singular: "1 page changed. It is not on the website yet." | "3 dirty pages" |
| Status strip, clean | "Everything is on the website." | "No pending publishes" |
| Publish button | "Put my changes on the website" | "Publish", "Deploy" |
| Publish confirm | "These pages will change for everyone who visits the website: Home page, Our Founder. Do you want to continue?" | — |
| Publish success | "Done. Your changes will show on the website in a minute or two." | "Commit abc123 pushed" |
| Nothing to publish | "There is nothing new to put on the website." | "Nothing needed publishing" |
| File too big | "This photo is too large. Please choose a photo smaller than 3 MB." | "413 Payload Too Large" |
| Wrong file type | "This file is not a photo. Please choose a JPG, PNG or WEBP photo." | "Invalid MIME type" |
| Conflict (409) | "Somebody else changed this photo a moment ago. We have loaded their version. Please try again." | "409 Conflict / ETag mismatch" |
| Session expired | "You have been signed out for safety. Please sign in again." | "JWT expired" |
| Offline | "You are not connected to the internet. Your changes are safe. Please connect and try again." | "Network error" |
| Role: editor | "Can change photos" | "editor" |
| Role: owner | "Can change photos and manage people" | "owner" |
| Password rule | "Use at least 10 letters or numbers." | "Minimum length 10" |
| Activity row | "Sister Anita changed a photo on the Home page — today, 3:15 pm" | "slot.update index.img.1" |
| Sign out | "Sign out" | "Log out", "Exit session" |
| Header title | "Vimal Hriday School — website manager" · under 768px: "Website manager" | "Admin panel", "CMS" |

## Additional strings used in the design

| Situation | Words to use |
|---|---|
| Home heading | "What do you want to do?" |
| Home reassurance | "Nothing you do here shows on the website until you press the green button at the bottom." |
| Home tile 1 | "Change photos on a page" — "Open a page of the website and change any photo on it." |
| Home tile 2 | "Photo gallery" — "Add an event, change its photos, or take an event off the website." |
| Home tile 3 | "Change my password" — "Pick a new password for your own sign in." |
| Home tile 4 (owner) | "People who can sign in" — "See who may change the website, and remove anyone who should not." |
| Home tile 5 (owner) | "What changed recently" — "See the photos that were changed, and who changed them." |
| Signed-in line | "Signed in as Sister Anita" |
| Forgotten password | "If you have forgotten your password, please ask the Principal's office." |
| Back link | "← Back to what do you want to do" |
| Page row count | "6 photos can be changed" · singular: "1 photo can be changed" · "4 photos can be changed · 1 changed, not on the website yet" |
| Open a page | "Open this page" |
| Editor context bar | "You are changing photos on: Home page" |
| Leave the page | "Choose another page" |
| Editable photo caption | "This photo can be changed." / "This photo can be changed. Not changed yet." (hidden under 768px, where the photo is too small to sit a caption on) |
| Changed photo flag | "Changed · not on the website yet" |
| Saved flag | "Saved" |
| File limit, stated up front | "Choose a JPG, PNG or WEBP photo smaller than 3 MB." |
| Upload failed, reassurance | "The old photo is still there. Nothing has changed." |
| After a failed upload | "Choose another photo" / "Leave it as it is" |
| Restore modal | "Restore the original photo?" — "The photo you put here will be taken away. The photo that was on the website before will come back." — "No, keep my photo" / "Yes, restore the original photo" |
| Remove modal | "Remove this photo from the page?" — "This photo will not be on the page any more. You can put a photo here again later." — "No, keep it on the page" / "Yes, remove this photo" |
| Publish modal | "Put changes on the website?" — "These pages will change for everyone who visits the website:" — "Do you want to continue?" — "Not now" / "Yes, put them on the website" |
| Publish success body | "You do not need to do anything else. If you open the page and still see the old photo, wait a minute or two and refresh the page." |
| Publish success actions | "Open the school website" / "Change more photos" |
| Password fields | "My password now" / "My new password" / "Type my new password again" |
| Password actions | "Save my new password" / "Go back" |
| Password success | "Your new password is saved. Use it the next time you sign in." |
| Password wrong current | "That is not your password now. Please try again." |
| Password mismatch | "The two new passwords are not the same. Please type them again." |
| People heading | "People who can sign in" |
| People columns | "Name" / "What they can do" / "Last signed in" |
| Own row marker | "(you)" |
| Never signed in | "Has not signed in yet" |
| Remove person | "Remove" |
| Remove person modal | "Remove this person?" — "They will no longer be able to sign in." — "No, keep them" / "Yes, remove this person" |
| Last owner refused | "This person cannot be removed. They are the only one who can change photos and manage people." |
| How accounts are made | "New staff accounts are created by your developer on request." |
| Activity heading | "What changed recently" — "The last 50 changes. Newest first." |
| Activity, more | "Load more" |
| Loading | "Opening the page… please wait." |
| Empty activity | "No changes yet" — "When somebody changes a photo, it will be listed here." |
| Offline action | "Try again" |
| Session expired action | "Sign in again" |

## Activity sentences

Each row reads `<person> <phrase>` followed by `— <when>`. The page name is bold where one applies.

| Action | Phrase |
|---|---|
| Changed a photo | "changed a photo on the **Home page**" · no page: "changed a photo" |
| Restored a photo | "restored the original photo on **Home page**" · no page: "restored the original photo" |
| Removed a photo | "removed a photo from **Home page**" · no page: "removed a photo" |
| Uploaded a photo | "uploaded a new photo" |
| Published | "put changes on the website" |
| Signed in | "signed in" |
| Signed out | "signed out" |
| Changed own password | "changed their password" |
| Person added | "added **Sister Anita**" |
| Person removed | "removed **Sister Anita**" |
| Role changed | "changed what **Sister Anita** can do" |
| Password reset for someone | "reset the password for **Sister Anita**" |
| Anything else | "made a change to the website" |
| Unknown person | "a person" where a name is missing · "Someone" where the actor is missing |

## Photo gallery (phase 3)

The three parts of the gallery are fixed. They are never created, renamed or removed from the
console — only the events inside them are.

| Situation | Words to use |
|---|---|
| Gallery heading | "Photo gallery" |
| Choosing a part | "Choose a part of the gallery to change." |
| Inside a part | "Add an event, change its photos or its name, or take it off the website." |
| Part names | "Celebrations" / "Non-curricular activities" / "Cultural events" |
| Part count | "6 events, 2 not showing on the website" · all showing: "6 events" · singular: "1 event" · none: "No events yet." |
| Back links | "Back to the start" (from the gallery) / "Back to the gallery" (from an event) |
| Event row buttons | "Change photos" / "Change name" / "Remove" |
| Hidden event badge | "Not showing on the website" |
| Hidden event action | "Show on the website" |
| Event photo count | "15 photos" · singular: "1 photo" · none: "No photos yet." |
| Photos not editable here | "Photos set up by your developer" — for a page whose photos sit under headings the console cannot rebuild |
| Add an event | "Add an event" — "What is this event called?" — "The event starts hidden, so nobody sees it until you have added its photos." — "Cancel" / "Add this event" |
| Rename an event | "Change this name" — "What should this event be called?" — "Cancel" / "Save this name" |
| Remove an event | "Remove "Christmas Day (2024)"?" — offering two choices, then "Cancel" |
| — choice 1 | "Hide from the gallery" — "It stops showing in the gallery. You can bring it back here at any time." |
| — choice 2 | "Delete for good" — "The event and its page are removed from the website. This cannot be undone." |
| — choice 2, refused | "This event was part of the website before, so it cannot be deleted here. Hide it instead." |
| Event photos heading | "Event photos" |
| Add photos | "Add photos to this event" / "Add these photos" |
| Add photos limit | "You can add up to 25 photos at a time, and each one must be under 3 MB." — with "This event has room for 10 more." added once fewer than 25 remain |
| While adding | "Adding photo 3 of 12…" then "Almost done…" |
| Nothing chosen | "Please choose the photos you want to add." |
| Too many chosen | "You can add up to 25 photos at a time. You chose 40. Please add the first 25, then add the rest." |
| Remove a photo | "Remove this photo?" — "It will be taken off this event when you put your changes on the website." — "No, keep it" / "Yes, remove it" |
| Remove failed | "That photo could not be removed. Please try again." |
| Add failed | "Those photos could not be added. Please try again." |
| Event not found | "That event could not be found." |
| Cannot reach the site | "The website could not be reached. Please try again." |

## Messages the server sends

These reach the person unchanged, so they follow the same rules. No status codes, no field names.

| Situation | Words to use |
|---|---|
| Event name empty | "Please type a name for this event." |
| Event name too long | "That name is too long. Please use 120 letters or fewer." |
| Event name unusable | "Please use some letters or numbers in the name." |
| Event name taken | "There is already an event with that name. Please choose another." |
| Template unreadable | "The website template could not be read. Please tell your developer." |
| Cannot reach GitHub | "The website could not be reached. Please try again." |
| Delete refused, not ours | "This event page was part of the website before, so it cannot be deleted here. You can hide it instead, and it will no longer show in the gallery." |
| Photos vanished | "Some of those photos are no longer available. Please try again." |
| Last photo | "An event needs at least one photo. Please add another photo first, or hide the whole event." |
| No photos chosen | "Please choose at least one photo." |
| Batch too big | "You can add up to 25 photos at a time. Please add the first 25, then add the rest." |
| Event full | "This event already has the most photos we allow (150). Please remove a few before adding more." |
| Not enough room | "This event has room for 5 more photos. Please choose 5 or fewer." · singular: "room for 1 more photo" |
| Part full | "This part of the gallery already has 100 events, which is the most we allow. Please remove one before adding another." |
| Photos not editable here | "The photos on this event's page are arranged in a special way, so they cannot be changed here. Please ask your developer." |

## Friendly page names

| File path | Show as |
|---|---|
| `index.html` | Home page |
| `pages/about/OurManagement.html` | Our Management |
| `pages/about/OurFounder.html` | Our Founder |
| `pages/about/PrincipalMessage.html` | Principal's Message |
| `pages/about/FIH.html` | FIH Congregation |
| `pages/events/celebration.html` | Celebrations |
| `pages/curriculum/noncurricular.html` | Non-curricular activities |
| `pages/curriculum/cultural.html` | Cultural events |

## Changed since the design

Each of these differs from the original sheet. Listed so nobody has to diff the code to find out
what the console really says.

| Entry | Was | Now | Why |
|---|---|---|---|
| Publish success | "…in about a minute." | "…in a minute or two." | Measured 2 min 3 s from pressing publish to the page updating: the Worker commits, then the host rebuilds the whole site. "About a minute" sent someone to check too early and conclude it was broken. |
| Publish success body | "…wait a minute and refresh…" | "…wait a minute or two and refresh…" | Same reason. |
| Home tile, people | "Add or remove the people who may change the website." | "See who may change the website, and remove anyone who should not." | Adding people was removed from the console; accounts are created from the backend on request. The old wording promised something the screen no longer does. |
| Home tiles | 4 tiles | 5 tiles | "Photo gallery" was added as tile 2. |
| Status strip, pending | plural only | plural and singular given | "1 pages changed" was wrong. |
| Page row count | plural only | plural and singular given | Same. |
| Editable photo caption | no breakpoint note | hidden under 768px | At 390px the photo is about 109px wide and the caption pill was about 230px, covering the subject's face. |

### Removed from the console

The "Add a person" flow is **gone** and its strings are no longer used anywhere. Kept here only so
a reader does not go looking for them:

| Situation | Was |
|---|---|
| Add person heading | "Add a person" |
| Add person fields | "Their name" / "Username they will type" / "What they can do" |
| Add person action | "Add this person" — "A first password will be shown once. Write it down and give it to them." |

`POST /v1/users` returns 404, and new accounts are provisioned with
`tools/bin/create-user.mjs`. The console says so with "New staff accounts are created by your
developer on request."
