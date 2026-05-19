import { Upload } from "lucide-react";
import { useState } from "react";

type Props = {
  busy: boolean;
  onUpload: (file: File) => void;
};

export default function UploadBox({ busy, onUpload }: Props) {
  const [file, setFile] = useState<File | null>(null);

  return (
    <div className="upload-panel">
      <label className="file-input">
        <Upload size={20} />
        <span>{file ? file.name : "System_Ready_Timetable_Input_Template.xlsx"}</span>
        <input
          accept=".xlsx,.xls"
          type="file"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
      </label>
      <button className="button" disabled={!file || busy} onClick={() => file && onUpload(file)}>
        <Upload size={17} />
        {busy ? "Uploading" : "Import"}
      </button>
    </div>
  );
}
