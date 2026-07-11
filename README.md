# Doorway

Doorway is a room-based live translation app that lets two participants join the same room and translate in both directions using Gemini Live.

## Prerequisites

Before you start, install the following on your machine:

- Node.js 18+ or newer
- npm

## Install dependencies

From the project root, run:

```bash
npm install
```

## Create your local environment file

Create a file named [.env.local](.env.local) at the project root and add the following values:

```env
GEMINI_API_KEY=your_gemini_api_key_here
APP_URL=http://localhost:3000
```

Notes:
- Replace `your_gemini_api_key_here` with your actual Gemini API key.
- `APP_URL` is the URL you want the app to use for browser access. For local development this can stay as `http://localhost:3000`.
- If you are testing from a phone over the internet, set `APP_URL` to your HTTPS tunnel URL such as an ngrok URL.

## Build the app

To create a production build:

```bash
npm run build
```

This generates the production assets in the `dist` folder.

## Run the app locally

### Development mode

```bash
npm run dev
```

This starts the Express + Vite dev server.

Then open:

- `http://localhost:3000`

### Production mode

After building, you can run:

```bash
npm run start
```

## Testing from another phone or laptop

### Option 1: Same Wi-Fi / local network

For same-network testing, use your Mac's local network IP instead of `localhost`, for example:

```text
http://192.168.x.x:3000
```

### Option 2: From another phone or laptop over the internet

Mobile browsers often require HTTPS for camera and microphone permissions, so using `localhost` or a plain HTTP URL is not enough in many cases.

Install ngrok and expose your local dev server:

```bash
ngrok http 3000
```

Then use the HTTPS URL shown by ngrok on the other phone or laptop, for example:

```text
https://your-ngrok-subdomain.ngrok-free.app
```

Update `APP_URL` in [.env.local](.env.local) to the ngrok URL so the app uses the externally accessible HTTPS address.

## Important runtime note

The server reads the Gemini API key from `.env.local`, so the app will not be able to start live translation sessions unless `GEMINI_API_KEY` is present and valid.
