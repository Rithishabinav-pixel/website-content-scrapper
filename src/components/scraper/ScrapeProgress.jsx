"use client";

import styles from "./scraper.module.css";

export default function ScrapeProgress({ results }) {
  if (!results || results.length === 0) return null;

  const total = results.length;
  const completed = results.filter((r) => r.status === "success").length;
  const failed = results.filter((r) => r.status === "error").length;
  const processing = results.filter((r) => r.status === "processing" || r.status === "queued").length;

  return (
    <p className={styles.summary}>
      {completed} of {total} completed
      {failed > 0 ? `, ${failed} failed` : ""}
      {processing > 0 ? `, ${processing} in progress` : ""}
    </p>
  );
}
