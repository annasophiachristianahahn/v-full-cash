import { Client } from "@replit/object-storage";

// Try without bucket ID first
const client = new Client();

async function main() {
  console.log("Testing without bucket ID...");
  const result = await client.list();
  console.log("List result ok:", result.ok);
  if (result.ok) {
    console.log("Objects:", JSON.stringify(result.value, null, 2));
  } else {
    console.log("Error:", result.error);
  }
}

main().catch(console.error);
