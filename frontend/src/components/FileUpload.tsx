"use client";

import { useState } from "react";

export default function FileUpload({ onUploadComplete }: { onUploadComplete: (filename: string) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      setError(null);
    }
  };

  const handleUpload = async () => {
    if (!file) return;

    setUploading(true);
    setError(null);

    // Mock Demo Logic
    setTimeout(() => {
      onUploadComplete(file.name);
      setFile(null);
      setUploading(false);
    }, 2000);
  };

  return (
    <div className="card mx-auto max-w-[400px]">
      <h3 className="title-md">Upload Handbook</h3>
      <p className="body-md mb-5">
        Select a PDF to index it for retrieval.
      </p>
      
      <div className="relative rounded-md border border-dashed border-hairline-strong p-8 text-center transition-colors hover:border-ink">
        <input 
          type="file" 
          accept=".pdf" 
          onChange={handleFileChange} 
          className="absolute inset-0 cursor-pointer opacity-0"
          id="file-upload"
        />
        <label htmlFor="file-upload" className="text-[15px] text-muted">
          {file ? file.name : "Click to select PDF"}
        </label>
      </div>

      {error && <p className="mt-2 text-sm text-semantic-error">{error}</p>}

      <button 
        className="btn-primary mt-5 w-full" 
        onClick={handleUpload}
        disabled={!file || uploading}
      >
        {uploading ? "Ingesting..." : "Upload & Index"}
      </button>
    </div>
  );
}
