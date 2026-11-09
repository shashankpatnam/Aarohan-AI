# Aarohan AI Property Concierge frontend

## Frontend environment setup

The frontend reads its backend API base URL from `VITE_API_BASE_URL`. Copy the example file to a local environment file and adjust the URL if the backend runs elsewhere:

```powershell
Copy-Item .env.example .env
```

The example uses `http://localhost:5000/api`, matching the local backend's API prefix. The value should include the `/api` prefix; frontend service paths are appended to it. Vite loads this variable when starting or building the frontend, so restart the dev server after changing it.

Local `.env` files are ignored by Git. Keep secrets out of `VITE_*` variables because Vite exposes them to browser code; use this setting only for the public backend URL.

## Development

From this directory:

```powershell
npm install
npm run dev
```

Other available scripts are `npm test`, `npm run lint`, and `npm run build`.
