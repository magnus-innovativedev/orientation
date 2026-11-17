# Magnus Admission Counselling App

Flask + SQLite backend, React front end (no build step). Mirrors the PPT as one guided flow.

## Run
    pip install -r requirements.txt
    $env:DEVELOPER_EMAIL="developer@example.com"
    $env:DEVELOPER_PASSWORD="a-long-temporary-password"
    $env:DEVELOPER_NAME="Magnus Developer"
    python bootstrap_users.py
    python main.py      -> http://localhost:5000      management: http://localhost:5000/admin

The initial Developer account is created only when `DEVELOPER_EMAIL` and
`DEVELOPER_PASSWORD` are supplied. The app persists a signing key under `data/` when
`FLASK_SECRET_KEY` is not configured; deployments should set a strong,
persistent `FLASK_SECRET_KEY` and `SESSION_COOKIE_SECURE=true` when served
over HTTPS. The old shared `ADMIN_PIN` login is no longer accepted.
The counselling portal requires an assigned email and password before showing
visitor details. Passwords must be non-empty and cannot exceed bcrypt's
72-byte limit; accounts are not forced to change passwords at first sign-in.

## Users, branches and permissions
The first startup applies the SQLite migration and seeds the 17 branches, four
roles, permission catalog, and default role-permission matrix. Sign in as a
Developer and open **Manage** (or `/admin`) to add users and create one active
Branch Manager per branch. Active Branch Managers are unique per branch.
Reception, SCM, and HOD are scoped staff types rather than additional
permission roles. Admins and Developers can manage all branches; Branch
Managers are limited to their assigned branch and allowed staff types.

The management page provides user filters and actions, a **Roles & permissions**
editor, user-specific allow/deny overrides with reasons, and an audit log.
User changes use soft removal; passwords are bcrypt-hashed. Visitor, user, media, role, and recording access
is enforced by the API, not only by the UI. Recording playback and permission
changes are logged.

## Reports
The management page opens on a **Reports** tab (cream, espresso and teal theme, Lora type) fed by
`GET /api/admin/report`. Developers see data checks, field completeness and all records, and can switch to the
Admin view; Admins and other all-branch users see every branch; branch-scoped users see only their own branch.
Phone numbers are never sent to the report. Branch-scoped users see booked visitors in the report as counts and
amounts, although the Visitors list still shows them unfinished visitors only. Developers can open Reports even
without visitor permissions. Styles: `static/css/admin.css`, `static/css/reports.css`; code: `static/js/reports.js`.
The counselling flow keeps its existing dark blue theme.

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

## Audio recordings
Before visitor details are shown, the visitor must consent and allow microphone access. Recording continues
across the counselling steps and stops when the booking is submitted. Audio is queued in 10-second chunks
in the browser and uploaded to private server storage; queued chunks retry when connectivity returns.
An unfinished recording can be resumed from the same browser and continues under the same visitor session.
Completed recordings are downloadable from the counsellor-only admin leads page. Files are stored outside
`static/` and are removed after 90 days by default. Set `audio_retention_days` in `config.json` or override
it with the `AUDIO_RETENTION_DAYS` environment variable. Microphone access requires HTTPS or localhost;
browser or operating-system policies may interrupt capture when a device is locked, in which case the flow
shows a microphone error and requires recording to resume before it can continue.

## Adding photos and videos
Sign in using an assigned account with `media.upload_image` or `media.upload_video`.
Every "coming soon" slot then shows an Upload button labelled with its slot key (e.g. classrooms-1,
jobs-0). Photo slots accept jpg/jpeg/png/webp/gif; video slots accept mp4/webm/mov. Uploads are
type-checked and stored outside the static web root in `data/media/`; media is served through a
Flask route. In Counsellor mode, use the × button on a filled slot to remove its uploaded media.
Tap a photo, video, or brand logo to open it in a same-window popup. Videos play with controls in
the popup. Close it with ×, Escape or by clicking outside the viewer.

## Changing numbers
Fees, EMI, stipend, service-centre totals and area counts, cheque, loan terms, documents and the next batch date live in CONFIG in main.py
(or override any key in a config.json beside it). The UI hard-codes none of them.
The sample service-centre distributions are illustrative estimates, not verified centre records. Kerala districts are split into six city markers plus an "Other areas" bucket; the 700 outside Kerala are distributed across selected major cities.

## Files
main.py                 routes, SQLite, config, auth and permission APIs
migrations/             versioned SQLite schema migrations
bootstrap_users.py      create the first Developer account
templates/index.html    app shell            templates/admin.html   users, roles and visitor management
static/js/App.jsx       slides-as-data + every screen
static/css/style.css    your original theme  static/css/flow.css    styles for the new screens
data/                   created at runtime: database, private photos/recordings, media and session key
