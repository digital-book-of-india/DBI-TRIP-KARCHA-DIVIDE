This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Backend authentication integration

Registration and login are handled by the Common Workspace application. Open
Trip Kharcha from the signed-in workspace at `/trip-kharcha`; its frontend uses
the main application's authenticated API client and calls the Express gateway
under `/api/trip-kharcha/*`. The standalone Next.js page links back to Common
Workspace, and the former `/api/auth/login` and `/api/auth/signup` endpoints
remain retired with `410 Gone` responses.

The main backend exchanges the authenticated user's identity with
`/api/integration/identity`, then mints a five-minute Trip-scoped access token.
Trip Kharcha verifies that token using `TRIP_KHARCHA_INTEGRATION_SECRET`; it does
not accept the main app's ordinary access token directly. Keep the existing
`JWT_SECRET` values independent. Set the same random secret of at least 32 bytes
in `combined-app-main-project/backend/.env` and `apps/.env`, and set the main
backend's `TRIP_KHARCHA_API_URL` to the Trip Next.js origin (for local
development, `http://127.0.0.1:3001`). The main user also needs an active
`trip-kharcha-divide` project grant.

The identity bridge uses `main_app_identities` from
[`prisma/migrations/20261103000000_main_app_identity_bridge/migration.sql`](./prisma/migrations/20261103000000_main_app_identity_bridge/migration.sql).
It links a main-app subject to a matching case-insensitive email when exactly
one existing Trip profile matches, preserving that profile's trip history. A
new user receives a credential-free profile. Ambiguous or conflicting identity
matches are rejected instead of merging accounts.

Do not expose either backend secret to the browser or send access tokens through
URLs. Main-app tokens remain managed by the Common Workspace auth client; the
gateway performs the identity exchange and scoped-token minting server-side.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
