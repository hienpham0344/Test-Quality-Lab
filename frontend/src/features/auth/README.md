# Authentication

- `/login` signs in through `POST /api/v1/auth/login`.
- `/signup` sends `confirm_password` and an optional `display_name`, then prompts for email verification.
- `/verify-email` consumes the one-time email link; `/resend-verification` requests a replacement.
- `/forgot-password` requests a reset link and shows the same confirmation for every eligible email format.
- `/reset-password` consumes the fragment token and submits the new password.

Verification and reset clear the token from browser history before making a request.
The sign-in access token lives in React state for the current page lifetime.
The app does not persist or log it. Reloading requires signing in again.

`/projects` requires a session and uses the owner-scoped project API. Signed-out
visitors go to `/login` and return to the projects route after signing in.
The project list revalidates when the tab regains focus and every minute while
it is visible. A 401 clears the session and shows a sign-in prompt. Other errors
show retry guidance. Private project data leaves the view during sign-out and
is not retained once the project view unmounts.

Sign-out calls the backend to revoke the session, then clears local state.
If the backend is unavailable, the browser still clears the session and the
sign-in screen explains that server revocation could not be confirmed.
This flow currently asks users to sign in again on expiry. The API contract describes
rotating the token pair with `POST /api/v1/auth/refresh` and retrying once.
See [the auth API contract](../../../../docs/api/contracts/auth.md) for the session
and account endpoints and error codes.

For a live smoke test, start the API, worker and Mailpit, register a test address,
then open the verification/reset links from Mailpit. Automated frontend tests
mock the API and can run without the backend.
