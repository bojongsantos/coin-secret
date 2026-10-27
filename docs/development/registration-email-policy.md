# Registration and access periods

New email registrations receive 14 days of Pro from their original account creation time. Verification is required before login. Login, verification retry, and password recovery do not restart the period. Existing trial, paid, or manual periods retain their stored dates.

Admin → Users shows the actual start/end dates, browser timezone, email verification, and known domain risk. Select PREMIUM before editing a Free user's expiry. Saving an expiry is an audited manual grant; an empty expiry deliberately means unlimited access. Expiry is enforced by server entitlements, not only the displayed date.

Registration rejects reserved example/special-use domains and known disposable domains before creating an account, trial, or verification email. Other domains need MX records, or SMTP's implicit A/AAAA fallback; null MX and nonexistent domains are rejected. Transient DNS errors fail temporarily, with a four-second deadline and no account creation. Existing account login/recovery remain available; old accounts are flagged for review, not automatically deleted.

`src/config/disposable-email-domains.json` is a pinned data snapshot from https://github.com/disposable-email-domains/disposable-email-domains, commit `e4f0910adf5ab418dc998a1d8e6c15906ca04864`, retrieved 27 October 2026 (9,927 domains). Its license is retained beside the JSON. It is read on the server, with no third-party validation API call or new package dependency. To refresh, download the upstream list/license at a reviewed commit, normalize and deduplicate DNS labels, check common permanent providers are not blocked, and run the policy tests and full check.

`example.com` is reserved; `maxxspace.com` appears in the upstream list. `tm.id` is not on that list and must not be called disposable solely because its name is unfamiliar. DNS deliverability checks and email verification still apply. A blocklist and OTP do not guarantee one human per trial: abuse through multiple permanent inboxes remains possible. Registration is also limited to five attempts per ten minutes per IP.
