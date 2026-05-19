# Frontend README

React + TypeScript interface for the timetable scheduling prototype.

## Setup

For normal Windows use, prefer the repo-level launcher:

```powershell
cd ..
powershell -NoProfile -ExecutionPolicy Bypass -File .\quicklaunch.ps1
```

Manual frontend-only setup:

```powershell
npm install
npm run dev
```

The app runs on http://localhost:5173.

## Configuration

By default, the frontend calls same-origin `/api` routes and Vite proxies them to:

```text
http://localhost:8000
```

Set `VITE_PROXY_TARGET` when the backend uses a different local port:

```powershell
$env:VITE_PROXY_TARGET="http://localhost:8001"
npm run dev
```

Set `VITE_API_URL` only when you want the browser to call a backend URL directly.

## Pages

- Dashboard: imported sessions, validation state, latest schedule state
- Upload: Excel upload and import summary
- Validation: errors and warnings table
- Generate: solver run trigger and status
- Review: timetable grid, table, filters, conflict list
- Export: CSV and XLSX downloads

## Build

```powershell
npm run build
```
