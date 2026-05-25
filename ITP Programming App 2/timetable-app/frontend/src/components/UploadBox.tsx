import { Upload } from "lucide-react";
import { useState } from "react";

type Props = {
  busy: boolean;
  onUpload: (files: File[]) => void;
};

export default function UploadBox({ busy, onUpload }: Props) {
  const [files, setFiles] = useState<File[]>([]);
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
          onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
        />
      </label>
      <button className="button" disabled={files.length === 0 || busy} onClick={() => onUpload(files)}>
        <Upload size={17} />
        {busy ? "Uploading" : files.length > 1 ? "Import Files" : "Import"}
      </button>
    </div>
  );
}
