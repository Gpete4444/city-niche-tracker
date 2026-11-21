# Rover accounts

Rover on a customer install asks for an email and a password. The weekly plan is **Full** or **Maintain**. This development checkout does not ask you to sign in and does not lock the pipeline.

## Where things live

The account service is one Cloudflare Worker and one D1 database. Every person is a row: email, password hash, plan, paid-through date, and one computer id. It does not store API keys.

API keys, the lead notify address, and the sites folder stay on that computer. Account setup in Rover is the page that edits them. A missing key on a step opens that row.

## Deploy the account service

From `ops/account-worker`:

1. `npx wrangler d1 create rover-account`
2. Put the database id into `wrangler.json`.
3. `npx wrangler d1 execute rover-account --file=schema.sql`
4. Set secrets: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_FULL`, `STRIPE_PRICE_MAINTAIN`, `MAIL_FROM`, and `ADMIN_EMAILS` (your email, comma-separated if more than one).
5. `npx wrangler deploy`
6. Point the Stripe webhook at `https://<worker>/stripe/webhook`.
7. On a customer install, set `ROVER_ACCOUNT_URL` to that worker origin.

Signup mail uses the Worker email binding or `RESEND_API_KEY`. Until mail is configured, the worker refuses signup rather than skipping confirmation.

Your admin email is not a built-in username. When you deploy, put your email in `ADMIN_EMAILS`, then create the account with the password you choose. That login is Full and Maintain with no charge and no one-computer limit. The signup form cannot mark anyone else as admin.

Prices can be Stripe test-mode placeholders until you charge real cards.

## This checkout

`npm run rover` in this repo keeps using `.env`, `research/`, and the current sites folder. Account setup is in the gear menu. Saving there is optional. Checking out `master` leaves those folders where they are.
