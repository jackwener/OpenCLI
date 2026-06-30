# Mercury

**Mode**: 🔐 Browser · **Domain**: `app.mercury.com`

Mercury reimbursements are authenticated browser UI flows. There is no public
API and no stable JSON endpoint for creating an expense, so the adapter drives
the visible Mercury reimbursements page through OpenCLI Browser Bridge. It
creates a **draft**, uploads a local receipt file, waits for Mercury OCR, then
re-applies the agent-provided fields because OCR can overwrite amount, currency,
date, or merchant.

The write command is deliberately conservative: it stops at Mercury's Review
step and never clicks the final `Submit expense` button. A human or responsible
agent must inspect the Review page before any final submission.

## Commands

| Command | Description |
|---------|-------------|
| `opencli mercury reimbursement-plan` | Validate a reimbursement payload locally without opening Mercury |
| `opencli mercury check-login` | Open Mercury reimbursements and report whether the selected browser profile is logged in |
| `opencli mercury reimbursement-draft` | Create a reimbursement draft, attach the receipt, correct OCR-overwritten fields, and stop at Review |

`reimbursement-plan` and `reimbursement-draft` take the same business payload:

| Flag | Meaning |
|------|---------|
| `--receipt` | Absolute or relative path to a local receipt/proof file |
| `--amount` | Original-currency positive amount, e.g. `140.00` |
| `--currency` | Original currency code, default `CNY` |
| `--date` | Expense date as `YYYY-MM-DD` |
| `--merchant` | Merchant name to show in Mercury |
| `--category` | Mercury expense category, default `Marketing & Advertising` |
| `--notes` | Business purpose / reimbursement notes |
| `--ocr-wait-seconds` | Seconds to wait after receipt upload before reapplying fields, default `8` |
| `--close-after-review` | Close Review after verification; still never submits |

## Agent Workflow

```bash
# 1. Confirm the selected browser profile is logged into Mercury
opencli --profile <profile> mercury check-login -f json

# 2. Validate the payload locally first
opencli mercury reimbursement-plan \
  --receipt /absolute/path/to/receipt.png \
  --amount 140.00 \
  --currency CNY \
  --date 2026-06-26 \
  --merchant "Example Merchant" \
  --category "Marketing & Advertising" \
  --notes "Example business purpose." \
  -f json

# 3. Create the draft and stop at Review
opencli --profile <profile> mercury reimbursement-draft \
  --receipt /absolute/path/to/receipt.png \
  --amount 140.00 \
  --currency CNY \
  --date 2026-06-26 \
  --merchant "Example Merchant" \
  --category "Marketing & Advertising" \
  --notes "Example business purpose." \
  -f json
```

## Expected Results

For `check-login`:

- `status: "ready"` means the profile reached Mercury reimbursements.
- `status: "needs_login"` means Mercury redirected to login; sign into Mercury
  in that Chrome/OpenCLI profile and rerun.

For `reimbursement-plan`:

- `status: "ready"` means the local receipt exists and amount/date formats are
  valid.
- Missing receipt files, non-positive amount strings, malformed currency codes,
  invalid calendar dates, or invalid wait/boolean flags fail before Mercury is
  opened.
- Output uses the receipt basename, not the absolute local path.

For `reimbursement-draft`:

- `uploaded: true`
- `reviewReady: true`
- `submitBlocked: true`
- `warnings` includes `final Submit expense was intentionally not clicked`
- Mercury shows the Review step with the expected receipt, amount, currency,
  date, merchant, category, and notes.

If upload confirmation, required field correction, or the Review postcondition
fails, the command throws a typed error instead of returning a partial success
row. Keep the browser open and inspect Mercury for validation errors.

## Testing

Run repository-level checks:

```bash
npm run dev -- validate mercury
npm run typecheck
npm run docs:build
```

Run a local input smoke test:

```bash
npm run dev -- mercury reimbursement-plan \
  --receipt /tmp/example-receipt.png \
  --amount 1.00 \
  --currency USD \
  --date 2026-06-30 \
  --merchant "OpenCLI Test Merchant" \
  --category "Office Supplies & Equipment" \
  --notes "OpenCLI adapter smoke test; do not submit." \
  -f json
```

Run a real UI smoke test only in a test Mercury workspace/profile or with a
harmless test receipt:

```bash
npm run dev -- --profile <profile> mercury reimbursement-draft \
  --receipt /absolute/path/to/test-receipt.png \
  --amount 1.00 \
  --currency USD \
  --date 2026-06-30 \
  --merchant "OpenCLI Test Merchant" \
  --category "Office Supplies & Equipment" \
  --notes "OpenCLI adapter smoke test; do not submit." \
  -f json
```

Pass condition: Mercury stops at Review and the returned row has
`submitBlocked: true`. Do not click final Submit during smoke tests.

## Notes

- **Login is required.** This adapter uses the selected OpenCLI browser profile;
  it does not store Mercury credentials or run an OAuth/login flow.
- **Receipt upload** targets Mercury's attachment input:
  `[data-testid="expense-attachment-upload"]`. If Mercury changes that selector,
  upload can fail while the rest of the form remains visible.
- **OCR happens before correction.** Mercury OCR can misread currency (for
  example `CNY` as `JPY`) or overwrite merchant/amount. The command uploads the
  receipt first, waits, then re-fills fields from the CLI arguments.
- **Review is not submission.** `reimbursement-draft` never presses the final
  `Submit expense` button. It prepares a draft for inspection.
- **Use original currency.** Enter the currency shown on the source receipt
  when Mercury supports it, then verify Mercury's converted reimbursement amount
  on the Review page.
- **Output is intentionally compact.** The returned row is a control-plane
  status summary; Mercury remains the source of truth for final visual review.

## Troubleshooting

- `needs_login`: open Mercury in the same Chrome/OpenCLI profile, finish login,
  then rerun `check-login`.
- Upload failure: verify the file exists locally and that Mercury still uses the
  receipt input selector above. The command requires Browser Bridge
  `uploadFiles` support so it can verify the intended file input.
- Review failure: inspect Mercury for validation errors; the command may have
  uploaded the receipt and filled fields but failed to reach Review.
- Category did not commit: custom Mercury dropdowns can be sensitive to UI
  changes. Retry with the exact category label visible in Mercury.
