// Reference: blueprint:javascript_object_storage
import { Storage, File } from "@google-cloud/storage";
import { Client as ReplitStorageClient } from "@replit/object-storage";
import { Response } from "express";
import { randomUUID } from "crypto";
import {
  ObjectAclPolicy,
  ObjectPermission,
  canAccessObject,
  getObjectAclPolicy,
  setObjectAclPolicy,
} from "./objectAcl";
import { getAppBaseUrl } from "./utils/imageUrl";

// Replit Object Storage client (preferred for uploads/deletes)
const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID || '';
export const replitStorageClient = bucketId ? new ReplitStorageClient({ bucketId }) : null;

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

export const objectStorageClient = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: {
        type: "json",
        subject_token_field_name: "access_token",
      },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

export class ObjectStorageService {
  constructor() {}

  getPublicObjectSearchPaths(): Array<string> {
    const pathsStr = process.env.PUBLIC_OBJECT_SEARCH_PATHS || "";
    const paths = Array.from(
      new Set(
        pathsStr
          .split(",")
          .map((path) => path.trim())
          .filter((path) => path.length > 0)
      )
    );
    if (paths.length === 0) {
      throw new Error(
        "PUBLIC_OBJECT_SEARCH_PATHS not set. Create a bucket in 'Object Storage' " +
          "tool and set PUBLIC_OBJECT_SEARCH_PATHS env var (comma-separated paths)."
      );
    }
    return paths;
  }

  getPrivateObjectDir(): string {
    const dir = process.env.PRIVATE_OBJECT_DIR || "";
    if (!dir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. Create a bucket in 'Object Storage' " +
          "tool and set PRIVATE_OBJECT_DIR env var."
      );
    }
    return dir;
  }

  async searchPublicObject(filePath: string): Promise<File | null> {
    for (const searchPath of this.getPublicObjectSearchPaths()) {
      const fullPath = `${searchPath}/${filePath}`;

      const { bucketName, objectName } = parseObjectPath(fullPath);
      const bucket = objectStorageClient.bucket(bucketName);
      const file = bucket.file(objectName);

      const [exists] = await file.exists();
      if (exists) {
        return file;
      }
    }

    return null;
  }

  async downloadObject(file: File, res: Response, cacheTtlSec: number = 3600) {
    try {
      const [metadata] = await file.getMetadata();
      const aclPolicy = await getObjectAclPolicy(file);
      const isPublic = aclPolicy?.visibility === "public";
      res.set({
        "Content-Type": metadata.contentType || "application/octet-stream",
        "Content-Length": metadata.size,
        "Cache-Control": `${
          isPublic ? "public" : "private"
        }, max-age=${cacheTtlSec}`,
      });

      const stream = file.createReadStream();

      stream.on("error", (err) => {
        console.error("Stream error:", err);
        if (!res.headersSent) {
          res.status(500).json({ error: "Error streaming file" });
        }
      });

      stream.pipe(res);
    } catch (error) {
      console.error("Error downloading file:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: "Error downloading file" });
      }
    }
  }

  async getObjectEntityUploadURL(): Promise<string> {
    const privateObjectDir = this.getPrivateObjectDir();
    if (!privateObjectDir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. Create a bucket in 'Object Storage' " +
          "tool and set PRIVATE_OBJECT_DIR env var."
      );
    }

    const objectId = randomUUID();
    const fullPath = `${privateObjectDir}/uploads/${objectId}`;

    const { bucketName, objectName } = parseObjectPath(fullPath);

    return signObjectURL({
      bucketName,
      objectName,
      method: "PUT",
      ttlSec: 900,
    });
  }

  async getObjectEntityFile(objectPath: string): Promise<File> {
    if (!objectPath.startsWith("/objects/")) {
      throw new ObjectNotFoundError();
    }

    const parts = objectPath.slice(1).split("/");
    if (parts.length < 2) {
      throw new ObjectNotFoundError();
    }

    const entityId = parts.slice(1).join("/");
    let entityDir = this.getPrivateObjectDir();
    if (!entityDir.endsWith("/")) {
      entityDir = `${entityDir}/`;
    }
    const objectEntityPath = `${entityDir}${entityId}`;
    const { bucketName, objectName } = parseObjectPath(objectEntityPath);
    const bucket = objectStorageClient.bucket(bucketName);
    const objectFile = bucket.file(objectName);
    const [exists] = await objectFile.exists();
    if (!exists) {
      throw new ObjectNotFoundError();
    }
    return objectFile;
  }

  normalizeObjectEntityPath(rawPath: string): string {
    if (!rawPath.startsWith("https://storage.googleapis.com/")) {
      return rawPath;
    }

    const url = new URL(rawPath);
    const rawObjectPath = url.pathname;

    let objectEntityDir = this.getPrivateObjectDir();
    if (!objectEntityDir.endsWith("/")) {
      objectEntityDir = `${objectEntityDir}/`;
    }

    if (!rawObjectPath.startsWith(objectEntityDir)) {
      return rawObjectPath;
    }

    const entityId = rawObjectPath.slice(objectEntityDir.length);
    return `/objects/${entityId}`;
  }

  async trySetObjectEntityAclPolicy(
    rawPath: string,
    aclPolicy: ObjectAclPolicy
  ): Promise<string> {
    const normalizedPath = this.normalizeObjectEntityPath(rawPath);
    if (!normalizedPath.startsWith("/")) {
      return normalizedPath;
    }

    const objectFile = await this.getObjectEntityFile(normalizedPath);
    await setObjectAclPolicy(objectFile, aclPolicy);
    return normalizedPath;
  }

  async canAccessObjectEntity({
    userId,
    objectFile,
    requestedPermission,
  }: {
    userId?: string;
    objectFile: File;
    requestedPermission?: ObjectPermission;
  }): Promise<boolean> {
    return canAccessObject({
      userId,
      objectFile,
      requestedPermission: requestedPermission ?? ObjectPermission.READ,
    });
  }

  // Upload a file to the public directory (for reply images)
  // Returns object key and public URL if successful, null if Object Storage is unavailable
  async uploadToPublicDirectory(
    fileName: string,
    fileData: Buffer,
    mimeType: string
  ): Promise<{ objectKey: string; publicUrl: string } | null> {
    // Use Replit Object Storage client (preferred)
    if (replitStorageClient) {
      try {
        const uniqueId = randomUUID();
        const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
        const objectKey = `public/reply-images/${uniqueId}--${sanitizedFileName}`;
        
        console.log(`[ObjectStorage] Uploading via Replit client: ${objectKey}`);
        await replitStorageClient.uploadFromBytes(objectKey, fileData);
        
        // Build public URL for serving through our app (with proper https://)
        const baseUrl = getAppBaseUrl();
        const publicUrl = `${baseUrl}/public-objects/${encodeURIComponent(objectKey)}`;
        
        console.log(`[ObjectStorage] Upload successful: ${objectKey}`);
        return { objectKey, publicUrl };
      } catch (error: any) {
        console.warn(`[ObjectStorage] Upload failed, falling back to database: ${error?.message}`);
        return null;
      }
    }
    
    // Fallback to Google Cloud Storage client (legacy)
    try {
      const publicPaths = this.getPublicObjectSearchPaths();
      if (publicPaths.length === 0) {
        console.log(`[ObjectStorage] No public paths configured, falling back to database`);
        return null;
      }

      const publicPath = publicPaths[0];
      const uniqueId = randomUUID();
      const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
      const objectKey = `reply-images/${uniqueId}--${sanitizedFileName}`;
      const fullPath = `${publicPath}/${objectKey}`;

      const { bucketName, objectName } = parseObjectPath(fullPath);
      const bucket = objectStorageClient.bucket(bucketName);
      const file = bucket.file(objectName);

      await file.save(fileData, {
        metadata: { contentType: mimeType }
      });

      const baseUrl = getAppBaseUrl();
      const publicUrl = `${baseUrl}/public-objects/${encodeURIComponent(objectKey)}`;

      console.log(`[ObjectStorage] Upload successful (GCS fallback): ${objectKey}`);
      return { objectKey, publicUrl };
    } catch (error: any) {
      console.warn(`[ObjectStorage] GCS upload failed, falling back to database: ${error?.message}`);
      return null;
    }
  }

  // Delete a file from the public directory
  // Returns true if deletion succeeded or was skipped, false if Object Storage is unavailable
  async deleteFromPublicDirectory(objectKey: string): Promise<boolean> {
    // Use Replit Object Storage client (preferred)
    if (replitStorageClient) {
      // Handle both old format (reply-images/...) and new format (public/reply-images/...)
      const deletePath = objectKey.startsWith('public/') ? objectKey : `public/${objectKey}`;
      console.log(`[ObjectStorage] Deleting via Replit client: ${deletePath}`);
      try {
        await replitStorageClient.delete(deletePath);
        return true;
      } catch (error: any) {
        // Treat 404-style errors as non-fatal for legacy cleanup
        if (error?.message?.includes('not found') || error?.code === 404) {
          console.log(`[ObjectStorage] Object not found, skipping delete: ${deletePath}`);
          return true; // Considered success - object doesn't exist
        }
        // For auth errors, log and return false to allow DB cleanup
        console.warn(`[ObjectStorage] Failed to delete ${deletePath}: ${error?.message}`);
        return false;
      }
    }
    
    // Fallback to Google Cloud Storage client (legacy)
    try {
      const publicPaths = this.getPublicObjectSearchPaths();
      if (publicPaths.length === 0) {
        console.warn("[ObjectStorage] No public object search paths configured and Replit client unavailable, skipping Object Storage delete");
        return false; // Return false to signal unavailable, but don't throw
      }

      const publicPath = publicPaths[0];
      const fullPath = `${publicPath}/${objectKey}`;

      const { bucketName, objectName } = parseObjectPath(fullPath);
      const bucket = objectStorageClient.bucket(bucketName);
      const file = bucket.file(objectName);

      const [exists] = await file.exists();
      if (exists) {
        await file.delete();
      }
      return true;
    } catch (error: any) {
      // Don't throw for config/auth issues - just log and return false
      console.warn(`[ObjectStorage] Failed to delete ${objectKey}: ${error?.message}`);
      return false;
    }
  }
}

function parseObjectPath(path: string): {
  bucketName: string;
  objectName: string;
} {
  if (!path.startsWith("/")) {
    path = `/${path}`;
  }
  const pathParts = path.split("/");
  if (pathParts.length < 3) {
    throw new Error("Invalid path: must contain at least a bucket name");
  }

  const bucketName = pathParts[1];
  const objectName = pathParts.slice(2).join("/");

  return {
    bucketName,
    objectName,
  };
}

async function signObjectURL({
  bucketName,
  objectName,
  method,
  ttlSec,
}: {
  bucketName: string;
  objectName: string;
  method: "GET" | "PUT" | "DELETE" | "HEAD";
  ttlSec: number;
}): Promise<string> {
  const request = {
    bucket_name: bucketName,
    object_name: objectName,
    method,
    expires_at: new Date(Date.now() + ttlSec * 1000).toISOString(),
  };
  const response = await fetch(
    `${REPLIT_SIDECAR_ENDPOINT}/object-storage/signed-object-url`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    }
  );
  if (!response.ok) {
    throw new Error(
      `Failed to sign object URL, errorcode: ${response.status}, ` +
        `make sure you're running on Replit`
    );
  }

  const { signed_url: signedURL } = await response.json();
  return signedURL;
}
