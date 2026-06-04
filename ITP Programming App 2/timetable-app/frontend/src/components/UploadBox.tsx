/*
 * Reusable Excel file picker for requirements imports.
 * Supports multiple files so the backend can combine and validate a batch.
 */

import { Upload, X } from "lucide-react";
import { useEffect } from "react";
import { useSessionState } from "../sessionState";

type Props = {
  busy: boolean;
  onUpload: (files: File[]) => void;
  resetSignal?: number;
};

export default function UploadBox({ busy, onUpload, resetSignal = 0 }: Props) {
  const [files, setFiles] = useSessionState<File[]>("upload.selectedFiles", []);
  const fileKey = (file: File) => `${file.name}-${file.size}-${file.lastModified}`;

  useEffect(() => {
    if (resetSignal > 0) {
      setFiles([]);
    }
  }, [resetSignal, setFiles]);

  const handleSelectFiles = (selectedFiles: FileList | null) => {
    const nextFiles = Array.from(selectedFiles ?? []);
    setFiles((currentFiles) => {
      const existingKeys = new Set(currentFiles.map(fileKey));
      const uniqueFiles = nextFiles.filter((file) => !existingKeys.has(fileKey(file)));
      return [...currentFiles, ...uniqueFiles];
    });
  };

  const removeFile = (key: string) => {
    setFiles((currentFiles) => currentFiles.filter((file) => fileKey(file) !== key));
  };

  const label =
    files.length === 0
      ? "Select requirements Excel files"
      : files.length === 1
        ? files[0].name
        : `${files.length} files selected`;

  return (
    <div className="upload-panel">
      <label className="file-input">
        <Upload size={20} />
        <span>{label}</span>
        <input
          accept=".xlsx,.xls"
          multiple
          type="file"
          onChange={(event) => {
            handleSelectFiles(event.target.files);
            event.target.value = "";
          }}
        />
      </label>
      {files.length > 0 && (
        <>
          <button className="button" disabled={busy} onClick={() => onUpload(files)}>
            <Upload size={17} />
            {busy ? "Uploading" : files.length > 1 ? "Import Files" : "Import"}
          </button>
          <ul className="selected-files" aria-label="Selected Excel files">
            {files.map((file) => {
              const key = fileKey(file);
              return (
                <li key={key}>
                  <span>{file.name}</span>
                  <button
                    className="button secondary slim"
                    disabled={busy}
                    title={`Remove ${file.name}`}
                    type="button"
                    onClick={() => removeFile(key)}
                  >
                    <X size={14} />
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
