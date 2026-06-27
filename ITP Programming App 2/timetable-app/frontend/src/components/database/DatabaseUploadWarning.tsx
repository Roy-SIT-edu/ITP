import { Download, Upload, X } from "lucide-react";

type Props = {
  title: string;
  currentUrl: string;
  onCancel: () => void;
  onContinue: () => void;
};

export default function DatabaseUploadWarning({ title, currentUrl, onCancel, onContinue }: Props) {
  return (
    <div className="modal-backdrop" role="presentation">
      <div
        className="modal-content upload-warning-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="upload-warning-title"
      >
        <div className="modal-header">
          <h2 id="upload-warning-title">Replace {title} data?</h2>
          <button className="icon-button" type="button" onClick={onCancel} aria-label="Close upload warning">
            <X size={18} />
          </button>
        </div>
        <div className="modal-body upload-warning-body">
          <div className="upload-warning-copy">
            <strong>This Excel upload replaces all current {title.toLowerCase()} rows.</strong>
            <span>
              Download the current database first if you may need to restore or compare the existing information.
              Validation errors will stop the replacement, but a valid upload will overwrite this table.
            </span>
          </div>
        </div>
        <div className="modal-footer">
          <button className="button secondary" type="button" onClick={onCancel}>
            Cancel
          </button>
          <a className="button secondary" href={currentUrl}>
            <Download size={17} />
            Download Current Data
          </a>
          <button className="button danger" type="button" onClick={onContinue}>
            <Upload size={17} />
            Continue to Upload
          </button>
        </div>
      </div>
    </div>
  );
}
