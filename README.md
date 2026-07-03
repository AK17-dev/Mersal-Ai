# Mersal (مرسال)

A bilingual (Arabic/English) document Q&A platform built on the Cloudflare Developer Platform (Hono Workers + D1 + R2 + Vectorize + Workers AI).

## Local Development & Vectorize Binding

Cloudflare's local Worker emulator (Miniflare/Wrangler) does not emulate Vectorize bindings locally with metadata filtering in the current environment runtime. Therefore, local development requires binding to your remote production Vectorize index.

### Setup Steps

1. **Log in to Cloudflare**:
   ```bash
   npx wrangler login
   ```

2. **Create the Vectorize Index**:
   ```bash
   npx wrangler vectorize create mersal-vectors --dimensions=1024 --metric=cosine
   ```

3. **Register the Metadata Index**:
   To enable document isolation and filtering by `session_id`, you must register the metadata index *before* uploading any documents:
   ```bash
   npx wrangler vectorize create-metadata-index mersal-vectors --property-name=session_id --type=string
   ```

4. **Apply Local Database Migrations**:
   ```bash
   npm run db:migrate:local --workspace=api
   ```

5. **Start Development Stack**:
   Run the dev server, which will launch both Vite and the Worker. The Worker starts with the `--experimental-vectorize-bind-to-prod` flag enabled so it communicates with the remote Vectorize index:
   ```bash
   npm run dev
   ```
