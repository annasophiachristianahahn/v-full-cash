import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { ChevronDown, ChevronUp, Upload, X, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { ReplyImage } from "@shared/schema";

export function ReplyImagesManager() {
  const [isOpen, setIsOpen] = useState(false);
  const [images, setImages] = useState<ReplyImage[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragDepthRef = useRef(0);
  const { toast } = useToast();

  useEffect(() => {
    loadImages();
  }, []);

  const loadImages = async () => {
    try {
      const response = await fetch('/api/reply-images');
      if (response.ok) {
        const data = await response.json();
        setImages(data);
      }
    } catch (error) {
      console.error('Failed to load reply images:', error);
    }
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        // Remove data URL prefix (e.g., "data:image/png;base64,")
        const base64 = result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const uploadFiles = async (files: FileList | File[]) => {
    const fileArray = Array.from(files).filter(f => f.type.startsWith('image/'));
    
    if (fileArray.length === 0) {
      toast({
        title: "No images found",
        description: "Please select image files only",
        variant: "destructive"
      });
      return;
    }

    setIsUploading(true);

    try {
      for (const file of fileArray) {
        if (file.size > 10 * 1024 * 1024) {
          toast({
            title: "File too large",
            description: `${file.name} exceeds 10MB limit`,
            variant: "destructive"
          });
          continue;
        }

        const fileData = await fileToBase64(file);
        
        const response = await apiRequest('POST', '/api/objects/upload-direct', {
          fileData,
          fileName: file.name,
          mimeType: file.type
        });
        
        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || 'Upload failed');
        }
        
        const newImage = await response.json();
        setImages(prev => [...prev, newImage]);
      }
      
      toast({
        title: "Upload successful",
        description: `${fileArray.length} file(s) uploaded`
      });
    } catch (error) {
      console.error('Upload error:', error);
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

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      uploadFiles(e.target.files);
    }
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current += 1;
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current -= 1;
    if (dragDepthRef.current === 0) {
      setIsDragging(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current = 0;
    setIsDragging(false);
    
    if (e.dataTransfer.files) {
      uploadFiles(e.dataTransfer.files);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await apiRequest('DELETE', `/api/reply-images/${id}`);
      setImages(prev => prev.filter(img => img.id !== id));
      
      toast({
        title: "Image deleted",
        description: "Image has been removed from reply images",
      });
    } catch (error) {
      toast({
        title: "Delete failed",
        description: "Failed to delete image",
        variant: "destructive",
      });
    }
  };

  const handleClearAll = async () => {
    try {
      const response = await apiRequest('DELETE', '/api/reply-images');
      const data = await response.json();
      setImages([]);
      
      toast({
        title: "All images cleared",
        description: `Deleted ${data.deletedCount} images from database`,
      });
    } catch (error) {
      toast({
        title: "Clear failed",
        description: "Failed to clear all images",
        variant: "destructive",
      });
    }
  };

  return (
    <Card className="mb-8">
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CardHeader className="pb-3">
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              className="w-full justify-between p-0 hover:bg-transparent"
              data-testid="button-toggle-reply-images"
            >
              <CardTitle className="text-lg font-semibold">REPLY IMAGES</CardTitle>
              {isOpen ? (
                <ChevronUp className="w-4 h-4" />
              ) : (
                <ChevronDown className="w-4 h-4" />
              )}
            </Button>
          </CollapsibleTrigger>
          <p className="text-sm text-muted-foreground mt-2">
            Upload images to randomly attach to tweet replies ({images.length} uploaded)
          </p>
        </CardHeader>
        <CollapsibleContent>
          <CardContent>
            <div className="space-y-4">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={handleFileSelect}
                className="hidden"
                data-testid="input-file-upload"
              />
              
              <div
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
                    disabled={isUploading}
                    data-testid="button-upload-images"
                  >
                    {isUploading ? "Uploading..." : (
                      <>
                        <Upload className="w-4 h-4 mr-2" />
                        Browse Images
                      </>
                    )}
                  </Button>
                  <p className="text-xs text-muted-foreground mt-2">
                    10MB max per file
                  </p>
                </div>
              </div>

              {images.length > 0 && (
                <>
                  <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                    {images.map((image) => (
                      <div
                        key={image.id}
                        className="relative group aspect-square border rounded-lg overflow-hidden bg-muted"
                        data-testid={`image-thumbnail-${image.id}`}
                      >
                        <img
                          src={image.imageUrl}
                          alt={image.fileName}
                          className="w-full h-full object-cover"
                        />
                        <button
                          onClick={() => handleDelete(image.id)}
                          className="absolute top-1 right-1 bg-destructive text-destructive-foreground rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                          data-testid={`button-delete-image-${image.id}`}
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                  
                  <div className="mt-4 pt-4 border-t">
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button 
                          variant="destructive" 
                          size="sm"
                          data-testid="button-clear-all-images"
                        >
                          <Trash2 className="w-4 h-4 mr-2" />
                          Clear All Images ({images.length})
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Clear all reply images?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This will permanently delete all {images.length} images from the database. 
                            You will need to re-upload images after this action. This cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={handleClearAll}>
                            Yes, clear all images
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </>
              )}
            </div>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
