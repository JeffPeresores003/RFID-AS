const PROD_API_FALLBACK = "https://rfid-as.onrender.com/api";

export const API_BASE =
  import.meta.env.VITE_API_BASE ||
  (import.meta.env.DEV ? "/api" : PROD_API_FALLBACK);
