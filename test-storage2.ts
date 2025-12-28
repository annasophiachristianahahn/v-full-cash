import { Client } from "@replit/object-storage";

const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
console.log("Bucket ID:", bucketId);

const client = new Client({ bucketId });

async function main() {
  // Try to upload a simple test file
  console.log("Uploading test file...");
  const uploadResult = await client.uploadFromText("public/test.txt", "Hello World!");
  console.log("Upload result:", uploadResult);
  
  if (uploadResult.ok) {
    // Try to download it
    console.log("Downloading test file...");
    const downloadResult = await client.downloadAsText("public/test.txt");
    console.log("Download result:", downloadResult);
  }
}

main().catch(console.error);
