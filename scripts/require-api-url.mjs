const value = process.env.VITE_API_BASE_URL;

if (!value) {
  throw new Error("VITE_API_BASE_URL is required for a frontend deployment.");
}

const url = new URL(value);
if (url.protocol !== "https:") {
  throw new Error("VITE_API_BASE_URL must use HTTPS for deployment.");
}

console.log(`Building against ${url.origin}`);
