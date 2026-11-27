# AP Studios website

Design and build renovation for BTOs and condos in Singapore.

- `index.html`: homepage with the 10-step customer journey
- `estimator.html` + `estimator.js`: the renovation estimator (PRD v0.17 rates and rules)
- `api/analyse-floorplan.js`: reads an uploaded floor plan (PDF or image) with the Claude API and returns the rooms
- `api/send-proposal.js`: rebuilds the proposal on the server from `estimator.js` and emails it via Resend to the customer, with a copy to AP Studios

Prices live only in `estimator.js`. The server runs the same file, so the emailed proposal always matches the rate card.

## Going live on Vercel

1. **Resend**: create an account, add your domain and add the DNS records Resend shows you. Wait until the domain shows as verified. Create an API key.
2. **Claude API**: create an API key at platform.claude.com and add billing.
3. **Vercel**: import this GitHub repository as a new project (no build settings needed).
4. In Vercel, go to Project > Settings > Environment Variables and add the four values listed in `.env.example`:
   - `ANTHROPIC_API_KEY`
   - `RESEND_API_KEY`
   - `PROPOSAL_FROM`, e.g. `AP Studios <proposals@yourdomain.sg>` (must be on the verified domain)
   - `PROPOSAL_CC`, your own inbox for the copy of every proposal
5. Redeploy, then test with your own email and a real floor plan.
6. Recommended: in Vercel, add a Firewall rate-limit rule for `/api/*`. The built-in limit is per server instance only.

## Tests

```bash
npm install
npm test
```

Tests fake the Claude and Resend calls, so they cost nothing and need no keys.

## Still to decide before launch

- GST treatment and validated rates (see PRD v0.15)
- Privacy notice covering floor plans and contact details sent to Anthropic and Resend (PDPA)
- Real contact details in the homepage footer
- Real testimonials to replace the sample cards
