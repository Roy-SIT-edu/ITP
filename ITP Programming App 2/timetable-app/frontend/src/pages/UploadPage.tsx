import { useState } from "react";
import { uploadTemplate } from "../api/client";
import UploadBox from "../components/UploadBox";
import type { UploadSummary } from "../types";

export default function UploadPage() {
  const [summary, setSummary] = useState<UploadSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleUpload = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      setSummary(await uploadTemplate(file));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Upload</h1>
          <p>System-ready timetable input</p>
        </div>
      </div>
      <UploadBox busy={busy} onUpload={handleUpload} />
      {error && <div className="notice bad">{error}</div>}
      {summary && (
        <section className="metric-grid compact">
          <div className="metric-card">
            <span>Rows read</span>
            <strong>{summary.rows_read}</strong>
          </div>
          <div className="metric-card">
            <span>Imported</span>
            <strong>{summary.rows_imported}</strong>
          </div>
          <div className="metric-card">
            <span>Failed</span>
            <strong>{summary.rows_failed}</strong>
          </div>
        </section>
      )}
      {summary && summary.errors.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Row</th>
                <th>Field</th>
                <th>Message</th>
              </tr>
            </thead>
            <tbody>
              {summary.errors.map((item, index) => (
                <tr key={`${item.row}-${index}`}>
                  <td>{item.row}</td>
                  <td>{item.field}</td>
                  <td>{item.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
