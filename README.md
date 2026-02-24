# BoringCourse

BoringCourse is an AI school helper built with Next.js. It integrates with Canvas and GPT-5-class models to generate study plans, tutoring help, flashcards, quizzes, and subject focus recommendations.

## Setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

## Environment variables

- `OPENAI_API_KEY`: required for AI endpoints.
- `OPENAI_MODEL`: defaults to `gpt-5-mini`.
- `CANVAS_BASE_URL`: optional default Canvas base URL (e.g. `https://school.instructure.com`).
- `CANVAS_API_TOKEN`: optional default Canvas API token.
- `AUTH_ENCRYPTION_KEY`: required for encrypted login session cookie (`bc_auth`).
  - Provide as one of:
  - 32-character plain string
  - 64-character hex
  - base64 that decodes to 32 bytes

You can also pass Canvas credentials per request using headers:
- `x-canvas-base-url`
- `x-canvas-token`

## Backend endpoints

### Canvas integration

- `GET /api/canvas/courses?search=`
  - Fetches courses and current scores/grades.
- `GET /api/canvas/courses/:courseId/assignments`
  - Fetches assignments, scores, and concept hints inferred from assignment titles.
- `GET /api/canvas/overview?search=`
  - Aggregates courses + assignments and returns:
  - grade signals
  - focus recommendations
  - assignment summary

### Focus engine

- `POST /api/insights/focus`
  - Input: courses and assignments
  - Output: prioritized focus recommendations by subject, concept, and suggested study minutes.

### AI generation (GPT-5 API)

- `POST /api/ai/study-guide`
  - Generates an outlined weekly study plan and priorities.
- `POST /api/ai/flashcards`
  - Generates flashcards from uploaded/course content.
- `POST /api/ai/quiz`
  - Generates multiple-choice quiz sets.
- `POST /api/ai/tutor`
  - Dedicated tutoring response with next steps and focus advice.

### File upload

- `POST /api/upload/parse` (`multipart/form-data`)
  - Field `file`: supports `txt`, `pdf`, `docx`
  - Optional field `assignmentTitle`: used to infer a concept hint
  - Returns extracted text, preview, and word count

### Auth and legal

- `POST /api/auth/login`
  - Requires `email`, `password`, and `agreeToLegal: true`.
  - Sets encrypted HttpOnly session cookie.
- `POST /api/auth/logout`
  - Clears auth session cookie.
- `GET /api/auth/me`
  - Returns authenticated user info.
- `/login`
  - Login page with mandatory checkbox agreement.
- `/legal`, `/legal/terms-of-service`, `/legal/legal-terms`, `/legal/privacy-policy`
  - Legal placeholder pages to fill with full policy text.

## Notes

- The app currently ships a styled frontend dashboard and fully wired backend APIs.
- Next step is connecting the frontend controls to these endpoints and adding auth/session storage.
