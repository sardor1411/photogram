// supabase/functions/upload-url/index.ts
// Supabase Edge Function to generate pre-signed S3 PUT URL for direct-to-S3 client uploads.
// Environment variables required: S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { S3Client, PutObjectCommand } from "https://esm.sh/@aws-sdk/client-s3@3.341.0"
import { getSignedUrl } from "https://esm.sh/@aws-sdk/s3-request-presigner@3.341.0"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

serve(async (req) => {
  // Handle CORS Preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
    // Verify Request Method
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      })
    }

    // Parse Body
    const { fileName, fileType, userId } = await req.json()
    if (!fileName || !fileType) {
      return new Response(JSON.stringify({ error: "fileName and fileType are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      })
    }

    // Allowed mime types validation
    const allowedTypes = ["image/jpeg", "image/png", "image/webp"]
    if (!allowedTypes.includes(fileType)) {
      return new Response(JSON.stringify({ error: "Invalid file type. Only JPEG, PNG and WEBP are supported." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      })
    }

    // S3 Configurations from environment variables
    const s3Bucket = Deno.env.get("AWS_S3_BUCKET") || Deno.env.get("S3_BUCKET") || ""
    const s3Region = Deno.env.get("AWS_S3_REGION") || Deno.env.get("S3_REGION") || ""
    const s3AccessKey = Deno.env.get("AWS_ACCESS_KEY_ID") || ""
    const s3SecretKey = Deno.env.get("AWS_SECRET_ACCESS_KEY") || ""

    if (!s3Bucket || !s3Region || !s3AccessKey || !s3SecretKey) {
      return new Response(JSON.stringify({ error: "S3 environment variables are not configured in Supabase Secrets." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      })
    }

    // Instantiating AWS S3 client
    const s3Client = new S3Client({
      region: s3Region,
      credentials: {
        accessKeyId: s3AccessKey,
        secretAccessKey: s3SecretKey,
      },
    })

    // Generate unique storage path
    const resolvedPath = `${userId || "anonymous"}/${Date.now()}-${Math.random().toString(36).substring(2, 10)}.${fileName.split('.').pop()}`

    const command = new PutObjectCommand({
      Bucket: s3Bucket,
      Key: resolvedPath,
      ContentType: fileType,
    })

    // Get signed URL expires in 60 seconds
    const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 60 })
    const publicUrl = `https://${s3Bucket}.s3.${s3Region}.amazonaws.com/${resolvedPath}`

    return new Response(JSON.stringify({ uploadUrl, publicUrl, key: resolvedPath }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })

  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }
})
