# Claude collaborator access

Claude is a full GitHub collaborator. That grants source-control access, not
production credentials. Keep this distinction: Portfolio Manager has a real
broker-adjacent execution path, so a collaborator may build and review without
being able to approve, sign, execute, deploy, or mutate financial records.

## Access model

| Resource | Claude access | Reason |
| --- | --- | --- |
| GitHub repositories | Existing collaborator access | Build, review, branches, pull requests |
| Production Redis audit/proposal keys | Read-only ACL token | Analyze proposals and audit history |
| Google Sheet | Viewer | Reconcile Trade Ledger and Lots |
| Jetson logs | Read-only, if later needed | Diagnose runtime behavior |
| Robinhood, HMAC secrets, Vercel/Fly deploy credentials, Sheets editor access | Never provide | Preserve the approval and execution boundary |

## Provisioning checklist for Sam

1. Run Claude in an isolated macOS account, VM, or remote workspace. Do not let
   that workspace read this checkout's `.env`, SSH keys, or macOS keychain.
2. In Upstash, create an ACL user limited to read commands and these key
   patterns: `pm:research-decision-audit:*`, `pm:approval_proposals`,
   `pm:approval_proposal:*`, and `pm:audit:*`. Generate a REST token for that
   ACL user. A database-wide Upstash Read-Only Token is an acceptable temporary
   alternative, but it can read more than this review scope.
3. Place only the URL and ACL REST token in Claude's isolated environment as
   `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`. Never commit them.
4. Share the production Google Sheet with Claude's dedicated Google account as
   **Viewer**.
5. Confirm the credential can read a known proposal/history key and rejects a
   write. Also confirm Claude cannot read the production `.env` files.

Upstash ACLs are available on paid databases. Use its console or an approved
administrator workflow to create the user and REST token; do not run ACL
commands from a Claude session.

## Immediate safe review packet

Until the ACL environment is ready, an owner can generate a redacted packet for
Claude. It contains proposal state, research/evaluator evidence, and a bounded
activity timeline. It excludes credentials, HMACs, user IDs/emails, audit
metadata, and broker order IDs. Correlation references are one-way hashes only
within the packet.

```bash
cd "/Users/samhuffard/All Claude Projects/portfolio-manager"
npm run proposals:audit:export -- --out=/private/tmp/proposal-audit-review.json --research=500 --audit-days=30
```

The command refuses to overwrite an existing file. Review the file before
sharing it and copy it only into Claude's isolated workspace.

## Claude operating instructions

Claude may inspect, analyze, test, and prepare a branch or pull request. Claude
must not issue broker commands; approve/sign/retry a proposal; write Redis or
Sheets; or deploy/restart services without Sam's explicit direction.
