"use client";

export default function PrintButton() {
  return (
    <button type="button" className="cc-btn primary" onClick={() => window.print()}>
      PRINT / SAVE PDF
    </button>
  );
}
