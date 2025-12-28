import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Upload } from "lucide-react";

interface ObjectUploaderProps {
  maxNumberOfFiles?: number;
  maxFileSize?: number;
  onGetUploadParameters: () => Promise<{
    method: "PUT";
    url: string;
  }>;
  onComplete?: (result: { successful: Array<{ uploadURL: string; name: string; type: string }> }) => void;
  buttonClassName?: string;
  children: ReactNode;
}

export function ObjectUploader({
  maxNumberOfFiles = 1,
  maxFileSize = 10485760,
  onGetUploadParameters,
  onComplete,
  buttonClassName,
  children,
}: ObjectUploaderProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);
  const dragDepthRef = useRef(0);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const { toast } = useToast();

  const uploadFiles = async (files: FileList | File[]) => {
    const fileArray = Array.from(files).slice(0, maxNumberOfFiles);
    
    // Check file sizes
    for (const file of fileArray) {
      if (file.size > maxFileSize) {
        toast({
          title: "File too large",
          description: `${file.name} exceeds the maximum size of ${maxFileSize / 1024 / 1024}MB`,
          variant: "destructive"
        });
        if (fileInputRef.current) fileInputRef.current.value = "";
        return;
      }
    }

    setIsUploading(true);
    const successful: Array<{ uploadURL: string; name: string; type: string }> = [];

    try {
      for (const file of fileArray) {
        const uploadParams = await onGetUploadParameters();
        
        // Upload the file
        const uploadResponse = await fetch(uploadParams.url, {
          method: uploadParams.method,
          body: file,
          headers: {
            'Content-Type': file.type,
          },
        });

        if (!uploadResponse.ok) {
          throw new Error(`Upload failed for ${file.name}`);
        }

        successful.push({
          uploadURL: uploadParams.url,
          name: file.name,
          type: file.type,
        });
      }

      onComplete?.({ successful });
      
      toast({
        title: "Upload successful",
        description: `${successful.length} file(s) uploaded successfully`
      });
    } catch (error) {
      console.error("Upload error:", error);
      toast({
        title: "Upload failed",
        description: error instanceof Error ? error.message : "Failed to upload files",
        variant: "destructive"
      });
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    await uploadFiles(files);
  };

  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current += 1;
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current -= 1;
    if (dragDepthRef.current === 0) {
      setIsDragging(false);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current = 0;
    setIsDragging(false);

    const files = e.dataTransfer.files;
    if (!files || files.length === 0) return;

    // Filter for images only
    const imageFiles = Array.from(files).filter(file => file.type.startsWith('image/'));
    
    if (imageFiles.length === 0) {
      toast({
        title: "No images found",
        description: "Please drop image files only",
        variant: "destructive"
      });
      return;
    }

    if (imageFiles.length > maxNumberOfFiles) {
      toast({
        title: "Too many files",
        description: `You dropped ${imageFiles.length} files, but only the first ${maxNumberOfFiles} will be uploaded`,
      });
    }

    await uploadFiles(imageFiles);
  };

  return (
    <div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple={maxNumberOfFiles > 1}
        onChange={handleFileSelect}
        className="hidden"
        data-testid="input-file-upload"
      />
      
      <div
        ref={dropZoneRef}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`
          border-2 border-dashed rounded-lg p-8 text-center transition-colors
          ${isDragging 
            ? 'border-primary bg-primary/5' 
            : 'border-muted-foreground/25 hover:border-muted-foreground/50'
          }
          ${isUploading ? 'opacity-50 pointer-events-none' : ''}
        `}
        data-testid="drop-zone"
      >
        <div className="flex flex-col items-center gap-3">
          <Upload className={`w-12 h-12 ${isDragging ? 'text-primary' : 'text-muted-foreground'}`} />
          <div>
            <p className="text-sm font-medium mb-1">
              {isDragging ? 'Drop images here' : 'Drag and drop images here'}
            </p>
            <p className="text-xs text-muted-foreground mb-3">
              or click the button below to browse
            </p>
          </div>
          <Button 
            onClick={() => fileInputRef.current?.click()} 
            className={buttonClassName}
            disabled={isUploading}
            data-testid="button-upload-images"
          >
            {isUploading ? "Uploading..." : children}
          </Button>
          <p className="text-xs text-muted-foreground mt-2">
            Maximum {maxNumberOfFiles} files, {maxFileSize / 1024 / 1024}MB per file
          </p>
        </div>
      </div>
    </div>
  );
}
