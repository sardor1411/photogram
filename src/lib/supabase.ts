/// <reference types="vite/client" />
import { createClient } from "@supabase/supabase-js";

// Clean up URL in case user mistakenly included /rest/v1
// This prevents PGRST125 Invalid path specified in request URL
const rawUrl = import.meta.env.EXPO_PUBLIC_SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL || "";
const supabaseUrl = rawUrl.replace(/\/rest\/v1\/?$/, "").replace(/\/+$/, "");
const supabaseAnonKey = import.meta.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl) {
  console.error("Missing EXPO_PUBLIC_SUPABASE_URL");
}
if (!supabaseAnonKey) {
  console.error("Missing EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
}

export const useMock = false; // Always use real auth flow as requested

export const supabase = useMock
  ? ({} as any) // We'll handle mock usage gracefully
  : createClient(supabaseUrl || 'https://placeholder.supabase.co', supabaseAnonKey || 'placeholder');

if (!useMock) {
  console.log("Active Supabase URL:", supabaseUrl);
  console.log("Auth initialized:", !!supabase.auth);
  // Optional ping
  supabase.from('profiles').select('id').limit(1).then(({ error }) => {
    console.log("Database connection status:", error ? "Error" : "OK", error || "");
  });
}

