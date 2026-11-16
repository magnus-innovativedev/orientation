# Magnus Admission Counselling App

Flask + SQLite backend, React front end (no build step). Mirrors the PPT as one guided flow.

## Run
    pip install -r requirements.txt
    export ADMIN_PIN=your-pin        (Windows: set ADMIN_PIN=your-pin)
    python main.py      -> http://localhost:5000      leads: http://localhost:5000/admin

## Workflow
1 Welcome (register visitor) -> 2 Campus tour (all four classrooms are shown together) -> 3 Course -> 4 Career
-> 5 Fees & terms (compare, choose course, payment, terms + cheques, skill loan, documents)
-> 6 Booking (photo, amount, batch) -> printable summary.
Progress saves after every step; a visitor returning on the same device resumes where they stopped.
Informational slides require a slide-specific acknowledgment before moving forward; Other Terms uses its terms-consent checkbox instead. Acknowledgments are saved with visitor progress.
Continue is blocked until: registered, course chosen, payment chosen, terms accepted, booking amount chosen.
Interactive buttons and controls play a subtle click sound when browser audio is enabled.
Completing the final step plays a short success chime.
On Batch Assignment, tap Student photo or Capture photo to open the camera when permitted; Upload photo
opens the file picker. The camera requests 4:3 and
4000 x 3000 capture, saves a high-quality JPEG with automatic orientation, and requests auto flash
when the device supports it. The actual resolution depends on the camera; photo upload remains available.

## Adding photos and videos
Tap the lock icon (top right) or a media slot's "Sign in to upload" button and enter ADMIN_PIN.
Every "coming soon" slot then shows an Upload button labelled with its slot key (e.g. classrooms-1,
jobs-0). Photo slots accept jpg/jpeg/png/webp/gif; video slots accept mp4/webm/mov. Files land in
static/media/<slot>.<ext>; you can also copy files there by hand. In Counsellor mode, use the × button
on a filled slot to remove its uploaded media. Tap a photo, video, or brand logo to open it in a
same-window popup. Videos play with controls in the popup. Close it with ×, Escape
or by clicking outside the viewer.

## Changing numbers
Fees, EMI, stipend, service-centre totals and area counts, cheque, loan terms, documents and the next batch date live in CONFIG in main.py
(or override any key in a config.json beside it). The UI hard-codes none of them.
The sample service-centre distributions are illustrative estimates, not verified centre records. Kerala districts are split into six city markers plus an "Other areas" bucket; the 700 outside Kerala are distributed across selected major cities.

## Files
main.py                 routes, SQLite, config, admin API
templates/index.html    app shell            templates/admin.html   lead list + CSV export
static/js/App.jsx       slides-as-data + every screen
static/css/style.css    your original theme  static/css/flow.css    styles for the new screens
data/                   created at runtime: magnus.db, visitor photos (admin-only access)
