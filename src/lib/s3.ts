import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const region = import.meta.env.VITE_AWS_S3_REGION || import.meta.env.VITE_AWS_REGION || import.meta.env.AWS_REGION || 'us-east-1';
const BUCKET_NAME = import.meta.env.VITE_AWS_S3_BUCKET || import.meta.env.VITE_AWS_BUCKET_NAME || '';
const accessKeyId = import.meta.env.VITE_AWS_ACCESS_KEY_ID || '';
const secretAccessKey = import.meta.env.VITE_AWS_SECRET_ACCESS_KEY || '';

console.log("=== AWS ENVIRONMENT AUDIT ===");
console.log("Used Env Vars:");
console.log("- VITE_AWS_S3_BUCKET:", import.meta.env.VITE_AWS_S3_BUCKET);
console.log("- VITE_AWS_BUCKET_NAME:", import.meta.env.VITE_AWS_BUCKET_NAME);
console.log("- VITE_AWS_S3_REGION:", import.meta.env.VITE_AWS_S3_REGION);
console.log("- VITE_AWS_REGION:", import.meta.env.VITE_AWS_REGION);
console.log("Detected Bucket:", BUCKET_NAME);
console.log("Detected Region:", region);
console.log("Has Access Key:", !!accessKeyId);
console.log("Has Secret Key:", !!secretAccessKey);

export const s3Client = new S3Client({
  region,
  credentials: {
    accessKeyId,
    secretAccessKey,
  },
  requestChecksumCalculation: "WHEN_REQUIRED",
});

const s3Cache = new Map<string, string>();

export const getS3ObjectUrl = async (path: string): Promise<string> => {
  if (!accessKeyId) return path.startsWith('http') ? path : `https://${BUCKET_NAME}.s3.${region}.amazonaws.com/${path}`;
  
  if (s3Cache.has(path)) {
    return s3Cache.get(path)!;
  }
  
  let key = path;
  if (path.startsWith('http')) {
    const s3Domain = `s3.${region}.amazonaws.com`;
    if (path.includes(s3Domain)) {
      try {
        const urlObj = new URL(path);
        key = urlObj.pathname.substring(1); // root slash fix
      } catch (e) {
        return path;
      }
    } else {
      return path; // external url
    }
  }

  try {
    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    });
    const signedUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 * 24 }); // 24 hours
    s3Cache.set(path, signedUrl);
    return signedUrl;
  } catch (error) {
    console.error("Failed to generate GET presigned URL", error);
    return path.startsWith('http') ? path : `https://${BUCKET_NAME}.s3.${region}.amazonaws.com/${path}`;
  }
};

export const uploadToS3 = async (file: File, path: string): Promise<string> => {
  console.log("=== UPLOAD DEBUG: STARTING S3 UPLOAD ===");
  console.log("Bucket:", BUCKET_NAME);
  console.log("Region:", region);
  
  if (!accessKeyId) {
    console.error("AWS_ACCESS_KEY_ID is missing");
    throw new Error("AWS credentials are not configured");
  }

  console.log("STEP 2: Image compressed (Skipped/NA for exact sizes)");
  const fileBuffer = await file.arrayBuffer();
  console.log(`Request body size: ${fileBuffer.byteLength} bytes`);
  console.log(`Content type: ${file.type}`);
  
  const uploadUrl = `https://${BUCKET_NAME}.s3.${region}.amazonaws.com/${path}`;
  
  console.log("STEP 3: Generating Presigned URL");
  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: path,
    ContentType: file.type,
  });

  let presignedUrl = "";
  try {
    presignedUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
    console.log("Presigned URL generated successfully.");
    console.log("Presigned URL contains X-Amz-Algorithm:", presignedUrl.includes("X-Amz-Algorithm"));
    console.log("Presigned URL contains X-Amz-Credential:", presignedUrl.includes("X-Amz-Credential"));
    console.log("Presigned URL contains X-Amz-Signature:", presignedUrl.includes("X-Amz-Signature"));
    // DO NOT print full presigned URL in production, but for debug:
    console.log("Presigned URL:", presignedUrl);
  } catch (err: any) {
    console.error("Failed to generate presigned URL:", err);
    throw new Error(`Failed to generate presigned URL: ${err.message}`);
  }

  console.log("STEP 4: Upload request sent");
  console.log("Upload URL (Final destination):", uploadUrl);
  console.log("Method:", "PUT");
  console.log("Content-Type:", file.type);
  
  try {
    const response = await fetch(presignedUrl, {
      method: "PUT",
      body: fileBuffer,
      headers: {
        "Content-Type": file.type,
      },
    });

    console.log("STEP 5: Upload response received");
    console.log("Status:", response.status, response.statusText);
    
    // Convert headers to object for logging
    const headersObj: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headersObj[key] = value;
    });
    console.log("Headers:", JSON.stringify(headersObj));

    if (!response.ok) {
      const text = await response.text();
      console.error("Upload failed with HTTP:", response.status);
      console.error("Response body:", text);
      throw new Error(`Upload failed with status ${response.status}: ${text}`);
    }

    console.log("Upload successful!");
    return uploadUrl;
  } catch (error: any) {
    console.error("AWS S3 Upload Error Detailed:", error);
    if (error.message === 'Failed to fetch' || error.name === 'TypeError') {
      const detailedMessage = `Tarmoq yoki CORS xatosi: Iltimos AWS S3 da CORS ni quydagicha sozlang:
[
    {
        "AllowedHeaders": [
            "*"
        ],
        "AllowedMethods": [
            "GET",
            "PUT",
            "POST",
            "DELETE",
            "HEAD"
        ],
        "AllowedOrigins": [
            "*"
        ],
        "ExposeHeaders": [
            "ETag"
        ]
    }
]
Xato manzili (Presigned URL): ${presignedUrl}`;
      throw new Error(detailedMessage);
    }
    throw new Error(`Yuklashda xato: ${error.message}`);
  }
};

