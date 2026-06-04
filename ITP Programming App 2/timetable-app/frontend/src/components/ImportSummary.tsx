import type { UploadFileSummary, UploadSummary, ValidationIssue } from "../types";

export default function ImportSummary({ summary }: { summary: UploadSummary }) {
  return (
    <section className="status-card import-report">
      <div className="section-heading">
        <div>
          <div className="status-card-title">Import Summary</div>
          <p>Rows imported from the selected Excel files</p>
        </div>
      </div>
      <div className="metric-grid compact">
        <div className="metric-card">
          <span>Rows read</span>
          <strong>{summary.rows_read}</strong>
        </div>
        <div className="metric-card">
          <span>Imported</span>
          <strong>{summary.rows_imported}</strong>
        </div>
        <div className="metric-card">
          <span>Issues</span>
          <strong>{summary.rows_failed}</strong>
        </div>
      </div>
      <FileSummaryTable files={summary.file_summaries ?? []} />
      <ImportErrorTable errors={summary.errors} />
    </section>
  );
}

function FileSummaryTable({ files }: { files: UploadFileSummary[] }) {
  if (files.length === 0) return null;

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>File</th>
            <th>Rows</th>
            <th>Errors</th>
          </tr>
        </thead>
        <tbody>
          {files.map((file) => (
            <tr key={file.filename}>
              <td>{file.filename}</td>
              <td>{file.rows_read}</td>
              <td>{file.error_count ?? 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ImportErrorTable({ errors }: { errors: ValidationIssue[] }) {
  if (errors.length === 0) return null;

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>File</th>
            <th>Row</th>
            <th>Field</th>
            <th>Message</th>
          </tr>
        </thead>
        <tbody>
          {errors.slice(0, 12).map((item, index) => (
            <tr key={`${item.source_file ?? "file"}-${item.row}-${index}`}>
              <td>{item.source_file ?? "Workbook"}</td>
              <td>{item.row}</td>
              <td>{item.field}</td>
              <td>{item.message}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
