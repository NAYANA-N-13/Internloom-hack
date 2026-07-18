# InternLoom Talent Matching Backend - Design Decisions

## 1. Student Email Re-Verification Policy (Tricky Part 1)
- **Problem:** A student bypasses registration gates using an institutional domain (`.edu`/`.ac.in`) but later updates their email to a personal address (`gmail.com`) to avoid tracking or maintain unauthorized access.
- **Solution:** Our system implements an explicit state rollback rule. Whenever a `PUT`/`PATCH` request mutates the student's `email` field, the backend automatically flips `is_verified` back to `false` and invalidates any existing application permissions. The user's active session remains active so they aren't completely locked out, but they cannot submit new applications until a fresh 6-digit OTP verification lifecycle is successfully completed against the new institutional address.

## 2. Concurrency Control & Applicant Cap Limits (Tricky Part 2)
- **Problem:** Multiple students applying simultaneously via high-concurrency requests when an active job listing has exactly 1 open slot remaining.
- **Solution:** Because JavaScript executes on a single-threaded event loop, array mutations are inherently serialized sequentially. In our application submission controller, we perform a strict atomic validation gate: `if (job.current_applicants >= job.max_applicant_cap)`. If true, the request is immediately aborted with a `400 Bad Request` before any push mutations occur. This prevents over-allocation edge cases and ensures exactly one applicant succeeds while the rest fail gracefully without throwing a generic `500 Server Error`.

## 3. Live Listing Skill Modifications & Stale Match Scores (Tricky Part 3)
- **Problem:** A company updates the required skills of an active job listing that already has 15 applicants.
- **Solution:** Our system treats the match score as a purely **computed property at query time** rather than storing it statically in a column. When a company modifies a live listing's skills, the change is instant. The next time the matching engine runs or the company views applicants, the scores dynamically re-calculate against the updated requirements. Existing applications are preserved, but their match rankings will realign dynamically based on the new criteria, eliminating stale data.
