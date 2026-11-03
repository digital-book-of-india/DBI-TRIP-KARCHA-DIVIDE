This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Backend authentication integration

Protected API routes accept only main-application HS256 access tokens. Configure
`JWT_SECRET` to the same secret used by the main application. Tokens must include
`typ: "access"`, a valid `sub`, and an unexpired `exp`; Trip Kharcha does not
issue or refresh tokens. The former `/api/auth/login` and `/api/auth/signup`
endpoints return `410 Gone` because authentication and registration are managed
by the main application.

Before deploying this integration, apply
[`prisma/migrations/20261103000000_main_app_identity_bridge/migration.sql`](./prisma/migrations/20261103000000_main_app_identity_bridge/migration.sql).
It only relaxes the `users.email` and `users.password_hash` nullability
constraints and adds `main_app_identities`; it does not alter or delete existing
records. A first-seen main-app subject receives a credential-free Trip Kharcha
profile whose ID is that subject. To preserve an existing profile and its trip
history, an administrator must link the subject before its first authenticated
request by inserting a row into `main_app_identities` with the verified main-app
subject and the existing `users.id`. The unique constraints prevent a subject
or profile from being linked more than once.

Do not link identities based only on email: the main-app access token does not
contain an email claim. Existing local password accounts are not automatically
matched or migrated.

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
