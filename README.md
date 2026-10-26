# Magic Hour media jobs in Cloudflare Workflows

Generate one image or a five-second video, or resume an already accepted Magic Hour project. The workflow stores the project ID as a step result, polls its status with durable sleeps, and returns temporary download links. It uses native `fetch` and needs no MCP proxy, additional database, R2 bucket, or model-provider key.

This is a Magic Hour-maintained example, not an accepted Cloudflare template. Normal installation, stock Local Explorer, native GET-only existing-image recovery, and deliberate image/video creation passed with Wrangler 4.153.0. The image charged 5 credits and its usable 640 × 640 PNG was downloaded, fully decoded and visually reviewed. The five-second video charged 120 credits; its downloaded H.264 MP4 passed full decoding and a three-frame visual check. Automatic local restart recovery and cloud deployment are not verified.

## Local setup

Requires Node.js 22+ and npm. Node.js 24 is suitable. The committed lockfile retains the native-verified dependency closure for Wrangler 4.153.0. Installation uses its normal native dependencies and lifecycle scripts.

```sh
npm ci
```

Keep your Magic Hour API key in a private `.dev.vars` file beside `wrangler.jsonc`, using Cloudflare's normal local secret mechanism. Create it with restrictive permissions, then populate it through your secret manager or a private editor. Never put the key in workflow parameters, shell arguments, screenshots, source, or logs.

```sh
umask 077
touch .dev.vars
chmod 600 .dev.vars
```

Private file format, with a placeholder rather than a real key:

```dotenv
MAGIC_HOUR_API_KEY="<your-key>"
```

The ignore rules exclude this file, `.env` files, and Wrangler's local state. Do not commit or share `.wrangler`: it can contain prompts, project IDs, and temporary download URLs. Use either `.dev.vars` or `.env`, not both.

Alternatively, a secret manager can provide `MAGIC_HOUR_API_KEY` directly in the Wrangler process environment. The declared `secrets.required` binding loads it without putting the value in arguments or event JSON. This route does not require a `.dev.vars` file.

After supplying the private secret:

```sh
npm run dev
```

Open `http://127.0.0.1:18787/cdn-cgi/local/explorer` in a sandboxed browser and select the `magic-hour-media` workflow. Local Explorer is a local development control plane, not a public application. Keep the dev server bound to loopback and do not expose it through a tunnel. A Cloudflare account is not required for this local session.

## Recover an accepted project first

Trigger a workflow in Local Explorer with a fresh workflow instance ID and this payload, replacing the placeholder with an image project you own:

```json
{"operation":"recover","media":"image","projectId":"<accepted-image-project-id>"}
```

You can also use Wrangler's normal local management command in a second terminal while the dev server stays running. Replace the project placeholder and choose a new workflow instance ID:

```sh
npx wrangler workflows trigger magic-hour-media '{"operation":"recover","media":"image","projectId":"<accepted-image-project-id>"}' --id mug-image-recovery-001 --local --port 18787 --json
```

The payload is a positional JSON argument, not a `--params` option. The trigger command returns the workflow instance ID. Inspect that same instance without triggering it again:

```sh
npx wrangler workflows instances describe magic-hour-media mug-image-recovery-001 --local --port 18787 --json
```

The JSON result can include private download URLs. Keep it out of public logs and screenshots. Use Local Explorer to inspect the status and steps without sharing the raw output.

For an existing video, use `"media":"video"` and its accepted video project ID. Recovery calls only `GET /v1/image-projects/{id}` or `GET /v1/video-projects/{id}`; it does not submit another generation. Inspect `accepted-project`, each `status-*` step, and the workflow result in Local Explorer.

The loop makes at most 120 status observations, with 15-second durable sleeps between incomplete results. A GET step can retry three times for network failures, HTTP 429, or 5xx responses. Other HTTP errors stop immediately. Each HTTP attempt has a 30-second deadline. If polling ends, retain the accepted ID and start a separate recovery instance. This does not cancel the media job.

The result contains `projectId`, `media`, `status`, `credits_charged`, and `downloads` with `url` and `expires_at`. Download the media before the URLs expire. This example returns metadata and does not download or store media bytes. Reusing cached workflow results does not refresh expired URLs; start a new accepted-ID recovery instance to request current details.

## Create an image or video deliberately

Creation spends Magic Hour credits. Review current pricing and the intended prompt before triggering either payload.

Image: one square 640px image using `z-image-turbo`:

```json
{"operation":"create","media":"image","prompt":"A blue ceramic mug on a sunlit kitchen counter, product photograph."}
```

Video: a five-second 480p 16:9 clip using `ltx-2.5`, without audio:

```json
{"operation":"create","media":"video","prompt":"A slow camera orbit around a blue ceramic mug on a sunlit kitchen counter."}
```

These use `POST /v1/ai-image-generator` and `POST /v1/text-to-video`. The returned ID is checkpointed in `create-project-no-retries` before polling begins. Model access and prices depend on the account. Adapt model, resolution, or duration only against the current API documentation.

### Paid submission is not exactly once

The POST step explicitly sets `retries.limit: 0`. The code has no fetch retry loop. However, Magic Hour can accept a request before its response reaches the workflow, or the process can fail after acceptance but before Cloudflare checkpoints the returned ID. Disabling retries cannot close that acceptance/checkpoint window.

If the create step times out, loses its response, or fails around checkpointing, do not restart, retry, or duplicate that create workflow. Reconcile the request in your Magic Hour account first. If it was accepted, use its project ID in a separate `recover` instance. This example does not assert an API idempotency guarantee. Keep the local dev server running while work is active. Persisted local history does not establish that interrupted work automatically resumes after a dev-server restart. A manual restart can rerun a create step, so never use it to recover an accepted media job. Use a separate GET-only recovery instance instead. Cloud deployment and production restart durability remain unverified.

## Management, privacy, and deployment

The default HTTP handler always returns 404 and cannot start paid work. `workers.dev` and preview URLs are disabled. No public paid-trigger route, schedule, or automatic creation is configured. Production invocation would use the authenticated Cloudflare dashboard/API or a separately secured service binding. Cloud deployment is outside this example's verified scope.

Workflow history and output can reveal prompts, project IDs, and temporary download links. Restrict control-plane access and follow your retention policy. Secrets are read from `env`, never workflow event JSON. Local development sends the chosen prompt to Magic Hour only when you explicitly run `create`.

## References

- [Magic Hour image creation](https://docs.magichour.ai/api-reference/image-projects/ai-image-generator)
- [Magic Hour text-to-video](https://docs.magichour.ai/api-reference/video-projects/text-to-video)
- [Magic Hour API pricing](https://docs.magichour.ai/billing/overview)
- [Workflows local development and Local Explorer](https://developers.cloudflare.com/workflows/build/local-development/)
- [Workflows steps and retry configuration](https://developers.cloudflare.com/workflows/build/workers-api/)
- [Workflow idempotency and side effects](https://developers.cloudflare.com/workflows/build/rules-of-workflows/)
- [Private local secrets](https://developers.cloudflare.com/workers/configuration/secrets/)

## Verified scope

The native local workflow and normal CLI/UI completed an existing-image recovery without a new generation. A separate deliberate image creation completed in 27.6 seconds and charged 5 Magic Hour credits. Its downloaded product photograph was a usable cobalt water bottle, 640 × 640 pixels and 455,372 bytes. Full media decoding and visual inspection passed. The PNG SHA256 is `3c6fe482c730331766a97616c5ab9b031e47115bb4d16a0d5854238127585694`. These are measured results for one job, not guaranteed timing, dimensions or pricing.

A separate native five-second video creation completed in 27.41 seconds and charged 120 Magic Hour credits. Its normal CLI and Local Explorer showed the exact accepted project complete. The downloaded H.264 MP4 was 854 × 480 pixels, 601,823 bytes and 5.041667 seconds long, with no audio stream. Full-file decoding passed, and three sampled frames showed a consistent cobalt product scene. This sample-frame inspection does not establish full motion quality. The MP4 SHA256 is `da2568384341609fc6607b5f51090ce70571cbdd0bad41bf82d3579239c5b8b5`. This local validation does not establish Cloudflare production deployment, automatic dev-server restart recovery, or upstream template acceptance.
