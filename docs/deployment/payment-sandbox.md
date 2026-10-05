# NOWPayments sandbox verification

Provider testing is separate from the local regression tests. Do not simulate
settlement against CoinSecret production or reuse its database or API keys.

1. Create and sign in to a separate [NOWPayments sandbox account](https://account-sandbox.nowpayments.io/).
   The account owner must complete password entry and the service agreement.
2. Start a local PostgreSQL server and create `coinsecret_sandbox` or
   `coinsecret_test`. Keep it on loopback. Use a separate development checkout.
   The payment factory rejects sandbox with `NODE_ENV=production`, a remote
   database, or a database name without either suffix.
3. Configure that checkout's ignored environment file:

   ```dotenv
   NODE_ENV=development
   DATABASE_URL=postgresql://YOUR_LOCAL_USER:YOUR_LOCAL_PASSWORD@127.0.0.1:5433/coinsecret_sandbox
   PAYMENT_PROVIDER=nowpayments-sandbox
   NOWPAYMENTS_SANDBOX_API_KEY=YOUR_SANDBOX_KEY
   NOWPAYMENTS_SANDBOX_IPN_SECRET=YOUR_SANDBOX_IPN_SECRET
   BETTER_AUTH_URL=YOUR_ISOLATED_TEST_ORIGIN
   ```

   Configure a fresh authentication secret and a test email sender separately.
   Never commit keys. The test origin must be reachable by NOWPayments for IPN;
   review exposure before opening a temporary tunnel. The callback is
   `/api/billing/webhook/nowpayments-sandbox`.
4. Run `npm run db:deploy`, `npm run check`, then `npm run dev` **in that isolated
   checkout**. Do not run the seeder against production. Register a test user,
   verify its email, and explicitly sign in. Confirm its initial effective plan
   is Free before starting checkout from Pricing.
5. Check the hosted sandbox invoice and its actual payment ID in the provider
   account. An invoice ID is not a payment ID. Exercise the documented payment
   cases `success`, `common`, `failed`, and `partially_paid` where supported.
   No real funds should be sent. Record provider responses and callback times
   with credentials/signatures removed.
6. Confirm pending/confirmed/underpaid states do not activate Pro. Only a
   provider-verified `finished` payment grants its stored number of days.
   Replay the same signed callback and confirm the expiry does not extend.
   Wrong signatures, amounts, currencies and order IDs must be rejected.
   Check expiry and refunds using disposable test data, retaining a newer paid
   period. Partial refunds remain flagged for review; they must not cancel
   unrelated purchases or prevent a later full refund.
7. Check the admin Payments status lookup with the actual provider payment ID.
   A timeout remains uncertain and cannot create another invoice automatically.
   Do not declare an old production invoice unpaid based only on its age.

The [official sandbox documentation](https://documenter.getpostman.com/view/7907941/T1LSCRHC?version=latest)
states that the sandbox has not been maintained since 2025 and compatibility
with production is not guaranteed. A sandbox pass is therefore evidence of
that test flow, not proof of every production payment path. If the provider's
account, CAPTCHA or simulation endpoint fails, record it as blocked rather than
substituting a fabricated successful payment.
