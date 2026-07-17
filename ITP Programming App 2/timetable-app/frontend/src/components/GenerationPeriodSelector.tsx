import type { AcademicYearSummary } from "../types";

type Props = {
  academicYear: string;
  academicYears: AcademicYearSummary[];
  disabled?: boolean;
  trimester: number | "";
  onAcademicYearChange: (value: string) => void;
  onTrimesterChange: (value: number | "") => void;
};

export default function GenerationPeriodSelector({
  academicYear,
  academicYears,
  disabled = false,
  trimester,
  onAcademicYearChange,
  onTrimesterChange,
}: Props) {
  const selectedYear = academicYears.find((item) => item.academic_year === academicYear);

  return (
    <section className="status-card generation-period-panel">
      <div>
        <div className="status-card-title">Planning Period</div>
        <p>Select the academic year and trimester before generating this timetable.</p>
      </div>
      <div className="generation-period-fields">
        <label>
          <span>Academic Year</span>
          <select
            aria-label="Academic Year"
            disabled={disabled}
            onChange={(event) => onAcademicYearChange(event.target.value)}
            required
            value={academicYear}
          >
            <option value="">Select academic year</option>
            {academicYears.map((year) => (
              <option key={year.academic_year} value={year.academic_year}>
                {year.academic_year}
                {year.is_provisional ? " (Provisional)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Trimester</span>
          <select
            aria-label="Trimester"
            disabled={disabled || !academicYear}
            onChange={(event) => onTrimesterChange(event.target.value ? Number(event.target.value) : "")}
            required
            value={trimester}
          >
            <option value="">Select trimester</option>
            {[1, 2, 3].map((value) => (
              <option key={value} value={value}>
                Trimester {value}
              </option>
            ))}
          </select>
        </label>
      </div>
      {academicYear && trimester && (
        <div className="generation-period-summary" role="status">
          Timetable will be generated for <strong>AY {academicYear}</strong>, <strong>Trimester {trimester}</strong>
          {selectedYear?.is_provisional ? " (Provisional calendar)" : ""}.
        </div>
      )}
    </section>
  );
}
